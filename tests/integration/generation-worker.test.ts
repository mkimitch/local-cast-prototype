import {afterEach, describe, expect, it, vi} from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {GenerationJobStore} from '../../server/jobs/generationJobStore';
import {GenerationWorker} from '../../server/jobs/generationWorker';
import type {GenerationProcessor} from '../../server/jobs/generationProcessor';
import {GenerationError} from '../../server/jobs/types';
import {applyMigrations} from '../../server/database/migrations';
import {createTestDatabase, insertSource, testConfig} from '../helpers/database';

const databases: Database.Database[] = [];
const temporaryRoots: string[] = [];
const setup = () => {
	const database = createTestDatabase();
	databases.push(database);
	insertSource(database);
	const jobs = new GenerationJobStore(database);
	const job = jobs.enqueue(['source-1']).job;
	return {database, jobs, job};
};

afterEach(() => {
	while (databases.length > 0) databases.pop()?.close();
	while (temporaryRoots.length > 0) fs.rmSync(temporaryRoots.pop()!, {recursive: true, force: true});
});

describe('generation worker', () => {
	it('executes one claimed job through the durable pipeline', async () => {
		const {jobs, job} = setup();
		const processor: GenerationProcessor = {
			process: async (claimed, workerId) => {
				jobs.updatePhase(claimed.id, workerId, 'selecting', 1_000);
				jobs.updatePhase(claimed.id, workerId, 'drafting', 1_000);
				jobs.updatePhase(claimed.id, workerId, 'validating', 1_000);
				jobs.updatePhase(claimed.id, workerId, 'rendering_audio', 1_000);
				jobs.complete(claimed.id, workerId);
			},
		};
		const worker = new GenerationWorker(testConfig(), jobs, processor);

		expect(await worker.runOnce()).toBe(true);
		expect(jobs.get(job.id)).toMatchObject({state: 'complete', phase: 'complete', attemptCount: 1});
		expect(jobs.listAttempts(job.id)).toMatchObject([{outcome: 'complete'}]);
	});

	it('redacts unexpected provider/source details from persisted failures and logs', async () => {
		const {database, jobs, job} = setup();
		const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const processor: GenerationProcessor = {
			process: async () => {
				throw new Error('secret-canary source-canary provider-body-canary /private/path-canary');
			},
		};
		const worker = new GenerationWorker(testConfig(), jobs, processor);

		await worker.runOnce();

		expect(jobs.get(job.id)).toMatchObject({
			state: 'failed',
			errorCode: 'GENERATION_FAILED',
			errorMessage: 'Generation failed safely; use the diagnostic reference for server review',
			retryable: true,
		});
		const persisted = JSON.stringify({
			job: jobs.get(job.id),
			attempts: jobs.listAttempts(job.id),
			events: jobs.listEvents(job.id),
			runs: database.prepare('SELECT * FROM briefing_runs').all(),
		});
		expect(persisted).not.toMatch(/secret-canary|source-canary|provider-body-canary|private\/path-canary/);
		expect(errorLog.mock.calls.flat().join(' ')).not.toMatch(/secret-canary|source-canary|provider-body-canary|private\/path-canary/);
	});

	it('persists typed safe provider failures without exposing arbitrary data', async () => {
		const {jobs, job} = setup();
		const processor: GenerationProcessor = {
			process: async () => {
				throw new GenerationError('PROVIDER_TIMEOUT', 'The configured provider timed out', true);
			},
		};
		const worker = new GenerationWorker(testConfig(), jobs, processor);

		await worker.runOnce();
		expect(jobs.get(job.id)).toMatchObject({errorCode: 'PROVIDER_TIMEOUT', errorMessage: 'The configured provider timed out', retryable: true});
	});

	it('releases an active lease when stopped', async () => {
		const {jobs, job} = setup();
		let started!: () => void;
		const didStart = new Promise<void>(resolve => { started = resolve; });
		const processor: GenerationProcessor = {
			process: async (_claimed, _workerId, signal) => {
				started();
				await new Promise<void>((_resolve, reject) => {
					signal.addEventListener('abort', () => reject(new DOMException('Worker stopped', 'AbortError')), {once: true});
				});
			},
		};
		const worker = new GenerationWorker(testConfig(), jobs, processor);
		const running = worker.runOnce();
		await didStart;

		await worker.stop();
		await running;

		expect(jobs.get(job.id)).toMatchObject({state: 'queued', phase: 'queued', attemptCount: 1});
		expect(jobs.listAttempts(job.id)).toMatchObject([{outcome: 'interrupted', errorCode: 'WORKER_STOPPED'}]);
	});

	it('stops promptly while polling an empty queue', async () => {
		const database = createTestDatabase();
		databases.push(database);
		const jobs = new GenerationJobStore(database);
		const processor: GenerationProcessor = {process: async () => undefined};
		const worker = new GenerationWorker(testConfig({workerPollMs: 60_000}), jobs, processor);
		const running = worker.start();
		await new Promise(resolve => setTimeout(resolve, 20));

		await worker.stop();
		await expect(Promise.race([
			running.then(() => 'stopped'),
			new Promise(resolve => setTimeout(() => resolve('timeout'), 500)),
		])).resolves.toBe('stopped');
	});

	it('heartbeats a blocked phase so a competing connection cannot recover live work', async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localcast-heartbeat-test-'));
		temporaryRoots.push(root);
		const databasePath = path.join(root, 'jobs.sqlite');
		const databaseA = new Database(databasePath);
		databaseA.pragma('foreign_keys = ON');
		databaseA.pragma('journal_mode = WAL');
		applyMigrations(databaseA);
		const databaseB = new Database(databasePath);
		databaseB.pragma('foreign_keys = ON');
		databaseB.pragma('busy_timeout = 5000');
		databases.push(databaseA, databaseB);
		insertSource(databaseA);
		const jobsA = new GenerationJobStore(databaseA);
		const jobsB = new GenerationJobStore(databaseB);
		const job = jobsA.enqueue(['source-1']).job;
		let release!: () => void;
		let started!: () => void;
		const blocked = new Promise<void>(resolve => { release = resolve; });
		const didStart = new Promise<void>(resolve => { started = resolve; });
		const processor: GenerationProcessor = {
			process: async (claimed, workerId) => {
				started();
				await blocked;
				jobsA.updatePhase(claimed.id, workerId, 'selecting', 1_000);
				jobsA.updatePhase(claimed.id, workerId, 'drafting', 1_000);
				jobsA.updatePhase(claimed.id, workerId, 'validating', 1_000);
				jobsA.updatePhase(claimed.id, workerId, 'rendering_audio', 1_000);
				jobsA.complete(claimed.id, workerId);
			},
		};
		const worker = new GenerationWorker(testConfig({workerId: 'heartbeat-worker', leaseMs: 1_000}), jobsA, processor);
		const running = worker.runOnce();
		await didStart;
		await new Promise(resolve => setTimeout(resolve, 1_300));

		expect(jobsB.claimNext('competing-worker', 1_000)).toBeUndefined();
		expect(jobsA.get(job.id)).toMatchObject({state: 'running', leaseOwner: 'heartbeat-worker', attemptCount: 1});
		release();
		await running;
		expect(jobsA.get(job.id)).toMatchObject({state: 'complete', attemptCount: 1});
	});
});
