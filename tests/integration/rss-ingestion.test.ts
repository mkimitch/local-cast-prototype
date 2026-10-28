import Database from 'better-sqlite3';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {applyMigrations} from '../../server/database/migrations';
import {RssIngestionService, FeedSyncError, feedParsingLimits} from '../../server/services/rssIngestion';
import {SafeFeedFetcher, type FeedFetchLimits, type FeedResolver} from '../../server/services/safeFeedFetcher';
import {SourceStore} from '../../server/services/sourceStore';

const roots: string[] = [];
const databases: Database.Database[] = [];
const servers: http.Server[] = [];

const openDatabase = (filename = ':memory:'): Database.Database => {
	const database = new Database(filename);
	database.pragma('foreign_keys = ON');
	applyMigrations(database);
	databases.push(database);
	return database;
};

const closeDatabase = (database: Database.Database): void => {
	const index = databases.indexOf(database);
	if (index >= 0) databases.splice(index, 1);
	database.close();
};

const listen = async (handler: http.RequestListener): Promise<{server: http.Server; port: number}> => {
	const server = http.createServer(handler);
	servers.push(server);
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	return {server, port: (server.address() as {port: number}).port};
};

const resolver: FeedResolver = async () => [{address: '127.0.0.1', family: 4}];
const fetcher = (privateHosts: string[], limits?: Partial<FeedFetchLimits>): SafeFeedFetcher => new SafeFeedFetcher(
	privateHosts,
	resolver,
	Date.now,
	{
		maxBytes: 2 * 1024 * 1024,
		maxRedirects: 5,
		totalTimeoutMs: 2_000,
		idleTimeoutMs: 500,
		maxHeaderBytes: 16 * 1024,
		...limits,
	},
);

const rss = (items: string): string => `<?xml version="1.0"?><rss version="2.0"><channel><title>Fixture</title><link>https://example.test</link>${items}</channel></rss>`;
const rssItem = (id: string, title: string, body: string, link = `https://articles.example.test/${id}`): string => `
	<item><guid>${id}</guid><title>${title}</title><description><![CDATA[${body}]]></description>
	<link>${link}</link><author>Fixture Author</author><pubDate>Wed, 05 Aug 2026 12:00:00 GMT</pubDate></item>`;

afterEach(async () => {
	while (servers.length) {
		const server = servers.pop()!;
		await new Promise<void>(resolve => server.close(() => resolve()));
	}
	while (databases.length) databases.pop()!.close();
	while (roots.length) fs.rmSync(roots.pop()!, {recursive: true, force: true});
});

