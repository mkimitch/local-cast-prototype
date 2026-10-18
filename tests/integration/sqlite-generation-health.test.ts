import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, expect, it, vi} from 'vitest';
import {openDatabase, inspectDatabaseHealth} from '../../server/database/connection';
import {applyMigrationPlan, migrationPlanThrough} from '../../server/database/migrations';
import {initializeStorage} from '../../server/storage';
import {GenerationJobStore} from '../../server/jobs/generationJobStore';
import {GenerationWorker} from '../../server/jobs/generationWorker';
import {createGenerationProcessor} from '../../server/jobs/generationProcessor';
import {EpisodeStore, episodeStore} from '../../server/services/episodeStore';
import {StationStore} from '../../server/services/stationStore';
import {SourceStore} from '../../server/services/sourceStore';
import {ProviderCheckStore} from '../../server/services/providerCheckStore';
import {OpenAiSpeechProvider} from '../../server/providers/openai';
import {testConfig, insertSource} from '../helpers/database';
import {contractEvidence} from '../fixtures/generationContract';

afterEach(() => vi.restoreAllMocks());

it('refreshes stale FTS5 state without hiding real index corruption or closing the connection', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localcast-fts-regression-'));
	const config = testConfig({databasePath: path.join(root, 'db.sqlite'), mediaPath: path.join(root, 'media')});
	const app = openDatabase(config), worker = openDatabase(config);
	const independent = new Database(config.databasePath, {readonly: true});
	try {
		const stations = new StationStore(worker);
		const note = stations.createNote({title: 'Synthetic', body: 'original tokens'});
		// This is the exact raw failure on the pinned dependency before the fix.
		expect(app.pragma('quick_check')).toEqual([{quick_check: 'fts5: checksum mismatch for table "material_fts"'}]);
		expect(app.pragma('integrity_check')).toEqual([{integrity_check: 'fts5: checksum mismatch for table "material_fts"'}]);
		expect(independent.pragma('quick_check')).toEqual([{quick_check: 'ok'}]);
		expect(independent.pragma('integrity_check')).toEqual([{integrity_check: 'ok'}]);
		const changes = app.prepare('SELECT total_changes()').pluck().get();
		expect(inspectDatabaseHealth(app).quickCheck).toBe('ok');
		expect(app.prepare('SELECT total_changes()').pluck().get()).toBe(changes);
		expect(app.open).toBe(true); expect(app.inTransaction).toBe(false);
		// Commit from another connection *between* the cursor and pragma: the
		// deferred read transaction must keep both on the earlier valid snapshot.
		const prepare = app.prepare.bind(app);
		const prepareSpy = vi.spyOn(app, 'prepare').mockImplementation(sql => {
			const statement = prepare(sql);
			if (sql === 'SELECT rowid FROM material_fts LIMIT 1') {
				const get = statement.get.bind(statement);
				vi.spyOn(statement, 'get').mockImplementation(() => {
					const result = get();
					expect(app.inTransaction).toBe(true);
					stations.createNote({title: 'Another synthetic note', body: 'another valid body'});
					return result;
				});
			}
			return statement;
		});
		expect(inspectDatabaseHealth(app).quickCheck).toBe('ok'); prepareSpy.mockRestore();
		expect(inspectDatabaseHealth(app).quickCheck).toBe('ok');
		// Deliberate shadow-table corruption is permitted only in this disposable
		// test. Same token count, different tokens: the actual index check must fail.
		worker.unsafeMode(true);
		worker.prepare('UPDATE material_fts_content SET c5 = ? WHERE c1 = ?').run('different words', note.id);
		worker.unsafeMode(false);
		for (const connection of [app, worker, independent]) {
			expect(() => inspectDatabaseHealth(connection)).toThrow('SQLite quick_check failed');
			expect(connection.pragma('integrity_check')).not.toEqual([{integrity_check: 'ok'}]);
			expect(connection.inTransaction).toBe(false);
		}
	} finally {
		vi.restoreAllMocks(); independent.close(); worker.close(); app.close();
		fs.rmSync(root, {recursive: true, force: true});
	}
});

