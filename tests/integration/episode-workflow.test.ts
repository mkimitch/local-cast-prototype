import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import {afterEach, describe, expect, it} from 'vitest';
import {countWords} from '../../server/episodes/modePolicy';
import {GenerationJobStore} from '../../server/jobs/generationJobStore';
import {GenerationWorker} from '../../server/jobs/generationWorker';
import type {ActiveJobPhase} from '../../server/jobs/types';
import {EpisodeStore} from '../../server/services/episodeStore';
import {StationStore} from '../../server/services/stationStore';
import {DeterministicFakeGenerationProcessor} from '../../server/testing/fakeGenerationProcessor';
import {createTestDatabase, testConfig} from '../helpers/database';

const databases: Database.Database[] = [];
const roots: string[] = [];

afterEach(() => {
	while (databases.length > 0) databases.pop()?.close();
	while (roots.length > 0) fs.rmSync(roots.pop()!, {recursive: true, force: true});
});

const factualBody = (words: number): string => Array.from(
	{length: words},
	(_value, index) => `fact${String(index + 1).padStart(4, '0')}`,
).join(' ');

const harness = (input: {mode?: 'brief' | 'deep'; words?: number; failurePhase?: ActiveJobPhase}) => {
	const database = createTestDatabase();
	databases.push(database);
	const mediaPath = fs.mkdtempSync(path.join(os.tmpdir(), 'localcast-episode-workflow-'));
	roots.push(mediaPath);
	let id = 0;
	const stations = new StationStore(database, () => '2026-08-06T12:00:00.000Z', () => `domain-${++id}`);
	const jobs = new GenerationJobStore(database, () => new Date(Date.UTC(2026, 7, 6, 12, 0, id++)).toISOString(), () => `job-${++id}`);
	const episodes = new EpisodeStore(database);
	const note = stations.createNote({title: 'Grounded workflow fixture', body: factualBody(input.words ?? 800)});
	const station = stations.createStation({
		name: 'Grounded workflow',
		topicInstruction: 'Synthesize the supplied material without outside research.',
		defaultMode: input.mode ?? 'brief',
		noteIds: [note.id],
		sourceIds: [],
	});
	const job = jobs.enqueueStation(station.id, input.mode).job;
	const config = testConfig({
		mediaPath,
		fakeFailurePhase: input.failurePhase,
		fakeFailureAttempt: input.failurePhase ? 1 : undefined,
		workerId: 'slice3-worker',
	});
	const processor = new DeterministicFakeGenerationProcessor(config, jobs, {episodes});
	return {database, episodes, job, jobs, worker: new GenerationWorker(config, jobs, processor)};
};

const transcriptWords = (database: Database.Database, runId: string): number => {
	const rows = database.prepare('SELECT text FROM transcript_claims WHERE run_id = ? ORDER BY rowid').all(runId) as Array<{text: string}>;
	return countWords(rows.map(row => row.text).join(' '));
};

describe('complete grounded episode workflow', () => {
	it('produces materially different persisted brief and deep episodes from identical adequate material', async () => {
		const brief = harness({mode: 'brief', words: 2_300});
		await brief.worker.runOnce();
		expect(brief.jobs.get(brief.job.id)).toMatchObject({state: 'complete'});
		const briefWords = transcriptWords(brief.database, brief.job.runId);

		const deep = harness({mode: 'deep', words: 2_300});
		await deep.worker.runOnce();
		expect(deep.jobs.get(deep.job.id)).toMatchObject({state: 'complete'});
		const deepWords = transcriptWords(deep.database, deep.job.runId);

		expect(briefWords).toBeGreaterThanOrEqual(600);
		expect(briefWords).toBeLessThanOrEqual(1_000);
		expect(deepWords).toBeGreaterThanOrEqual(1_800);
		expect(deepWords).toBeLessThanOrEqual(3_000);
		expect(deepWords).toBeGreaterThan(briefWords);
		expect(deep.database.prepare('SELECT mode, script_format_version FROM briefing_runs WHERE id = ?').get(deep.job.runId)).toEqual({mode: 'deep', script_format_version: 1});
		expect((deep.database.prepare('SELECT COUNT(*) AS count FROM audio_assets WHERE run_id = ?').get(deep.job.runId) as {count: number}).count).toBe(1);
	});

	it('fails sparse deep material before publication and never offers retry', async () => {
		const value = harness({mode: 'deep', words: 120});
		await value.worker.runOnce();
		expect(value.jobs.get(value.job.id)).toMatchObject({
			state: 'failed',
			errorCode: 'INSUFFICIENT_SOURCE_MATERIAL',
			retryable: false,
			failedPhase: 'selecting',
		});
		expect((value.database.prepare('SELECT COUNT(*) AS count FROM episode_evidence_snapshots WHERE run_id = ?').get(value.job.runId) as {count: number}).count).toBe(0);
		expect((value.database.prepare('SELECT COUNT(*) AS count FROM audio_assets WHERE run_id = ?').get(value.job.runId) as {count: number}).count).toBe(0);
		expect(() => value.jobs.retry(value.job.id, 'sparse-retry-request')).toThrow(/not retryable/);
	});

	it.each<ActiveJobPhase>(['syncing', 'selecting', 'drafting', 'validating', 'rendering_audio'])('recovers one injected %s failure with one idempotent retry and no duplicates', async phase => {
		const value = harness({mode: 'brief', words: 800, failurePhase: phase});
		await value.worker.runOnce();
		const failed = value.jobs.get(value.job.id)!;
		expect(failed).toMatchObject({state: 'failed', errorCode: 'GENERATION_FAILED', retryable: true, attemptCount: 1, failedPhase: phase});
		const frozenBeforeRetry = value.episodes.listEvidence(value.job.runId).map(item => ({id: item.id, hash: item.contentSha256, body: item.body}));

		const retryKey = `retry-${phase}-request`;
		const queued = value.jobs.retry(value.job.id, retryKey);
		expect(value.jobs.retry(value.job.id, retryKey).id).toBe(queued.id);
		await value.worker.runOnce();
		expect(value.jobs.get(value.job.id)).toMatchObject({state: 'complete', attemptCount: 2});
		expect(value.jobs.listAttempts(value.job.id).map(attempt => attempt.outcome)).toEqual(['failed', 'complete']);
		if (frozenBeforeRetry.length > 0) {
			expect(value.episodes.listEvidence(value.job.runId).map(item => ({id: item.id, hash: item.contentSha256, body: item.body}))).toEqual(frozenBeforeRetry);
		}
		for (const table of ['audio_assets', 'briefing_runs'] as const) {
			expect((value.database.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${table === 'briefing_runs' ? 'id' : 'run_id'} = ?`).get(value.job.runId) as {count: number}).count).toBe(1);
		}
		const claimCount = (value.database.prepare('SELECT COUNT(*) AS count FROM transcript_claims WHERE run_id = ?').get(value.job.runId) as {count: number}).count;
		const distinctClaims = (value.database.prepare('SELECT COUNT(DISTINCT id) AS count FROM transcript_claims WHERE run_id = ?').get(value.job.runId) as {count: number}).count;
		expect(claimCount).toBe(distinctClaims);
	});
});
