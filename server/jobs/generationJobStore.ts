import Database from 'better-sqlite3';
import {randomUUID} from 'node:crypto';
import {activeJobPhases, generationJobPayloadSchema} from './types';
import type {ActiveJobPhase, GenerationJob, GenerationJobPayload, JobAttempt, JobEvent, JobPhase} from './types';

type JobRow = {
	id: string;
	run_id: string;
	idempotency_key: string | null;
	payload_version: number;
	payload_json: string;
	state: GenerationJob['state'];
	phase: JobPhase;
	attempt_count: number;
	lease_owner: string | null;
	lease_expires_at: string | null;
	error_code: string | null;
	error_message: string | null;
	retryable: number;
	created_at: string;
	updated_at: string;
	started_at: string | null;
	completed_at: string | null;
};

type AttemptRow = {
	id: string;
	job_id: string;
	attempt_number: number;
	worker_id: string;
	started_at: string;
	finished_at: string | null;
	outcome: JobAttempt['outcome'];
	error_code: string | null;
	error_message: string | null;
};

type EventRow = {
	id: number;
	job_id: string;
	attempt_number: number | null;
	phase: JobPhase;
	detail: string | null;
	created_at: string;
};

export class IdempotencyConflictError extends Error {
	constructor() {
		super('The idempotency key was already used with a different request');
		this.name = 'IdempotencyConflictError';
	}
}

export class JobStateError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'JobStateError';
	}
}

const safeMessage = (value: string): string => value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 240);

const addMilliseconds = (iso: string, milliseconds: number): string => new Date(new Date(iso).getTime() + milliseconds).toISOString();

const nextPhase = (phase: JobPhase): ActiveJobPhase | undefined => {
	const index = activeJobPhases.indexOf(phase as ActiveJobPhase);
	return index >= 0 ? activeJobPhases[index + 1] : undefined;
};

export class GenerationJobStore {
	constructor(
		private readonly database: Database.Database,
		private readonly now: () => string = () => new Date().toISOString(),
		private readonly createId: () => string = randomUUID,
	) {}

	enqueue(sourceIds: string[], idempotencyKey?: string): {job: GenerationJob; created: boolean} {
		const uniqueSourceIds = [...new Set(sourceIds)];
		const enqueue = this.database.transaction(() => {
			if (idempotencyKey) {
				const existing = this.database.prepare('SELECT * FROM generation_jobs WHERE idempotency_key = ?').get(idempotencyKey) as JobRow | undefined;
				if (existing) {
					const job = this.fromRow(existing);
					if (JSON.stringify(job.payload.sourceIds) !== JSON.stringify(uniqueSourceIds)) throw new IdempotencyConflictError();
					return {job, created: false};
				}
			}

			const existingSources = uniqueSourceIds.length === 0
				? 0
				: (this.database.prepare(`SELECT COUNT(*) AS count FROM sources WHERE type = 'rss' AND is_active = 1 AND id IN (${uniqueSourceIds.map(() => '?').join(', ')})`).get(...uniqueSourceIds) as {count: number}).count;
			if (existingSources !== uniqueSourceIds.length) throw new JobStateError('One or more selected active RSS sources do not exist');

			const timestamp = this.now();
			const runId = `run-${this.createId()}`;
			const jobId = `job-${this.createId()}`;
			const payload: GenerationJobPayload = {version: 1, sourceIds: uniqueSourceIds, requestedAt: timestamp};

			this.database.prepare(`
				INSERT INTO briefing_runs (id, title, status, created_at, completed_at, summary)
				VALUES (?, ?, 'queued', ?, NULL, NULL)
			`).run(runId, `Briefing - ${timestamp.slice(0, 10)}`, timestamp);

			const insertSource = this.database.prepare('INSERT INTO briefing_run_sources (run_id, source_id) VALUES (?, ?)');
			for (const sourceId of uniqueSourceIds) insertSource.run(runId, sourceId);

			this.database.prepare(`
				INSERT INTO generation_jobs (
					id, run_id, idempotency_key, payload_version, payload_json, state, phase,
					attempt_count, retryable, created_at, updated_at
				) VALUES (?, ?, ?, 1, ?, 'queued', 'queued', 0, 0, ?, ?)
			`).run(jobId, runId, idempotencyKey ?? null, JSON.stringify(payload), timestamp, timestamp);
			this.insertEvent(jobId, undefined, 'queued', 'Queued by explicit user action', timestamp);

			return {job: this.get(jobId)!, created: true};
		});

		return enqueue.immediate();
	}