it.each(['fresh', 'upgrade-008'] as const)('audits long-lived %s connections across real WAL generation transitions and rejection', async variant => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localcast-sqlite-repro-'));
	const config = testConfig({runtimeMode: 'production', installationId: 'synthetic-sqlite-investigation', databasePath: path.join(root, 'data/localcast.sqlite'), mediaPath: path.join(root, 'media'), credentialDirectory: path.join(root, 'credentials'), textProvider: 'openai', speechProvider: 'openai', openAiApiKey: 'synthetic-key', allowFakeProviders: false, leaseMs: 60_000});
	const connections: Database.Database[] = [];
	try {
		initializeStorage(config);
		if (variant === 'upgrade-008') {
			const old = new Database(config.databasePath);
			try {
				old.pragma('foreign_keys = ON'); old.pragma('journal_mode = WAL');
				applyMigrationPlan(old, migrationPlanThrough('008_episode_grounded_chat'));
				old.exec(`INSERT INTO stations (id,name,topic_instruction,default_mode,revision,created_at,updated_at) VALUES ('old-station','Synthetic old station','Summarize','brief',1,'2026-01-01','2026-01-01');
					INSERT INTO briefing_runs (id,title,status,created_at) VALUES ('old-run','Synthetic old run','failed','2026-01-01');
					INSERT INTO generation_requests (id,run_id,station_id_snapshot,station_revision,station_name,topic_instruction,requested_mode,request_hash,requested_at) VALUES ('old-request','old-run','old-station',1,'Synthetic old station','Summarize','brief','synthetic-old-hash','2026-01-01');`);
			} finally { old.close(); }
		}
		openDatabase(config, {initializingStorage: true}).close();
		const app = openDatabase({...config, processRole: 'app'}); connections.push(app);
		const worker = openDatabase(config); connections.push(worker);
		const appJobs = new GenerationJobStore(app), workerJobs = new GenerationJobStore(worker);
		const episodes = new EpisodeStore(worker), stations = new StationStore(app);
		const sources = new SourceStore(worker);
		insertSource(app, 'synthetic-feed');
		const note = stations.createNote({title: 'Synthetic body', body: contractEvidence.map(e => e.body).join(' ')});
		const station = stations.createStation({name: 'Synthetic station', topicInstruction: 'Use only supplied body facts.', defaultMode: 'brief', briefLengthPreset: 'compact', noteIds: [note.id], sourceIds: []});
		const samples: unknown[] = [];
		const audit = (boundary: string) => {
			const fresh = new Database(config.databasePath, {readonly: true, fileMustExist: true});
			try {
				for (const [name, db] of [['app', app], ['worker', worker], ['independent', fresh]] as const) {
					// Real application audit opens an FTS cursor in a pinned snapshot.
					const health = inspectDatabaseHealth(db);
					const quick = db.pragma('quick_check'), integrity = db.pragma('integrity_check');
					const context = {boundary, name, quick, integrity, inTransaction: db.inTransaction, readonly: db.readonly, schemaVersion: db.pragma('schema_version', {simple: true}), dataVersion: db.pragma('data_version', {simple: true}), journalMode: db.pragma('journal_mode', {simple: true})};
					samples.push(context);
					expect(quick, JSON.stringify(context)).toEqual([{quick_check: 'ok'}]);
					expect(integrity, JSON.stringify(context)).toEqual([{integrity_check: 'ok'}]);
					expect(health, JSON.stringify(context)).toMatchObject({quickCheck: 'ok', foreignKeyViolations: 0, schemaVersion: '009_compact_brief_length'});
				}
			} finally { fresh.close(); }
		};
		vi.spyOn(episodeStore, 'getRequest').mockImplementation(id => episodes.getRequest(id));
		vi.spyOn(episodeStore, 'listRequestSources').mockImplementation(id => episodes.listRequestSources(id));
		vi.spyOn(episodeStore, 'listEvidence').mockImplementation(id => episodes.listEvidence(id));
		vi.spyOn(episodeStore, 'finalizeEvidence').mockImplementation((requestId, runId) => episodes.finalizeEvidence(requestId, runId));
		const publish = vi.spyOn(episodeStore, 'publishEpisode');
		const speech = vi.spyOn(OpenAiSpeechProvider.prototype, 'render');
		const updatePhase = workerJobs.updatePhase.bind(workerJobs);
		vi.spyOn(workerJobs, 'updatePhase').mockImplementation((...args) => {
			// Same FTS trigger path as a feed sync immediately before selecting.
			// The response is supplied locally, never fetched from a provider/feed.
			if (args[2] === 'selecting') sources.upsertRssSourceItems('synthetic-feed', [{externalId: 'synthetic-item', title: 'Synthetic feed item', content: `Body for ${args[0]}`, gatheredAt: '2026-11-03T10:00:00Z', feedSourceUrl: 'https://example.test/feed.xml', networkScope: 'public'}]);
			const result = updatePhase(...args); audit(args[2]); return result;
		});
		let currentRun = '', stageCalls = 0;
		// Every HTTP call is intercepted; a speech or unexpected third call fails the test.
		const mockedHttp = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
			stageCalls += 1;
			expect(stageCalls).toBeLessThanOrEqual(2);
			audit(stageCalls === 1 ? 'draft-pending' : 'support-pending');
			await new Promise(resolve => setTimeout(resolve, 5));
			const value = stageCalls === 1
				? {sections: [{title: 'Synthetic', type: 'intro', segments: [{kind: 'factual', text: contractEvidence.map(e => e.body).join(' ') + ' Deliveries will resume tomorrow.', citations: ['E01']}]}]}
				: {results: [{claimId: `claim-${currentRun}-0-0`, status: 'unsupported'}]};
			if (stageCalls === 2) expect(String(init?.body)).toContain('Deliveries will resume tomorrow.');
			return new Response(JSON.stringify({status: 'completed', output: [{type: 'message', content: [{type: 'output_text', text: JSON.stringify(value)}]}]}));
		});
		const processor = createGenerationProcessor(config, workerJobs, {resolve: () => config.openAiApiKey}, new ProviderCheckStore(worker));
		audit('initial');
		// A reader remains on its WAL snapshot while the other connection commits.
		for (let attempt = 0; attempt < 12; attempt += 1) {
			stageCalls = 0;
			const job = appJobs.enqueueStation(station.id, 'brief').job; currentRun = job.runId;
			audit('enqueued');
			if (attempt % 2 === 0) { app.exec('BEGIN'); app.prepare('SELECT count(*) FROM generation_jobs').get(); }
			await new GenerationWorker(config, workerJobs, processor).runOnce();
			audit('failed-before-reader-release');
			if (app.inTransaction) app.exec('COMMIT');
			audit('failed-after-reader-release');
			expect(appJobs.get(job.id)).toMatchObject({state: 'failed', errorCode: 'UNSUPPORTED_GENERATED_CLAIM'});
			expect(workerJobs.listEvents(job.id).map(e => e.phase)).toEqual(['queued', 'syncing', 'selecting', 'drafting', 'validating', 'failed']);
		}
		worker.exec('BEGIN IMMEDIATE');
		worker.prepare('UPDATE stations SET revision = revision + 1 WHERE id = ?').run(station.id);
		audit('uncommitted-worker-write');
		worker.exec('ROLLBACK'); audit('worker-rollback');
		expect(mockedHttp).toHaveBeenCalledTimes(24);
		expect(speech).not.toHaveBeenCalled(); expect(publish).not.toHaveBeenCalled();
		for (const table of ['audio_assets', 'transcript_claims']) expect(app.prepare(`SELECT count(*) FROM ${table}`).pluck().get()).toBe(0);
		console.log(JSON.stringify({reproduction: variant, sqlite: app.prepare('SELECT sqlite_version() version, sqlite_source_id() source').get(), samples: samples.length, attempts: 12, networkRequests: 0, first: samples[0], last: samples.at(-1)}));
	} finally {
		vi.restoreAllMocks();
		for (const db of connections.reverse()) { if (db.inTransaction) db.exec('ROLLBACK'); db.close(); }
		fs.rmSync(root, {recursive: true, force: true});
	}
}, 30_000);