describe('bounded RSS and Atom synchronization', () => {
	it('persists validators, sends conditional headers after restart, and deduplicates changed RSS items', async () => {
		let mode: 'initial' | 'not_modified' | 'changed' = 'initial';
		const requests: Array<{path: string; etag?: string; modified?: string}> = [];
		const {port} = await listen((request, response) => {
			requests.push({path: request.url || '', etag: request.headers['if-none-match'], modified: request.headers['if-modified-since']});
			if (request.url === '/article') {
				response.writeHead(500).end();
				return;
			}
			if (mode === 'not_modified') {
				response.writeHead(304, {ETag: '"v1"', 'Last-Modified': 'Wed, 05 Aug 2026 12:00:00 GMT'}).end();
				return;
			}
			const items = mode === 'initial'
				? `${rssItem('one', 'First title', 'First body with enough stored detail.', `http://feed.test:${port}/article`)}${rssItem('one', 'Duplicate title', 'Duplicate body.')}${rssItem('two', 'Unsafe link', 'Second body.', 'javascript:alert(1)')}`
				: `${rssItem('one', 'First title changed', 'First body changed with new detail.')}${rssItem('three', 'Third title', 'Third body.')}`;
			response.writeHead(200, {
				'Content-Type': 'application/rss+xml; charset=utf-8',
				ETag: mode === 'initial' ? '"v1"' : '"v2"',
				'Last-Modified': mode === 'initial' ? 'Wed, 05 Aug 2026 12:00:00 GMT' : 'Thu, 06 Aug 2026 12:00:00 GMT',
			}).end(rss(items));
		});

		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localcast-rss-restart-'));
		roots.push(root);
		const filename = path.join(root, 'localcast.sqlite');
		let database = openDatabase(filename);
		let generatedId = 0;
		let store = new SourceStore(database, () => '2026-08-06T12:00:00.000Z', () => `id-${++generatedId}`);
		const source = store.addSource({type: 'rss', name: 'Fixture RSS', url: `http://feed.test:${port}/feed`, isActive: true});
		let service = new RssIngestionService(store, fetcher(['feed.test']), () => new Date('2026-08-06T12:00:00.000Z'), () => 'lease-one');
		const first = await service.syncSource(source);
		expect(first).toMatchObject({insertedCount: 2, updatedCount: 0});
		expect(first.source).toMatchObject({feedEtag: '"v1"', feedLastModified: 'Wed, 05 Aug 2026 12:00:00 GMT', feedNetworkScope: 'private'});
		const originalItems = store.listSourceItems({sourceId: source.id});
		expect(originalItems).toHaveLength(2);
		expect(originalItems.find(item => item.title === 'Unsafe link')?.url).toBeUndefined();
		closeDatabase(database);

		mode = 'not_modified';
		database = openDatabase(filename);
		store = new SourceStore(database, () => '2026-08-06T12:01:00.000Z', () => `id-${++generatedId}`);
		service = new RssIngestionService(store, fetcher(['feed.test']), () => new Date('2026-08-06T12:01:00.000Z'), () => 'lease-two');
		const unchanged = await service.syncSource(store.getSource(source.id)!);
		expect(unchanged).toMatchObject({notModified: true, insertedCount: 0, updatedCount: 0});
		expect(store.listSourceItems({sourceId: source.id})).toEqual(originalItems);
		expect(requests.at(-1)).toMatchObject({etag: '"v1"', modified: 'Wed, 05 Aug 2026 12:00:00 GMT'});

		mode = 'changed';
		const changed = await service.syncSource(store.getSource(source.id)!);
		expect(changed).toMatchObject({insertedCount: 1, updatedCount: 1});
		expect(store.listSourceItems({sourceId: source.id})).toHaveLength(3);
		expect(store.listSourceItems({sourceId: source.id}).map(item => item.title)).toContain('First title changed');
		expect(requests.filter(value => value.path === '/article')).toHaveLength(0);
	});

	it('parses Atom, resolves safe relative links, caps items and fields, and renders hostile text inertly', async () => {
		const entries = Array.from({length: 30}, (_, index) => `
			<entry><id>atom-${index}</id><title>${'T'.repeat(600)} ${index}</title>
			<updated>2026-08-06T12:00:00Z</updated><author><name>${'A'.repeat(700)}</name></author>
			<link href="${index === 0 ? '/article-one' : index === 1 ? 'data:text/html,bad' : `/article-${index}`}" />
			<summary type="html"><![CDATA[<script src="https://evil.test/x.js"></script><b>${'Body '.repeat(12_000)}</b>]]></summary></entry>`).join('');
		const {port} = await listen((_request, response) => response.writeHead(200, {'Content-Type': 'application/atom+xml'}).end(
			`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Atom fixture</title>${entries}</feed>`,
		));
		const database = openDatabase();
		let generatedId = 0;
		const store = new SourceStore(database, () => '2026-08-06T12:00:00.000Z', () => `atom-${++generatedId}`);
		const source = store.addSource({type: 'rss', name: 'Fixture Atom', url: `http://atom.test:${port}/feed`, isActive: true});
		const service = new RssIngestionService(store, fetcher(['atom.test']), () => new Date('2026-08-06T12:00:00.000Z'), () => 'atom-lease');
		await service.syncSource(source);
		const items = store.listSourceItems({sourceId: source.id, limit: 50});
		expect(items).toHaveLength(feedParsingLimits.maxItems);
		expect(Math.max(...items.map(item => item.title.length))).toBeLessThanOrEqual(feedParsingLimits.maxTitleCharacters);
		expect(Math.max(...items.map(item => item.content.length))).toBeLessThanOrEqual(feedParsingLimits.maxBodyCharacters);
		expect(Math.max(...items.map(item => item.author?.length || 0))).toBeLessThanOrEqual(feedParsingLimits.maxAuthorCharacters);
		expect(items.some(item => item.url === `http://atom.test:${port}/article-one`)).toBe(true);
		expect(items.some(item => item.url?.startsWith('data:'))).toBe(false);
		expect(items.some(item => item.content.includes('<script'))).toBe(false);
	});

	it('rejects blocked destinations, unsafe redirects, invalid MIME/encoding, oversized/slow bodies, and DTDs with stable errors', async () => {
		let networkRequests = 0;
		const {port} = await listen((request, response) => {
			networkRequests += 1;
			switch (request.url) {
				case '/redirect-private':
					response.writeHead(302, {Location: `http://blocked.test:${port}/feed`}).end();
					break;
				case '/redirect-metadata':
					response.writeHead(302, {Location: `http://metadata.test:${port}/feed`}).end();
					break;
				case '/loop':
					response.writeHead(302, {Location: '/loop'}).end();
					break;
				case '/html':
					response.writeHead(200, {'Content-Type': 'text/html'}).end('<html>not a feed</html>');
					break;
				case '/gzip':
					response.writeHead(200, {'Content-Type': 'application/rss+xml', 'Content-Encoding': 'gzip'}).end('compressed');
					break;
				case '/large':
					response.writeHead(200, {'Content-Type': 'application/rss+xml', 'Content-Length': '1000'}).end('x');
					break;
				case '/stream-large':
					response.writeHead(200, {'Content-Type': 'application/rss+xml'});
					response.write('x'.repeat(200));
					response.end('y'.repeat(200));
					break;
				case '/slow':
					response.writeHead(200, {'Content-Type': 'application/rss+xml'});
					break;
				case '/dtd':
					response.writeHead(200, {'Content-Type': 'application/rss+xml'}).end('<!DOCTYPE rss [<!ENTITY x "bad">]><rss><channel><title>x</title></channel></rss>');
					break;
				default:
					response.writeHead(200, {'Content-Type': 'application/rss+xml'}).end(rss(rssItem('safe', 'Safe', 'Safe body')));
			}
		});
		const fastLimits = {maxBytes: 256, maxRedirects: 2, totalTimeoutMs: 250, idleTimeoutMs: 50, maxHeaderBytes: 1024};

		await expect(fetcher([], fastLimits).fetch(`http://private.test:${port}/feed`)).rejects.toMatchObject({code: 'FEED_DESTINATION_BLOCKED'});
		await expect(new SafeFeedFetcher(['metadata.test'], async () => [{address: '169.254.169.254', family: 4}], Date.now, fastLimits).fetch(`http://metadata.test:${port}/feed`)).rejects.toMatchObject({code: 'FEED_DESTINATION_BLOCKED'});
		await expect(new SafeFeedFetcher([], async () => [{address: '127.0.0.1', family: 4}, {address: '8.8.8.8', family: 4}], Date.now, fastLimits).fetch(`http://mixed.test:${port}/feed`)).rejects.toMatchObject({code: 'FEED_DESTINATION_BLOCKED'});
		await expect(fetcher(['start.test'], fastLimits).fetch(`http://start.test:${port}/redirect-private`)).rejects.toMatchObject({code: 'FEED_DESTINATION_BLOCKED'});
		const redirectResolver: FeedResolver = async hostname => hostname === 'metadata.test'
			? [{address: '169.254.169.254', family: 4}]
			: [{address: '127.0.0.1', family: 4}];
		await expect(new SafeFeedFetcher(['start.test'], redirectResolver, Date.now, fastLimits).fetch(`http://start.test:${port}/redirect-metadata`)).rejects.toMatchObject({code: 'FEED_DESTINATION_BLOCKED'});
		await expect(fetcher(['start.test'], fastLimits).fetch(`http://start.test:${port}/loop`)).rejects.toMatchObject({code: 'FEED_REDIRECT_LIMIT'});
		await expect(fetcher(['start.test'], fastLimits).fetch(`http://start.test:${port}/html`)).rejects.toMatchObject({code: 'FEED_CONTENT_TYPE_INVALID'});
		await expect(fetcher(['start.test'], fastLimits).fetch(`http://start.test:${port}/gzip`)).rejects.toMatchObject({code: 'FEED_CONTENT_ENCODING_INVALID'});
		await expect(fetcher(['start.test'], fastLimits).fetch(`http://start.test:${port}/large`)).rejects.toMatchObject({code: 'FEED_TOO_LARGE'});
		await expect(fetcher(['start.test'], fastLimits).fetch(`http://start.test:${port}/stream-large`)).rejects.toMatchObject({code: 'FEED_TOO_LARGE'});
		await expect(fetcher(['start.test'], fastLimits).fetch(`http://start.test:${port}/slow`)).rejects.toMatchObject({code: 'FEED_TIMEOUT'});

		const database = openDatabase();
		const store = new SourceStore(database, () => '2026-08-06T12:00:00.000Z', () => 'dtd-source');
		const source = store.addSource({type: 'rss', name: 'DTD', url: `http://start.test:${port}/dtd`, isActive: true});
		const service = new RssIngestionService(store, fetcher(['start.test'], {...fastLimits, maxBytes: 2048}), () => new Date('2026-08-06T12:00:00.000Z'), () => 'dtd-lease');
		await expect(service.syncSource(source)).rejects.toMatchObject({code: 'FEED_MALFORMED', safeMessage: 'The response could not be parsed as a safe RSS or Atom feed'});
		expect(store.listSourceItems({sourceId: source.id})).toEqual([]);
		expect(store.getSource(source.id)).toMatchObject({status: 'error', lastSyncErrorCode: 'FEED_MALFORMED'});

		database.prepare(`
			INSERT INTO sources (id, type, name, url, is_active, status, added_at)
			VALUES ('legacy-credential', 'rss', 'Legacy credential', ?, 1, 'healthy', '2026-08-06T12:00:00.000Z')
		`).run(`http://user:secret-canary@start.test:${port}/feed`);
		const quarantined = store.getSource('legacy-credential')!;
		expect(quarantined).toMatchObject({url: undefined, feedUrlInvalid: true, status: 'error', lastSyncErrorCode: 'INVALID_FEED_URL'});
		expect(JSON.stringify(quarantined)).not.toContain('secret-canary');
		const beforeCredentialAttempt = networkRequests;
		const credentialError = await service.syncSource(quarantined).catch(error => error as FeedSyncError);
		expect(credentialError).toMatchObject({code: 'INVALID_FEED_URL', safeMessage: 'The feed URL is not a valid credential-free HTTP(S) URL'});
		expect(JSON.stringify(credentialError)).not.toContain('secret-canary');
		expect(networkRequests).toBe(beforeCredentialAttempt);
		expect(store.getSource('legacy-credential')).toMatchObject({status: 'error', lastSyncErrorCode: 'INVALID_FEED_URL'});
	});

	it('bounds DNS resolution and the pending fetch queue within the total timeout', async () => {
		const limits = {maxBytes: 256, maxRedirects: 1, totalTimeoutMs: 60, idleTimeoutMs: 30, maxHeaderBytes: 1024};
		const stalledResolver: FeedResolver = async () => new Promise<never>(() => undefined);
		const bounded = new SafeFeedFetcher([], stalledResolver, Date.now, limits, 1, 1);
		const first = bounded.fetch('http://one.example.test/feed');
		await new Promise(resolve => setTimeout(resolve, 5));
		const queued = bounded.fetch('http://two.example.test/feed');
		await expect(bounded.fetch('http://three.example.test/feed')).rejects.toMatchObject({code: 'FEED_CONCURRENCY_LIMIT'});
		await expect(first).rejects.toMatchObject({code: 'FEED_TIMEOUT'});
		await expect(queued).rejects.toMatchObject({code: 'FEED_TIMEOUT'});
	});

	it('uses a SQLite lease so concurrent service instances perform one request and recover healthy state', async () => {
		let requestCount = 0;
		const {port} = await listen((_request, response) => {
			requestCount += 1;
			setTimeout(() => response.writeHead(200, {'Content-Type': 'application/rss+xml'}).end(rss(rssItem('one', 'One', 'One sufficiently descriptive body.'))), 100);
		});
		const database = openDatabase();
		const storeA = new SourceStore(database, () => '2026-08-06T12:00:00.000Z', () => 'source');
		const source = storeA.addSource({type: 'rss', name: 'Concurrent', url: `http://feed.test:${port}/feed`, isActive: true});
		const storeB = new SourceStore(database, () => '2026-08-06T12:00:00.010Z', () => 'unused');
		const first = new RssIngestionService(storeA, fetcher(['feed.test']), () => new Date('2026-08-06T12:00:00.000Z'), () => 'lease-a').syncSource(source);
		while (requestCount === 0) await new Promise(resolve => setTimeout(resolve, 5));
		const second = new RssIngestionService(storeB, fetcher(['feed.test']), () => new Date('2026-08-06T12:00:00.010Z'), () => 'lease-b').syncSource(source);
		await expect(second).rejects.toBeInstanceOf(FeedSyncError);
		await expect(second).rejects.toMatchObject({code: 'SOURCE_SYNC_IN_PROGRESS'});
		await first;
		expect(requestCount).toBe(1);
		expect(storeA.getSource(source.id)).toMatchObject({status: 'healthy', consecutiveSyncFailures: 0});
	});

	it('atomically fences an expired stale writer after a newer sync commits', async () => {
		let requestCount = 0;
		let releaseFirst: (() => void) | undefined;
		const {port} = await listen((_request, response) => {
			requestCount += 1;
			if (requestCount === 1) {
				releaseFirst = () => response.writeHead(200, {'Content-Type': 'application/rss+xml', ETag: '"old"'}).end(rss(rssItem('old', 'Old item', 'Old stale content should never be committed.')));
				return;
			}
			response.writeHead(200, {'Content-Type': 'application/rss+xml', ETag: '"new"'}).end(rss(rssItem('new', 'New item', 'Newer synchronized content remains authoritative.')));
		});
		let clock = Date.parse('2026-08-06T12:00:00.000Z');
		const nowDate = () => new Date(clock);
		const nowIso = () => nowDate().toISOString();
		const database = openDatabase();
		const storeA = new SourceStore(database, nowIso, () => 'source');
		const source = storeA.addSource({type: 'rss', name: 'Lease fence', url: `http://feed.test:${port}/feed`, isActive: true});
		const storeB = new SourceStore(database, nowIso, () => 'new-item');
		const stale = new RssIngestionService(storeA, fetcher(['feed.test']), nowDate, () => 'lease-a').syncSource(source);
		while (requestCount === 0) await new Promise(resolve => setTimeout(resolve, 5));
		clock += 31_000;
		await new RssIngestionService(storeB, fetcher(['feed.test']), nowDate, () => 'lease-b').syncSource(source);
		releaseFirst!();
		await expect(stale).rejects.toMatchObject({code: 'SOURCE_SYNC_LEASE_LOST'});
		expect(storeA.listSourceItems({sourceId: source.id}).map(item => item.title)).toEqual(['New item']);
		expect(storeA.getSource(source.id)).toMatchObject({feedEtag: '"new"', status: 'healthy'});
	});

	it('fences an in-flight old URL when the operator edits the source', async () => {
		let requested = false;
		let release: (() => void) | undefined;
		const {port} = await listen((_request, response) => {
			requested = true;
			release = () => response.writeHead(200, {'Content-Type': 'application/rss+xml', ETag: '"old"'}).end(rss(rssItem('old', 'Old URL item', 'Old URL content must not return after an edit.')));
		});
		const database = openDatabase();
		const store = new SourceStore(database, () => '2026-08-06T12:00:00.000Z', () => 'source');
		const source = store.addSource({type: 'rss', name: 'Editable', url: `http://feed.test:${port}/old`, isActive: true});
		const active = new RssIngestionService(store, fetcher(['feed.test']), () => new Date('2026-08-06T12:00:00.000Z'), () => 'lease').syncSource(source);
		while (!requested) await new Promise(resolve => setTimeout(resolve, 5));
		const replacement = `http://feed.test:${port}/new`;
		expect(store.updateSource(source.id, {url: replacement})).toMatchObject({url: replacement, itemCount: 0});
		release!();
		await expect(active).rejects.toMatchObject({code: 'SOURCE_SYNC_LEASE_LOST'});
		expect(store.listSourceItems({sourceId: source.id})).toEqual([]);
		expect(store.getSource(source.id)).toMatchObject({url: replacement, feedNetworkScope: 'unknown'});
		expect(store.getSource(source.id)?.feedEtag).toBeUndefined();
	});
});