	claimNext(workerId: string, leaseMs: number): GenerationJob | undefined {
		const claim = this.database.transaction(() => {
			const timestamp = this.now();
			this.recoverStaleWithinTransaction(timestamp);
			const active = this.database.prepare("SELECT id FROM generation_jobs WHERE state = 'running' LIMIT 1").get();
			if (active) return undefined;

			while (true) {
				const row = this.database.prepare("SELECT * FROM generation_jobs WHERE state = 'queued' ORDER BY datetime(created_at), rowid LIMIT 1").get() as JobRow | undefined;
				if (!row) return undefined;

				let rawPayload: unknown;
				try {
					rawPayload = JSON.parse(row.payload_json) as unknown;
				} catch {
					this.failMalformedQueuedJob(row, timestamp);
					continue;
				}

				const payload = generationJobPayloadSchema.safeParse(rawPayload);
				if (!payload.success || row.payload_version !== 1) {
					this.failMalformedQueuedJob(row, timestamp);
					continue;
				}

				const attemptNumber = row.attempt_count + 1;
				const leaseExpiresAt = addMilliseconds(timestamp, leaseMs);
				const updated = this.database.prepare(`
					UPDATE generation_jobs
					SET state = 'running', phase = 'syncing', attempt_count = ?, lease_owner = ?, lease_expires_at = ?,
						started_at = COALESCE(started_at, ?), updated_at = ?, completed_at = NULL,
						error_code = NULL, error_message = NULL, retryable = 0
					WHERE id = ? AND state = 'queued'
				`).run(attemptNumber, workerId, leaseExpiresAt, timestamp, timestamp, row.id);
				if (updated.changes !== 1) continue;

				this.database.prepare(`
					INSERT INTO generation_attempts (id, job_id, attempt_number, worker_id, started_at, outcome)
					VALUES (?, ?, ?, ?, ?, 'running')
				`).run(`attempt-${this.createId()}`, row.id, attemptNumber, workerId, timestamp);
				this.database.prepare("UPDATE briefing_runs SET status = 'syncing', completed_at = NULL WHERE id = ?").run(row.run_id);
				this.insertEvent(row.id, attemptNumber, 'syncing', 'Worker claimed job', timestamp);
				return this.get(row.id);
			}
		});

		return claim.immediate();
	}

	updatePhase(jobId: string, workerId: string, phase: ActiveJobPhase, leaseMs: number): GenerationJob {
		const update = this.database.transaction(() => {
			const current = this.requireOwnedRunningJob(jobId, workerId);
			if (phase !== nextPhase(current.phase)) throw new JobStateError(`Cannot move job from ${current.phase} to ${phase}`);

			const timestamp = this.now();
			this.database.prepare(`
				UPDATE generation_jobs SET phase = ?, updated_at = ?, lease_expires_at = ? WHERE id = ?
			`).run(phase, timestamp, addMilliseconds(timestamp, leaseMs), jobId);
			this.database.prepare('UPDATE briefing_runs SET status = ? WHERE id = ?').run(phase, current.runId);
			this.insertEvent(jobId, current.attemptCount, phase, undefined, timestamp);
			return this.get(jobId)!;
		});

		return update.immediate();
	}

	renewLease(jobId: string, workerId: string, leaseMs: number): GenerationJob {
		const renew = this.database.transaction(() => {
			const current = this.requireOwnedRunningJob(jobId, workerId);
			const timestamp = this.now();
			const updated = this.database.prepare(`
				UPDATE generation_jobs
				SET lease_expires_at = ?, updated_at = ?
				WHERE id = ? AND state = 'running' AND lease_owner = ? AND attempt_count = ?
			`).run(addMilliseconds(timestamp, leaseMs), timestamp, jobId, workerId, current.attemptCount);
			if (updated.changes !== 1) throw new JobStateError('Worker lost its generation lease');
			return this.get(jobId)!;
		});

		return renew.immediate();
	}

	complete(jobId: string, workerId: string): GenerationJob {
		const complete = this.database.transaction(() => {
			const current = this.requireOwnedRunningJob(jobId, workerId);
			if (current.phase !== 'rendering_audio') throw new JobStateError('Only a rendered job can complete');

			const timestamp = this.now();
			this.database.prepare(`
				UPDATE generation_jobs
				SET state = 'complete', phase = 'complete', lease_owner = NULL, lease_expires_at = NULL,
					updated_at = ?, completed_at = ?, retryable = 0
				WHERE id = ?
			`).run(timestamp, timestamp, jobId);
			this.database.prepare("UPDATE briefing_runs SET status = 'complete', completed_at = ? WHERE id = ?").run(timestamp, current.runId);
			this.finishAttempt(current, 'complete', timestamp);
			this.insertEvent(jobId, current.attemptCount, 'complete', undefined, timestamp);
			return this.get(jobId)!;
		});

		return complete.immediate();
	}

