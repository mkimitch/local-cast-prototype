import Database from 'better-sqlite3';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {applyMigrations} from '../../server/database/migrations';
import {assertOpenAiEvidenceAuthorized} from '../../server/jobs/generationProcessor';
import {GenerationJobStore} from '../../server/jobs/generationJobStore';
import {GenerationWorker} from '../../server/jobs/generationWorker';
import {EpisodeStore, episodeEvidenceLimits} from '../../server/services/episodeStore';
import {synchronizeRequestSources} from '../../server/services/episodePreparation';
import {MaterialSearchStore} from '../../server/services/materialSearchStore';
import {RssIngestionService} from '../../server/services/rssIngestion';
import {SafeFeedFetcher, type FeedResolver} from '../../server/services/safeFeedFetcher';
import {SourceStore} from '../../server/services/sourceStore';
import {StationStore} from '../../server/services/stationStore';
import {DeterministicFakeGenerationProcessor} from '../../server/testing/fakeGenerationProcessor';
import {BriefingStore} from '../../server/services/briefingStore';
import {testConfig} from '../helpers/database';
import {installFrozenMigrationSnapshot} from '../fixtures/migrationSnapshots';

const databases: Database.Database[] = [];
const roots: string[] = [];
const servers: http.Server[] = [];

afterEach(async () => {
	while (servers.length) await new Promise<void>(resolve => servers.pop()!.close(() => resolve()));
	while (databases.length) databases.pop()!.close();
	while (roots.length) fs.rmSync(roots.pop()!, {recursive: true, force: true});
});

const adequateBody = [
	'LocalCast synchronizes only feeds captured by an explicit station generation request.',
	'Each selected feed item is stored in SQLite before immutable episode evidence is finalized.',
	'The worker calls a text provider only after the final evidence transaction has committed.',
	'Linked article pages are provenance only and LocalCast never retrieves their content.',
	'Completed transcripts and citations reference copied evidence snapshots rather than mutable feed rows.',
].join(' ');

const projection = (database: Database.Database, runId: string): string => JSON.stringify({
	evidence: database.prepare('SELECT * FROM episode_evidence_snapshots WHERE run_id = ? ORDER BY sort_order').all(runId),
	sections: database.prepare('SELECT * FROM briefing_sections WHERE run_id = ? ORDER BY sort_order').all(runId),
	claims: database.prepare('SELECT * FROM transcript_claims WHERE run_id = ? ORDER BY section_id, sort_order').all(runId),
	citations: database.prepare(`SELECT ec.* FROM episode_citations ec JOIN transcript_claims tc ON tc.id = ec.claim_id WHERE tc.run_id = ? ORDER BY ec.claim_id, ec.sort_order`).all(runId),
});

