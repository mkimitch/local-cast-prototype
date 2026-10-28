import {createHash, randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import Parser from 'rss-parser';
import type Database from 'better-sqlite3';
import {afterEach, describe, expect, it} from 'vitest';
import {PodcastAccess} from '../../server/podcast/token';
import {serializePodcastFeed} from '../../server/podcast/feed';
import {createPodcastRouter} from '../../server/routes/podcast';
import {EpisodeStore} from '../../server/services/episodeStore';
import {PodcastStore} from '../../server/services/podcastStore';
import {deterministicFakeMp3Bytes} from '../../server/testing/fakeGenerationProcessor';
import {createTestDatabase, testConfig} from '../helpers/database';

const databases: Database.Database[] = [];
const roots: string[] = [];

afterEach(() => {
	while (databases.length > 0) databases.pop()?.close();
	while (roots.length > 0) fs.rmSync(roots.pop()!, {recursive: true, force: true});
});

const protectedRoot = (): string => {
	const value = fs.mkdtempSync(path.join(os.tmpdir(), 'localcast-podcast-feed-'));
	fs.chmodSync(value, 0o700);
	roots.push(value);
	return value;
};

const tokenFile = (root: string, token = randomBytes(32).toString('base64url')): {filePath: string; token: string} => {
	const filePath = path.join(root, `token-${randomBytes(4).toString('hex')}`);
	fs.writeFileSync(filePath, token, {mode: 0o600});
	fs.chmodSync(filePath, 0o600);
	return {filePath, token};
};

const insertEpisode = (database: Database.Database, mediaPath: string, input: {
	id: string;
	status?: 'complete' | 'failed' | 'queued';
	completedAt?: string;
	title?: string;
		scriptVersion?: 1 | null;
		cited?: boolean;
		supported?: boolean;
		publishedAudio?: boolean;
		validatedAudio?: boolean;
		validAudioHash?: boolean;
		aiGeneratedAudio?: boolean;
}): {bytes: Buffer; sha256: string} => {
	const status = input.status ?? 'complete';
	const completedAt = input.completedAt ?? '2026-08-06T12:00:00.000Z';
	const scriptVersion = input.scriptVersion === undefined ? 1 : input.scriptVersion;
	database.prepare(`
		INSERT INTO briefing_runs (id, title, status, created_at, completed_at, summary, ai_generated, script_format_version)
		VALUES (?, ?, ?, ?, ?, ?, 1, ?)
	`).run(input.id, input.title ?? `Episode ${input.id}`, status, '2026-08-06T11:00:00.000Z', completedAt, `Summary for ${input.id}`, scriptVersion);
	database.prepare(`
		INSERT INTO generation_requests (
			id, run_id, station_id_snapshot, station_revision, station_name,
			topic_instruction, requested_mode, request_hash, requested_at
		) VALUES (?, ?, 'station-snapshot', 1, 'Station snapshot', 'Use supplied material', 'brief', ?, ?)
	`).run(`request-${input.id}`, input.id, createHash('sha256').update(input.id).digest('hex'), '2026-08-06T11:00:00.000Z');
	database.prepare(`
		INSERT INTO episode_evidence_snapshots (
			id, run_id, request_id, kind, original_id_snapshot, title, body,
			content_sha256, sort_order, network_scope
		) VALUES (?, ?, ?, 'note', 'note-snapshot', 'Supplied note', 'Supported evidence', ?, 0, 'user_supplied')
	`).run(`evidence-${input.id}`, input.id, `request-${input.id}`, createHash('sha256').update('Supported evidence').digest('hex'));
	database.prepare(`
		INSERT INTO briefing_sections (
			id, run_id, title, type, spoken_text, source_item_ids_json,
			importance_score, follow_up_prompts_json, sort_order
		) VALUES (?, ?, 'Grounded section', 'news_summary', 'Supported statement', '[]', 5, '[]', 0)
	`).run(`section-${input.id}`, input.id);
	database.prepare(`
		INSERT INTO transcript_claims (
			id, run_id, section_id, kind, text, support_status, sort_order, speaker_role
			) VALUES (?, ?, ?, 'factual', 'Supported statement', ?, 0, 'host')
		`).run(`claim-${input.id}`, input.id, `section-${input.id}`, input.supported === false ? 'not_required' : 'supported');
	if (input.cited !== false) {
		database.prepare(`
			INSERT INTO episode_citations (claim_id, snapshot_id, excerpt, sort_order)
			VALUES (?, ?, 'Supported evidence', 0)
		`).run(`claim-${input.id}`, `evidence-${input.id}`);
	}

	const bytes = deterministicFakeMp3Bytes();
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	if (input.publishedAudio !== false) {
		const filename = `episode-${input.id}.mp3`;
		fs.writeFileSync(path.join(mediaPath, filename), bytes);
		database.prepare(`
			INSERT INTO audio_assets (
				id, run_id, url, duration_ms, format, storage_filename, mime_type,
				byte_length, sha256, validated_at, provider, model, voice, ai_generated
				) VALUES (?, ?, ?, 78912, 'mp3', ?, 'audio/mpeg', ?, ?, ?, 'OpenAI', 'speech-model', 'voice', ?)
			`).run(
				`audio-${input.id}`,
				input.id,
				`/media/audio-${input.id}`,
				filename,
				bytes.byteLength,
				input.validAudioHash === false ? 'z'.repeat(64) : sha256,
				input.validatedAudio === false ? null : completedAt,
				input.aiGeneratedAudio === false ? 0 : 1,
			);
	}
	return {bytes, sha256};
};

const startRouter = async (input: {
	config: ReturnType<typeof testConfig>;
	access: PodcastAccess;
	store: PodcastStore;
	media: EpisodeStore;
}): Promise<{origin: string; close: () => Promise<void>}> => {
	const app = express();
	app.use(createPodcastRouter(input.config, {access: input.access, podcastEpisodes: input.store, media: input.media}));
	const server = createServer(app);
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('Podcast test server did not bind');
	return {
		origin: `http://127.0.0.1:${address.port}`,
		close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
	};
};

const request = async (origin: string, target: string, init?: RequestInit): Promise<Response> => {
	try {
		return await fetch(`${origin}${target}`, init);
	} catch {
		throw new Error('Podcast integration request failed');
	}
};

const responseFingerprint = async (response: Response): Promise<Record<string, string | number | null>> => {
	const body = Buffer.from(await response.arrayBuffer());
	return {
		status: response.status,
		cache: response.headers.get('cache-control'),
		contentType: response.headers.get('content-type'),
		contentLength: response.headers.get('content-length'),
		bodyLength: body.byteLength,
		bodySha256: createHash('sha256').update(body).digest('hex'),
	};
};

describe('private podcast feed and enclosure routes', () => {
	it('projects only fully grounded completed episodes newest first with stable token-independent GUIDs', async () => {
		const database = createTestDatabase();
		databases.push(database);
		const root = protectedRoot();
		const mediaPath = path.join(root, 'media');
		fs.mkdirSync(mediaPath);
		insertEpisode(database, mediaPath, {id: 'older', completedAt: '2026-08-06T12:00:00.000Z'});
		insertEpisode(database, mediaPath, {id: 'newer', completedAt: '2026-08-06T13:00:00.000Z', title: 'Escaped & <grounded> \u0001 title'});
		insertEpisode(database, mediaPath, {id: 'failed', status: 'failed'});
		insertEpisode(database, mediaPath, {id: 'queued', status: 'queued'});
		insertEpisode(database, mediaPath, {id: 'legacy', scriptVersion: null});
		insertEpisode(database, mediaPath, {id: 'uncited', cited: false});
		insertEpisode(database, mediaPath, {id: 'unsupported', supported: false});
		insertEpisode(database, mediaPath, {id: 'transition-only'});
		database.prepare("UPDATE transcript_claims SET kind = 'transition', support_status = 'not_required' WHERE run_id = 'transition-only'").run();
		insertEpisode(database, mediaPath, {id: 'non-ai-run'});
		database.prepare("UPDATE briefing_runs SET ai_generated = 0 WHERE id = 'non-ai-run'").run();
		insertEpisode(database, mediaPath, {id: 'no-audio', publishedAudio: false});
		insertEpisode(database, mediaPath, {id: 'unvalidated-audio', validatedAudio: false});
		insertEpisode(database, mediaPath, {id: 'invalid-audio-hash', validAudioHash: false});
		insertEpisode(database, mediaPath, {id: 'non-ai-audio', aiGeneratedAudio: false});
		const store = new PodcastStore(database);
		const listed = store.listPublishedEpisodes();
		expect(listed.map(episode => episode.runId)).toEqual(['newer', 'older']);

		const firstToken = tokenFile(root);
		const secondToken = tokenFile(root);
		const firstAccess = PodcastAccess.load({podcastTokenFile: firstToken.filePath, publicBaseUrl: 'https://localcast.example.test'})!;
		const secondAccess = PodcastAccess.load({podcastTokenFile: secondToken.filePath, publicBaseUrl: 'https://localcast.example.test'})!;
		const first = serializePodcastFeed(listed, firstAccess);
		const second = serializePodcastFeed(listed, secondAccess);
		const parser = new Parser();
		let firstParsed: Awaited<ReturnType<typeof parser.parseString>>;
		let secondParsed: Awaited<ReturnType<typeof parser.parseString>>;
		try {
			firstParsed = await parser.parseString(first.body.toString('utf8'));
			secondParsed = await parser.parseString(second.body.toString('utf8'));
		} catch {
			throw new Error('Generated private podcast XML did not parse');
		}
		expect(firstParsed.items.map(item => item.guid)).toEqual(secondParsed.items.map(item => item.guid));
		expect(firstParsed.items.map(item => item.guid)).toEqual(['urn:localcast:episode:newer', 'urn:localcast:episode:older']);
		expect(firstParsed.items.map(item => item.title)).toEqual(['Escaped & <grounded> � title', 'Episode older']);
		expect(firstParsed.items.map(item => item.pubDate)).toEqual([
			new Date('2026-08-06T13:00:00.000Z').toUTCString(),
			new Date('2026-08-06T12:00:00.000Z').toUTCString(),
		]);
		expect(first.body.includes(Buffer.from([0x01]))).toBe(false);
		const xml = first.body.toString('utf8');
		expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"')).toBe(true);
		expect(xml.includes('<!DOCTYPE') || xml.includes('<![CDATA[')).toBe(false);
		expect(xml.includes('All voices and audio are AI-generated.')).toBe(true);
		expect(xml.includes('xmlns:itunes=')).toBe(true);
		expect(xml.includes('xmlns:podcast=')).toBe(true);
		expect(xml.match(/<guid isPermaLink="false">/g)?.length).toBe(2);
		expect(xml.match(/<itunes:duration>1:19<\/itunes:duration>/g)?.length).toBe(2);
		expect(xml.includes(`atom:link href="${firstAccess.feedUrl()}" rel="self" type="application/rss+xml"`)).toBe(true);
		expect(firstParsed.items.every(item => item.enclosure?.type === 'audio/mpeg')).toBe(true);
		expect(firstParsed.items.every(item => Number(item.enclosure?.length) === deterministicFakeMp3Bytes().byteLength)).toBe(true);
		expect(firstParsed.items.every((item, index) => {
			try {
				const url = new URL(item.enclosure?.url || '');
				const expectedRun = index === 0 ? 'newer' : 'older';
				return url.origin === 'https://localcast.example.test'
					&& url.pathname.endsWith(`/episodes/${expectedRun}.mp3`);
			} catch {
				return false;
			}
		})).toBe(true);
		expect(firstParsed.items.every(item => Boolean(item.content?.includes('AI-generated')))).toBe(true);
	});

	it('serves valid GET and HEAD feed requests with exact validators and no-store policy', async () => {
		const database = createTestDatabase();
		databases.push(database);
		const root = protectedRoot();
		const mediaPath = path.join(root, 'media');
		fs.mkdirSync(mediaPath);
		insertEpisode(database, mediaPath, {id: 'feed-entry'});
		const secret = tokenFile(root);
		const config = testConfig({processRole: 'app', mediaPath, publicBaseUrl: 'https://localcast.example.test', podcastTokenFile: secret.filePath});
		const access = PodcastAccess.load(config)!;
		const server = await startRouter({config, access, store: new PodcastStore(database), media: new EpisodeStore(database)});
		try {
			const target = new URL(access.feedUrl()).pathname;
			const get = await request(server.origin, target);
			const body = Buffer.from(await get.arrayBuffer());
			expect(get.status).toBe(200);
			expect(get.headers.get('content-type')).toContain('application/rss+xml');
			expect(get.headers.get('content-length')).toBe(String(body.byteLength));
			expect(get.headers.get('cache-control')).toBe('private, no-store');
			expect(get.headers.get('etag')?.length).toBe(66);
			expect(Number.isFinite(Date.parse(get.headers.get('last-modified') || ''))).toBe(true);
			const head = await request(server.origin, target, {method: 'HEAD'});
			expect(head.status).toBe(200);
			expect(head.headers.get('content-length')).toBe(String(body.byteLength));
			expect((await head.arrayBuffer()).byteLength).toBe(0);
			const notModified = await request(server.origin, target, {headers: {'If-None-Match': get.headers.get('etag') || ''}});
			expect(notModified.status).toBe(304);
			const weakNotModified = await request(server.origin, target, {headers: {'If-None-Match': `W/${get.headers.get('etag') || ''}`}});
			expect(weakNotModified.status).toBe(304);
			const changedEtagWins = await request(server.origin, target, {headers: {
				'If-None-Match': '"changed"',
				'If-Modified-Since': get.headers.get('last-modified') || '',
			}});
			expect(changedEtagWins.status).toBe(200);
		} finally {
			await server.close();
		}
	});

	it('makes missing, malformed, wrong, and rotated feed tokens indistinguishable', async () => {
		const database = createTestDatabase();
		databases.push(database);
		const root = protectedRoot();
		const mediaPath = path.join(root, 'media');
		fs.mkdirSync(mediaPath);
		insertEpisode(database, mediaPath, {id: 'token-matrix'});
		const current = tokenFile(root);
		const prior = tokenFile(root);
		const config = testConfig({processRole: 'app', mediaPath, publicBaseUrl: 'https://localcast.example.test', podcastTokenFile: current.filePath});
		const access = PodcastAccess.load(config)!;
		const server = await startRouter({config, access, store: new PodcastStore(database), media: new EpisodeStore(database)});
		const currentTarget = new URL(access.feedUrl()).pathname;
		try {
			const wrong = randomBytes(32).toString('base64url');
			const targets = [
				'/podcast/feed.xml',
				'/podcast/malformed/feed.xml',
				`/podcast/${wrong}/feed.xml`,
				`/podcast/${prior.token}/feed.xml`,
				'/podcast/localcast/feed.xml',
			];
			const fingerprints = [];
			for (const target of targets) {
				const get = await responseFingerprint(await request(server.origin, target));
				const head = await responseFingerprint(await request(server.origin, target, {method: 'HEAD'}));
				expect(head.status).toBe(get.status);
				expect(head.cache).toBe(get.cache);
				expect(head.contentLength).toBe(get.contentLength);
				expect(head.bodyLength).toBe(0);
				fingerprints.push(get);
			}
			expect(fingerprints.every(value => JSON.stringify(value) === JSON.stringify(fingerprints[0]))).toBe(true);
			expect(fingerprints[0]?.status).toBe(404);
			const valid = await request(server.origin, currentTarget);
			expect(valid.status).toBe(200);
		} finally {
			await server.close();
		}

		const rotated = tokenFile(root);
		const rotatedAccess = PodcastAccess.load({...config, podcastTokenFile: rotated.filePath})!;
		const restarted = await startRouter({config, access: rotatedAccess, store: new PodcastStore(database), media: new EpisodeStore(database)});
		try {
			expect((await request(restarted.origin, currentTarget)).status).toBe(404);
			expect((await request(restarted.origin, new URL(rotatedAccess.feedUrl()).pathname)).status).toBe(200);
		} finally {
			await restarted.close();
		}
	});

	it('protects full, HEAD, and byte-range enclosures before media lookup', async () => {
		const database = createTestDatabase();
		databases.push(database);
		const root = protectedRoot();
		const mediaPath = path.join(root, 'media');
		fs.mkdirSync(mediaPath);
		const fixture = insertEpisode(database, mediaPath, {id: 'enclosure'});
		insertEpisode(database, mediaPath, {id: 'enclosure-uncited', cited: false});
		insertEpisode(database, mediaPath, {id: 'enclosure-unsupported', supported: false});
		insertEpisode(database, mediaPath, {id: 'enclosure-non-ai'});
		database.prepare("UPDATE briefing_runs SET ai_generated = 0 WHERE id = 'enclosure-non-ai'").run();
		const secret = tokenFile(root);
		const prior = tokenFile(root);
		const config = testConfig({processRole: 'app', mediaPath, publicBaseUrl: 'https://localcast.example.test', podcastTokenFile: secret.filePath});
		const access = PodcastAccess.load(config)!;
		const server = await startRouter({config, access, store: new PodcastStore(database), media: new EpisodeStore(database)});
		const target = new URL(access.enclosureUrl('enclosure')).pathname;
		try {
			const full = await request(server.origin, target);
			expect(full.status).toBe(200);
			expect(Buffer.from(await full.arrayBuffer())).toEqual(fixture.bytes);
			const head = await request(server.origin, target, {method: 'HEAD'});
			expect(head.status).toBe(200);
			expect(head.headers.get('content-length')).toBe(String(fixture.bytes.byteLength));
			expect((await head.arrayBuffer()).byteLength).toBe(0);
			const range = await request(server.origin, target, {headers: {Range: 'bytes=7-39'}});
			expect(range.status).toBe(206);
			expect(Buffer.from(await range.arrayBuffer())).toEqual(fixture.bytes.subarray(7, 40));
			const missing = await responseFingerprint(await request(server.origin, new URL(access.enclosureUrl('missing')).pathname));
			for (const runId of ['enclosure-uncited', 'enclosure-unsupported', 'enclosure-non-ai']) {
				const excluded = await responseFingerprint(await request(server.origin, new URL(access.enclosureUrl(runId)).pathname));
				expect(excluded).toEqual(missing);
			}

			const invalidTargets = [
				'/podcast/episodes/enclosure.mp3',
				'/podcast/malformed/episodes/enclosure.mp3',
				`/podcast/${randomBytes(32).toString('base64url')}/episodes/enclosure.mp3`,
				`/podcast/${prior.token}/episodes/enclosure.mp3`,
				'/podcast/localcast/episodes/enclosure.mp3',
			];
			const invalidGets = [];
			for (const invalidTarget of invalidTargets) {
				const invalidGet = await responseFingerprint(await request(server.origin, invalidTarget));
				const invalidRange = await responseFingerprint(await request(server.origin, invalidTarget, {headers: {Range: 'bytes=0-7'}}));
				const invalidHead = await responseFingerprint(await request(server.origin, invalidTarget, {method: 'HEAD'}));
				expect(JSON.stringify(invalidRange) === JSON.stringify(invalidGet)).toBe(true);
				expect(invalidHead.status).toBe(invalidGet.status);
				expect(invalidHead.cache).toBe(invalidGet.cache);
				expect(invalidHead.contentLength).toBe(invalidGet.contentLength);
				expect(invalidHead.bodyLength).toBe(0);
				invalidGets.push(invalidGet);
			}
			expect(invalidGets.every(value => JSON.stringify(value) === JSON.stringify(invalidGets[0]))).toBe(true);
		} finally {
			await server.close();
		}

		const rotated = tokenFile(root);
		const rotatedAccess = PodcastAccess.load({...config, podcastTokenFile: rotated.filePath})!;
		const restarted = await startRouter({config, access: rotatedAccess, store: new PodcastStore(database), media: new EpisodeStore(database)});
		try {
			expect((await request(restarted.origin, target)).status).toBe(404);
			expect((await request(restarted.origin, new URL(rotatedAccess.enclosureUrl('enclosure')).pathname)).status).toBe(200);
		} finally {
			await restarted.close();
		}
	});
});