	fail(jobId: string, workerId: string, failure: {code: string; message: string; retryable: boolean}): GenerationJob {
		const fail = this.database.transaction(() => {
			const current = this.requireOwnedRunningJob(jobId, workerId);
			const timestamp = this.now();
			const message = safeMessage(failure.message);
			const code = safeMessage(failure.code).replace(/[^A-Z0-9_]/g, '_') || 'GENERATION_FAILED';

			this.database.prepare(`
				UPDATE generation_jobs
				SET state = 'failed', phase = 'failed', lease_owner = NULL, lease_expires_at = NULL,
					updated_at = ?, completed_at = ?, error_code = ?, error_message = ?, retryable = ?
				WHERE id = ?
			`).run(timestamp, timestamp, code, message, failure.retryable ? 1 : 0, jobId);
			this.database.prepare("UPDATE briefing_runs SET status = 'failed', completed_at = ?, summary = NULL WHERE id = ?").run(timestamp, current.runId);
			this.finishAttempt(current, 'failed', timestamp, code, message);
			this.insertEvent(jobId, current.attemptCount, 'failed', code, timestamp);
			return this.get(jobId)!;
		});

		return fail.immediate();
	}

	interrupt(jobId: string, workerId: string): GenerationJob {
		const interrupt = this.database.transaction(() => {
			const current = this.requireOwnedRunningJob(jobId, workerId);
			const timestamp = this.now();
			this.database.prepare(`
				UPDATE generation_jobs
				SET state = 'queued', phase = 'queued', lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
				WHERE id = ?
			`).run(timestamp, jobId);
			this.database.prepare("UPDATE briefing_runs SET status = 'queued' WHERE id = ?").run(current.runId);
			this.finishAttempt(current, 'interrupted', timestamp, 'WORKER_STOPPED', 'Worker stopped before completion');
			this.insertEvent(jobId, current.attemptCount, 'queued', 'Worker released job during shutdown', timestamp);
			return this.get(jobId)!;
		});

		return interrupt.immediate();
	}

	retry(jobId: string): GenerationJob {
		const retry = this.database.transaction(() => {
			const current = this.get(jobId);
			if (!current) throw new JobStateError('Job not found');
			if (current.state === 'queued') return current;
			if (current.state !== 'failed' || !current.retryable) throw new JobStateError('Job is not retryable');

			const timestamp = this.now();
			this.database.prepare(`
				UPDATE generation_jobs
				SET state = 'queued', phase = 'queued', error_code = NULL, error_message = NULL,
					retryable = 0, completed_at = NULL, updated_at = ?
				WHERE id = ?
			`).run(timestamp, jobId);
			this.database.prepare("UPDATE briefing_runs SET status = 'queued', completed_at = NULL WHERE id = ?").run(current.runId);
			this.insertEvent(jobId, current.attemptCount, 'queued', 'Retry requested', timestamp);
			return this.get(jobId)!;
		});

		return retry.immediate();
	}

	recoverStale(): number {
		const recover = this.database.transaction(() => this.recoverStaleWithinTransaction(this.now()));
		return recover.immediate();
	}

	get(id: string): GenerationJob | undefined {
		const row = this.database.prepare('SELECT * FROM generation_jobs WHERE id = ?').get(id) as JobRow | undefined;
		return row ? this.fromRow(row) : undefined;
	}

	getByRunId(runId: string): GenerationJob | undefined {
		const row = this.database.prepare('SELECT * FROM generation_jobs WHERE run_id = ?').get(runId) as JobRow | undefined;
		return row ? this.fromRow(row) : undefined;
	}

	listEvents(jobId: string): JobEvent[] {
		const rows = this.database.prepare('SELECT * FROM generation_job_events WHERE job_id = ? ORDER BY id').all(jobId) as EventRow[];
		return rows.map(row => ({
			id: row.id,
			jobId: row.job_id,
			attemptNumber: row.attempt_number ?? undefined,
			phase: row.phase,
			detail: row.detail ?? undefined,
			createdAt: row.created_at,
		}));
	}

