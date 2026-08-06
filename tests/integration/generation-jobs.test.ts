import {afterEach, describe, expect, it} from 'vitest';
import type Database from 'better-sqlite3';
import {GenerationJobStore, IdempotencyConflictError, JobStateError} from '../../server/jobs/generationJobStore';
import {activeJobPhases} from '../../server/jobs/types';
import type {ActiveJobPhase, GenerationJob} from '../../server/jobs/types';
import {createTestDatabase, insertSource} from '../helpers/database';

const databases: Database.Database[] = [];
const database = (): Database.Database => {
	const value = createTestDatabase();
	databases.push(value);
	return value;
};

afterEach(() => {
	while (databases.length > 0) databases.pop()?.close();
});

const finish = (store: GenerationJobStore, job: GenerationJob, workerId: string): GenerationJob => {
	for (const phase of ['selecting', 'drafting', 'validating', 'rendering_audio'] as ActiveJobPhase[]) {
		store.updatePhase(job.id, workerId, phase, 1_000);
	}
	return store.complete(job.id, workerId);
};

describe('durable generation queue', () => {
	it('deduplicates enqueue by idempotency key and rejects a conflicting payload', () => {
		const db = database();
		insertSource(db, 'source-a');
		insertSource(db, 'source-b');
		const store = new GenerationJobStore(db);

		const first = store.enqueue(['source-a'], 'idempotency-key-0001');
		const replay = store.enqueue(['source-a'], 'idempotency-key-0001');

		expect(first.created).toBe(true);
		expect(replay.created).toBe(false);
		expect(replay.job.id).toBe(first.job.id);
		expect(store.count()).toBe(1);
		expect(() => store.enqueue(['source-b'], 'idempotency-key-0001')).toThrow(IdempotencyConflictError);
	});

	it('allows one active lease and preserves FIFO order for later jobs', () => {
		const db = database();
		insertSource(db);
		const storeA = new GenerationJobStore(db);
		const storeB = new GenerationJobStore(db);
		const queued = [storeA.enqueue(['source-1']).job, storeA.enqueue(['source-1']).job, storeA.enqueue(['source-1']).job];

		const first = storeA.claimNext('worker-a', 1_000);
		expect(first?.id).toBe(queued[0]?.id);
		expect(storeB.claimNext('worker-b', 1_000)).toBeUndefined();
		expect((db.prepare("SELECT COUNT(*) AS count FROM generation_jobs WHERE state = 'running'").get() as {count: number}).count).toBe(1);

		finish(storeA, first!, 'worker-a');
		const second = storeB.claimNext('worker-b', 1_000);
		expect(second?.id).toBe(queued[1]?.id);
		finish(storeB, second!, 'worker-b');
		expect(storeA.claimNext('worker-a', 1_000)?.id).toBe(queued[2]?.id);
	});

	it('persists every ordered phase and exactly one terminal event', () => {
		const db = database();
		insertSource(db);
		const store = new GenerationJobStore(db);
		const queued = store.enqueue(['source-1']).job;
		const claimed = store.claimNext('worker-a', 1_000)!;
		finish(store, claimed, 'worker-a');

		expect(store.listEvents(queued.id).map(event => event.phase)).toEqual([
			'queued', 'syncing', 'selecting', 'drafting', 'validating', 'rendering_audio', 'complete',
		]);
		expect(store.listEvents(queued.id).filter(event => event.phase === 'complete' || event.phase === 'failed')).toHaveLength(1);
		expect(() => store.updatePhase(queued.id, 'worker-a', 'selecting', 1_000)).toThrow(JobStateError);
	});

	it.each(activeJobPhases)('recovers an expired lease from %s and retains attempt history', targetPhase => {
		const db = database();
		insertSource(db);
		let currentTime = Date.parse('2026-08-05T12:00:00.000Z');
		const store = new GenerationJobStore(db, () => new Date(currentTime).toISOString());
		const queued = store.enqueue(['source-1']).job;
		const claimed = store.claimNext('worker-before-crash', 1_000)!;

		for (const phase of activeJobPhases.slice(1)) {
			if (activeJobPhases.indexOf(phase) > activeJobPhases.indexOf(targetPhase)) break;
			store.updatePhase(claimed.id, 'worker-before-crash', phase, 1_000);
		}

		currentTime += 1_001;
		expect(store.recoverStale()).toBe(1);
		expect(store.get(queued.id)).toMatchObject({state: 'queued', phase: 'queued', attemptCount: 1});
		expect(store.listAttempts(queued.id)).toMatchObject([{attemptNumber: 1, outcome: 'recovered', errorCode: 'STALE_LEASE'}]);

		const reclaimed = store.claimNext('worker-after-crash', 1_000)!;
		expect(reclaimed).toMatchObject({state: 'running', phase: 'syncing', attemptCount: 2, leaseOwner: 'worker-after-crash'});
	});

	it('makes retry and repeated claim safe', () => {
		const db = database();
		insertSource(db);
		const store = new GenerationJobStore(db);
		const job = store.enqueue(['source-1']).job;
		store.claimNext('worker-a', 1_000);
		store.fail(job.id, 'worker-a', {code: 'TEMPORARY_PROVIDER_FAILURE', message: 'Try again later', retryable: true});

		const firstRetry = store.retry(job.id, 'retry-request-0001');
		const repeatedRetry = store.retry(job.id, 'retry-request-0001');
		expect(repeatedRetry.id).toBe(firstRetry.id);
		expect(store.listAttempts(job.id)).toHaveLength(1);
		const retried = store.claimNext('worker-b', 1_000)!;
		expect(retried).toMatchObject({id: job.id, attemptCount: 2});
		expect(store.retry(job.id, 'retry-request-0001')).toMatchObject({id: job.id, state: 'running', attemptCount: 2});
		expect(store.claimNext('worker-c', 1_000)).toBeUndefined();
		finish(store, retried, 'worker-b');
		expect(store.retry(job.id, 'retry-request-0001')).toMatchObject({id: job.id, state: 'complete', attemptCount: 2});
		expect(store.listAttempts(job.id)).toHaveLength(2);
	});

	it('does not turn a replayed retry request into a third attempt after attempt two fails', () => {
		const db = database();
		insertSource(db);
		const store = new GenerationJobStore(db);
		const job = store.enqueue(['source-1']).job;
		store.claimNext('worker-a', 1_000);
		store.fail(job.id, 'worker-a', {code: 'TEMPORARY_FAILURE', message: 'Try again', retryable: true});
		store.retry(job.id, 'retry-request-original');
		store.claimNext('worker-b', 1_000);
		store.fail(job.id, 'worker-b', {code: 'TEMPORARY_FAILURE', message: 'Try again', retryable: true});

		expect(store.retry(job.id, 'retry-request-original')).toMatchObject({state: 'failed', attemptCount: 2});
		expect(store.get(job.id)).toMatchObject({state: 'failed', attemptCount: 2});
		expect(store.retry(job.id, 'retry-request-new-action')).toMatchObject({state: 'queued', attemptCount: 2});
		expect(store.claimNext('worker-c', 1_000)).toMatchObject({attemptCount: 3});
	});

	it('fails malformed persisted payloads safely and continues FIFO work', () => {
		const db = database();
		insertSource(db);
		const store = new GenerationJobStore(db);
		const malformed = store.enqueue(['source-1']).job;
		const valid = store.enqueue(['source-1']).job;
		db.prepare('UPDATE generation_jobs SET payload_json = ? WHERE id = ?').run('{not-json', malformed.id);

		expect(store.claimNext('worker-a', 1_000)?.id).toBe(valid.id);
		const malformedRow = db.prepare('SELECT state, phase, error_code, error_message FROM generation_jobs WHERE id = ?').get(malformed.id);
		expect(malformedRow).toEqual({state: 'failed', phase: 'failed', error_code: 'INVALID_JOB_PAYLOAD', error_message: 'Persisted job data is invalid'});
	});
});