describe('selected-feed generation evidence barrier', () => {
	it('syncs only the captured feed, publishes after snapshot commit, and preserves history after refresh/delete/restart', async () => {
		let changed = false;
		const requests: string[] = [];
		const server = http.createServer((request, response) => {
			requests.push(request.url || '');
			if (request.url === '/article') {
				response.writeHead(500).end();
				return;
			}
			const id = request.url === '/a' ? 'selected-item' : 'unselected-item';
			const body = request.url === '/a' && changed ? `${adequateBody} Changed mutable text.` : adequateBody;
			response.writeHead(200, {'Content-Type': 'application/rss+xml'}).end(`<?xml version="1.0"?><rss version="2.0"><channel><title>Fixture</title><item><guid>${id}</guid><title>${request.url}</title><link>http://feed.test:${(server.address() as {port: number}).port}/article</link><description>${body}</description></item></channel></rss>`);
		});
		servers.push(server);
		await new Promise<void>((resolve, reject) => {
			server.once('error', reject);
			server.listen(0, '127.0.0.1', resolve);
		});
		const port = (server.address() as {port: number}).port;
		const resolver: FeedResolver = async () => [{address: '127.0.0.1', family: 4}];
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localcast-selected-feed-'));
		roots.push(root);
		const databasePath = path.join(root, 'localcast.sqlite');
		const mediaPath = path.join(root, 'media');
		fs.mkdirSync(mediaPath);
		let database = new Database(databasePath);
		database.pragma('foreign_keys = ON');
		applyMigrations(database);
		databases.push(database);
		let id = 0;
		const now = () => '2026-08-06T12:00:00.000Z';
		const sources = new SourceStore(database, now, () => `id-${++id}`);
		const selected = sources.addSource({type: 'rss', name: 'Selected feed', url: `http://feed.test:${port}/a`, isActive: true});
		const unselected = sources.addSource({type: 'rss', name: 'Unselected feed', url: `http://feed.test:${port}/b`, isActive: true});
		const stations = new StationStore(database, now, () => `id-${++id}`);
		const station = stations.createStation({name: 'Selected station', topicInstruction: 'Use only supplied feed facts.', defaultMode: 'brief', noteIds: [], sourceIds: [selected.id]});
		const jobs = new GenerationJobStore(database, now, () => `id-${++id}`);
		const episodes = new EpisodeStore(database);
		const queued = jobs.enqueueStation(station.id, 'brief').job;
		stations.updateStation(station.id, {...station, sourceIds: [unselected.id]});

		const rss = new RssIngestionService(sources, new SafeFeedFetcher(['feed.test'], resolver), () => new Date(now()), () => `lease-${++id}`);
		let barrierObserved = false;
		let providerBoundaryObserved = false;
		const synchronize = async (requestId: string, signal: AbortSignal) => {
			await synchronizeRequestSources(requestId, signal, {episodes, rss, sources, now});
			const requestSources = episodes.listRequestSources(requestId);
			barrierObserved = requestSources.length === 1 && requestSources[0]?.syncStatus === 'success' && sources.listSourceItems({sourceId: selected.id}).length === 1;
		};
		const config = testConfig({databasePath, mediaPath, workerId: 'selected-worker'});
		const processor = new DeterministicFakeGenerationProcessor(config, jobs, {
			episodes,
			sources,
			synchronize,
			onEvidenceFinalized: finalized => {
				const persisted = database.prepare('SELECT COUNT(*) AS count FROM episode_evidence_snapshots WHERE run_id = ?').get(queued.runId) as {count: number};
				providerBoundaryObserved = persisted.count === finalized.length && finalized.length > 0;
			},
		});
		const worker = new GenerationWorker(config, jobs, processor);
		expect(await worker.runOnce()).toBe(true);
		expect(barrierObserved).toBe(true);
		expect(providerBoundaryObserved).toBe(true);
		expect(jobs.get(queued.id)).toMatchObject({state: 'complete', phase: 'complete'});
		expect(requests.filter(value => value === '/a')).toHaveLength(1);
		expect(requests.filter(value => value === '/b')).toHaveLength(0);
		expect(requests.filter(value => value === '/article')).toHaveLength(0);
		const evidence = episodes.listEvidence(queued.runId);
		expect(evidence).toEqual([expect.objectContaining({kind: 'feed', sourceId: selected.id, sourceName: 'Selected feed', networkScope: 'private', body: adequateBody})]);
		expect(() => assertOpenAiEvidenceAuthorized(evidence)).toThrowError(expect.objectContaining({code: 'CLOUD_PROCESSING_NOT_AUTHORIZED'}));

		const before = projection(database, queued.runId);
		changed = true;
		await rss.syncSource(sources.getSource(selected.id)!);
		expect(sources.listSourceItems({sourceId: selected.id})[0]?.content).toContain('Changed mutable text');
		expect(projection(database, queued.runId)).toBe(before);
		expect(sources.deleteSource(selected.id)).toBe(true);
		expect(new MaterialSearchStore(database).search('synchronizes')).toEqual([]);
		expect(projection(database, queued.runId)).toBe(before);

		const index = databases.indexOf(database);
		databases.splice(index, 1);
		database.close();
		database = new Database(databasePath);
		database.pragma('foreign_keys = ON');
		applyMigrations(database);
		databases.push(database);
		expect(projection(database, queued.runId)).toBe(before);
	});

	it('keeps network provenance on each retained item when the source scope changes', () => {
		const database = new Database(':memory:');
		database.pragma('foreign_keys = ON');
		applyMigrations(database);
		databases.push(database);
		let id = 0;
		let timestamp = '2026-08-06T12:00:00.000Z';
		const sources = new SourceStore(database, () => timestamp, () => `id-${++id}`);
		const source = sources.addSource({type: 'rss', name: 'Scope transition', url: 'https://example.test/feed', isActive: true});
		sources.upsertRssSourceItems(source.id, [{
			externalId: 'private-item', title: 'Retained private item', content: adequateBody,
			gatheredAt: timestamp, feedSourceUrl: source.url!, networkScope: 'private',
		}]);
		expect(sources.acquireSyncLease(source.id, 'scope-owner', '2026-08-06T12:01:00.000Z', timestamp)).toBe('acquired');
		timestamp = '2026-08-06T12:00:01.000Z';
		expect(sources.completeSync(source.id, 'scope-owner', {
			expectedUrl: source.url!, checkedAt: timestamp, completedAt: timestamp, changed: false,
			validatorUrl: source.url!, networkScope: 'public',
		})).toMatchObject({feedNetworkScope: 'public'});
		sources.upsertRssSourceItems(source.id, [{
			externalId: 'public-item', title: 'New public item', content: adequateBody,
			gatheredAt: timestamp, feedSourceUrl: source.url!, networkScope: 'public',
		}]);

		const stations = new StationStore(database, () => timestamp, () => `id-${++id}`);
		const station = stations.createStation({name: 'Scope station', topicInstruction: 'Use supplied facts.', defaultMode: 'brief', noteIds: [], sourceIds: [source.id]});
		const jobs = new GenerationJobStore(database, () => timestamp, () => `id-${++id}`);
		const queued = jobs.enqueueStation(station.id, 'brief').job;
		const episodes = new EpisodeStore(database);
		const evidence = episodes.finalizeEvidence((queued.payload as {version: 2; requestId: string}).requestId, queued.runId);
		expect(evidence.map(item => [item.title, item.networkScope])).toEqual([
			['New public item', 'public'],
			['Retained private item', 'private'],
		]);
		expect(() => assertOpenAiEvidenceAuthorized(evidence)).toThrowError(expect.objectContaining({code: 'CLOUD_PROCESSING_NOT_AUTHORIZED'}));
	});

	it('caps finalized provider evidence deterministically without truncating snapshots', () => {
		const database = new Database(':memory:');
		database.pragma('foreign_keys = ON');
		applyMigrations(database);
		databases.push(database);
		let id = 0;
		const timestamp = '2026-08-06T12:00:00.000Z';
		const stations = new StationStore(database, () => timestamp, () => `id-${++id}`);
		const notes = Array.from({length: 4}, (_, index) => stations.createNote({title: `Bounded note ${index}`, body: `${adequateBody} ${String(index).repeat(49_000)}`}));
		const station = stations.createStation({name: 'Bounded station', topicInstruction: 'Use supplied facts.', defaultMode: 'brief', noteIds: notes.map(note => note.id), sourceIds: []});
		const jobs = new GenerationJobStore(database, () => timestamp, () => `id-${++id}`);
		const queued = jobs.enqueueStation(station.id, 'brief').job;
		const evidence = new EpisodeStore(database).finalizeEvidence((queued.payload as {version: 2; requestId: string}).requestId, queued.runId);
		const aggregate = evidence.reduce((total, item) => total + item.title.length + item.body.length + (item.author?.length || 0) + (item.originalUrl?.length || 0), 0);
		expect(aggregate).toBeLessThanOrEqual(episodeEvidenceLimits.maxAggregateCharacters);
		expect(evidence.length).toBeLessThan(notes.length);
		for (const item of evidence) expect(notes.some(note => note.body === item.body)).toBe(true);
	});

	it('backfills frozen-005 cached item URLs so a failed refresh can use local history', async () => {
		const database = new Database(':memory:');
		database.pragma('foreign_keys = ON');
		installFrozenMigrationSnapshot(database, '005_real_provider_walking_skeleton');
		database.prepare(`
			INSERT INTO sources (id, type, name, url, is_active, status, added_at)
			VALUES ('legacy-source', 'rss', 'Legacy cached feed', 'https://feed.example.test/rss', 1, 'healthy', '2026-08-06T12:00:00.000Z')
		`).run();
		database.prepare(`
			INSERT INTO source_items (id, source_id, external_id, title, content, gathered_at)
			VALUES ('legacy-item', 'legacy-source', 'legacy-external', 'Legacy cached item', ?, '2026-08-06T12:00:00.000Z')
		`).run(adequateBody);
		database.prepare(`
			INSERT INTO stations (id, revision, name, topic_instruction, default_mode, created_at, updated_at)
			VALUES ('legacy-station', 1, 'Legacy station', 'Use cached facts.', 'brief', '2026-08-06T12:00:00.000Z', '2026-08-06T12:00:00.000Z')
		`).run();
		database.prepare("INSERT INTO station_sources (station_id, source_id, sort_order) VALUES ('legacy-station', 'legacy-source', 0)").run();
		applyMigrations(database);
		databases.push(database);
		let id = 0;
		const now = () => '2026-08-06T12:01:00.000Z';
		const sources = new SourceStore(database, now, () => `id-${++id}`);
		const jobs = new GenerationJobStore(database, now, () => `id-${++id}`);
		const queued = jobs.enqueueStation('legacy-station', 'brief').job;
		const episodes = new EpisodeStore(database);
		const rss = new RssIngestionService(sources, new SafeFeedFetcher([], async () => { throw new Error('fixture DNS failure'); }), () => new Date(now()), () => 'legacy-lease');
		await synchronizeRequestSources((queued.payload as {version: 2; requestId: string}).requestId, new AbortController().signal, {episodes, rss, sources, now});
		const evidence = episodes.finalizeEvidence((queued.payload as {version: 2; requestId: string}).requestId, queued.runId);
		expect(evidence).toEqual([expect.objectContaining({title: 'Legacy cached item', body: adequateBody, networkScope: 'unknown'})]);
		expect(episodes.listRequestSources((queued.payload as {version: 2; requestId: string}).requestId)[0]).toMatchObject({syncStatus: 'error', syncErrorCode: 'FEED_DNS_FAILED'});
		expect(new BriefingStore(database).getRun(queued.runId)?.warnings).toEqual([expect.objectContaining({
			code: 'FEED_DNS_FAILED',
			sourceName: 'Legacy cached feed',
			cachedEvidenceUsed: true,
			message: expect.stringContaining('used previously stored items'),
		})]);
		expect(JSON.stringify(new BriefingStore(database).getRun(queued.runId)?.warnings)).not.toMatch(/fixture DNS failure|feed\.example\.test/);
	});

	it('fails a selected feed with no cached history instead of treating its sync error as evidence', () => {
		const database = new Database(':memory:');
		database.pragma('foreign_keys = ON');
		applyMigrations(database);
		databases.push(database);
		let id = 0;
		const now = () => '2026-08-06T12:00:00.000Z';
		const sources = new SourceStore(database, now, () => `id-${++id}`);
		const source = sources.addSource({type: 'rss', name: 'Unavailable source', url: 'https://unavailable.example.test/feed', isActive: true});
		const stations = new StationStore(database, now, () => `id-${++id}`);
		const station = stations.createStation({name: 'Unavailable station', topicInstruction: 'Use supplied facts only.', defaultMode: 'brief', noteIds: [], sourceIds: [source.id]});
		const queued = new GenerationJobStore(database, now, () => `id-${++id}`).enqueueStation(station.id, 'brief').job;
		const episodes = new EpisodeStore(database);
		const requestId = (queued.payload as {version: 2; requestId: string}).requestId;
		episodes.recordRequestSourceSync(requestId, source.id, {status: 'error', errorCode: 'FEED_TIMEOUT', syncedAt: now()});

		expect(() => episodes.finalizeEvidence(requestId, queued.runId)).toThrow(expect.objectContaining({code: 'INSUFFICIENT_SOURCE_MATERIAL'}));
		expect((database.prepare('SELECT COUNT(*) AS count FROM episode_evidence_snapshots WHERE run_id = ?').get(queued.runId) as {count: number}).count).toBe(0);
		expect(JSON.stringify(new BriefingStore(database).getRun(queued.runId)?.warnings)).not.toContain('unavailable.example.test');
	});
});