	listAttempts(jobId: string): JobAttempt[] {
		const rows = this.database.prepare('SELECT * FROM generation_attempts WHERE job_id = ? ORDER BY attempt_number').all(jobId) as AttemptRow[];
		return rows.map(row => ({
			id: row.id,
			jobId: row.job_id,
			attemptNumber: row.attempt_number,
			workerId: row.worker_id,
			startedAt: row.started_at,
			finishedAt: row.finished_at ?? undefined,
			outcome: row.outcome,
			errorCode: row.error_code ?? undefined,
			errorMessage: row.error_message ?? undefined,
		}));
	}

	count(): number {
		return (this.database.prepare('SELECT COUNT(*) AS count FROM generation_jobs').get() as {count: number}).count;
	}

	private fromRow(row: JobRow): GenerationJob {
		let rawPayload: unknown;
		try {
			rawPayload = JSON.parse(row.payload_json) as unknown;
		} catch {
			throw new JobStateError('Persisted generation job payload is invalid');
		}

		const payload = generationJobPayloadSchema.safeParse(rawPayload);
		if (!payload.success || row.payload_version !== 1) throw new JobStateError('Persisted generation job payload is invalid');

		return {
			id: row.id,
			runId: row.run_id,
			idempotencyKey: row.idempotency_key ?? undefined,
			payload: payload.data,
			state: row.state,
			phase: row.phase,
			attemptCount: row.attempt_count,
			leaseOwner: row.lease_owner ?? undefined,
			leaseExpiresAt: row.lease_expires_at ?? undefined,
			errorCode: row.error_code ?? undefined,
			errorMessage: row.error_message ?? undefined,
			retryable: row.retryable === 1,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
			startedAt: row.started_at ?? undefined,
			completedAt: row.completed_at ?? undefined,
		};
	}

	private requireOwnedRunningJob(jobId: string, workerId: string): GenerationJob {
		const current = this.get(jobId);
		if (!current || current.state !== 'running' || current.leaseOwner !== workerId) {
			throw new JobStateError('Worker does not own this running job');
		}
		return current;
	}

	private finishAttempt(job: GenerationJob, outcome: JobAttempt['outcome'], timestamp: string, errorCode?: string, errorMessage?: string): void {
		this.database.prepare(`
			UPDATE generation_attempts
			SET finished_at = ?, outcome = ?, error_code = ?, error_message = ?
			WHERE job_id = ? AND attempt_number = ? AND outcome = 'running'
		`).run(timestamp, outcome, errorCode ?? null, errorMessage ?? null, job.id, job.attemptCount);
	}

	private insertEvent(jobId: string, attemptNumber: number | undefined, phase: JobPhase, detail: string | undefined, timestamp: string): void {
		this.database.prepare(`
			INSERT INTO generation_job_events (job_id, attempt_number, phase, detail, created_at)
			VALUES (?, ?, ?, ?, ?)
		`).run(jobId, attemptNumber ?? null, phase, detail ?? null, timestamp);
	}

	private recoverStaleWithinTransaction(timestamp: string): number {
		const staleRows = this.database.prepare(`
			SELECT * FROM generation_jobs
			WHERE state = 'running' AND lease_expires_at <= ?
			ORDER BY datetime(created_at), rowid
		`).all(timestamp) as JobRow[];

		for (const row of staleRows) {
			const current = this.fromRow(row);
			this.database.prepare(`
				UPDATE generation_jobs
				SET state = 'queued', phase = 'queued', lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
				WHERE id = ?
			`).run(timestamp, current.id);
			this.database.prepare("UPDATE briefing_runs SET status = 'queued' WHERE id = ?").run(current.runId);
			this.finishAttempt(current, 'recovered', timestamp, 'STALE_LEASE', 'Recovered after worker lease expired');
			this.insertEvent(current.id, current.attemptCount, 'queued', 'Recovered expired worker lease', timestamp);
		}

		return staleRows.length;
	}

	private failMalformedQueuedJob(row: JobRow, timestamp: string): void {
		this.database.prepare(`
			UPDATE generation_jobs
			SET state = 'failed', phase = 'failed', error_code = 'INVALID_JOB_PAYLOAD',
				error_message = 'Persisted job data is invalid', retryable = 0, updated_at = ?, completed_at = ?
			WHERE id = ?
		`).run(timestamp, timestamp, row.id);
		this.database.prepare("UPDATE briefing_runs SET status = 'failed', completed_at = ?, summary = NULL WHERE id = ?").run(timestamp, row.run_id);
		this.insertEvent(row.id, row.attempt_count || undefined, 'failed', 'INVALID_JOB_PAYLOAD', timestamp);
	}
}
