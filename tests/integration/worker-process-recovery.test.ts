import {spawn} from 'node:child_process';
import type {ChildProcess} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {afterEach, describe, expect, it} from 'vitest';
import {applyMigrations} from '../../server/database/migrations';
import {GenerationJobStore} from '../../server/jobs/generationJobStore';
import {activeJobPhases} from '../../server/jobs/types';
import {insertSource, insertSourceItem} from '../helpers/database';

const roots: string[] = [];
const children = new Set<ChildProcess>();

afterEach(async () => {
	for (const child of children) {
		if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
	}
	children.clear();
	while (roots.length > 0) fs.rmSync(roots.pop()!, {recursive: true, force: true});
});

const waitFor = async (condition: () => boolean, message: string, timeoutMs = 8_000): Promise<void> => {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (condition()) return;
		await new Promise(resolve => setTimeout(resolve, 50));
	}
	throw new Error(message);
};

const waitForExit = (child: ChildProcess, timeoutMs = 3_000): Promise<{code: number | null; signal: NodeJS.Signals | null}> => new Promise((resolve, reject) => {
	if (child.exitCode !== null || child.signalCode !== null) {
		resolve({code: child.exitCode, signal: child.signalCode});
		return;
	}
	const timeout = setTimeout(() => reject(new Error('Worker process did not exit before timeout')), timeoutMs);
	child.once('exit', (code, signal) => {
		clearTimeout(timeout);
		resolve({code, signal});
	});
});

const spawnWorker = (
	databasePath: string,
	mediaPath: string,
	extra: Record<string, string> = {},
): {child: ChildProcess; output: () => string} => {
	let captured = '';
	const child = spawn(process.execPath, ['--import', 'tsx', 'server/testing/worker.ts'], {
		cwd: path.resolve('.'),
		env: {
			...process.env,
			NODE_ENV: 'test',
			LOCALCAST_RUNTIME_MODE: 'test',
			LOCALCAST_PROCESS_ROLE: 'worker',
			DATABASE_PATH: databasePath,
			MEDIA_PATH: mediaPath,
			TEXT_PROVIDER: 'fake',
			SPEECH_PROVIDER: 'fake',
			LOCALCAST_ALLOW_FAKE_PROVIDERS: 'true',
			LOCALCAST_LEASE_MS: '1000',
			LOCALCAST_WORKER_POLL_MS: '25',
			LOCALCAST_SHUTDOWN_MS: '1000',
			...extra,
		},
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	children.add(child);
	child.stdout?.on('data', chunk => { captured += chunk.toString(); });
	child.stderr?.on('data', chunk => { captured += chunk.toString(); });
	child.once('exit', () => children.delete(child));
	return {child, output: () => captured};
};

const createQueuedFixture = () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localcast-worker-recovery-'));
	roots.push(root);
	const databasePath = path.join(root, 'localcast.sqlite');
	const mediaPath = path.join(root, 'media');
	fs.mkdirSync(mediaPath, {recursive: true});
	const database = new Database(databasePath);
	database.pragma('foreign_keys = ON');
	database.pragma('journal_mode = WAL');
	applyMigrations(database);
	insertSource(database);
	insertSourceItem(database, 'source-1');
	const job = new GenerationJobStore(database).enqueue(['source-1']).job;
	database.close();
	return {databasePath, mediaPath, job};
};

const recoverAndAssert = async (
	database: Database.Database,
	databasePath: string,
	mediaPath: string,
	jobId: string,
	runId: string,
	options: {firstOutcome?: 'recovered' | 'interrupted'; waitForLeaseExpiry?: boolean} = {},
): Promise<void> => {
	if (options.waitForLeaseExpiry !== false) {
		const lease = database.prepare('SELECT lease_expires_at FROM generation_jobs WHERE id = ?').get(jobId) as {lease_expires_at: string};
		await waitFor(() => Date.now() > new Date(lease.lease_expires_at).getTime(), 'killed worker lease did not expire', 3_000);
	}
	const recovered = spawnWorker(databasePath, mediaPath, {LOCALCAST_WORKER_ID: 'recovery-worker'});
	await waitFor(() => {
		const row = database.prepare('SELECT state FROM generation_jobs WHERE id = ?').get(jobId) as {state: string};
		return row.state === 'complete';
	}, `recovery worker did not complete job:\n${recovered.output()}`);
	recovered.child.kill('SIGTERM');
	expect((await waitForExit(recovered.child)).code).toBe(0);

	expect(database.prepare('SELECT attempt_number, outcome FROM generation_attempts WHERE job_id = ? ORDER BY attempt_number').all(jobId)).toEqual([
		{attempt_number: 1, outcome: options.firstOutcome || 'recovered'},
		{attempt_number: 2, outcome: 'complete'},
	]);
	expect((database.prepare('SELECT COUNT(*) AS count FROM briefing_sections WHERE run_id = ?').get(runId) as {count: number}).count).toBe(2);
	expect((database.prepare('SELECT COUNT(*) AS count FROM audio_assets WHERE run_id = ?').get(runId) as {count: number}).count).toBe(1);
	expect(fs.readdirSync(mediaPath).filter(name => name.endsWith('.mp3'))).toHaveLength(1);
	expect(fs.readdirSync(mediaPath).filter(name => name.endsWith('.tmp'))).toHaveLength(0);
};

describe('worker process crash recovery', () => {
	it('allows only one independent worker process to claim while later work stays queued', async () => {
		const fixture = createQueuedFixture();
		const database = new Database(fixture.databasePath);
		database.pragma('busy_timeout = 5000');
		new GenerationJobStore(database).enqueue(['source-1']);
		const workers = [
			spawnWorker(fixture.databasePath, fixture.mediaPath, {
				LOCALCAST_WORKER_ID: 'competing-worker-a',
				LOCALCAST_FAKE_PHASE_DELAY_MS: '5000',
				LOCALCAST_FAKE_DELAY_PHASE: 'syncing',
			}),
			spawnWorker(fixture.databasePath, fixture.mediaPath, {
				LOCALCAST_WORKER_ID: 'competing-worker-b',
				LOCALCAST_FAKE_PHASE_DELAY_MS: '5000',
				LOCALCAST_FAKE_DELAY_PHASE: 'syncing',
			}),
		];

		await waitFor(() => (
			(database.prepare("SELECT COUNT(*) AS count FROM generation_jobs WHERE state = 'running'").get() as {count: number}).count === 1
			&& (database.prepare('SELECT COUNT(*) AS count FROM generation_attempts').get() as {count: number}).count === 1
		), `competing workers did not settle on one lease:\n${workers.map(worker => worker.output()).join('\n')}`);
		await new Promise(resolve => setTimeout(resolve, 700));
		expect(database.prepare('SELECT state, COUNT(*) AS count FROM generation_jobs GROUP BY state ORDER BY state').all()).toEqual([
			{state: 'queued', count: 1},
			{state: 'running', count: 1},
		]);
		expect((database.prepare('SELECT COUNT(*) AS count FROM generation_attempts').get() as {count: number}).count).toBe(1);

		for (const worker of workers) worker.child.kill('SIGKILL');
		for (const worker of workers) expect((await waitForExit(worker.child)).signal).toBe('SIGKILL');
		database.close();
	}, 10_000);

	it.each(activeJobPhases)('kills and recovers a worker from persisted phase %s', async phase => {
		const fixture = createQueuedFixture();
		const database = new Database(fixture.databasePath);
		database.pragma('busy_timeout = 5000');
		const first = spawnWorker(fixture.databasePath, fixture.mediaPath, {
			LOCALCAST_WORKER_ID: `crash-${phase}`,
			LOCALCAST_FAKE_PHASE_DELAY_MS: '5000',
			LOCALCAST_FAKE_DELAY_PHASE: phase,
		});

		await waitFor(() => {
			const row = database.prepare('SELECT phase FROM generation_jobs WHERE id = ?').get(fixture.job.id) as {phase: string};
			return row.phase === phase;
		}, `worker did not reach ${phase}:\n${first.output()}`);
		first.child.kill('SIGKILL');
		expect((await waitForExit(first.child)).signal).toBe('SIGKILL');
		await recoverAndAssert(database, fixture.databasePath, fixture.mediaPath, fixture.job.id, fixture.job.runId);
		database.close();
	}, 12_000);

	it('handles SIGTERM during active work, releases the lease, closes SQLite, and recovers', async () => {
		const fixture = createQueuedFixture();
		const database = new Database(fixture.databasePath);
		database.pragma('busy_timeout = 5000');
		const first = spawnWorker(fixture.databasePath, fixture.mediaPath, {
			LOCALCAST_WORKER_ID: 'graceful-shutdown-worker',
			LOCALCAST_FAKE_PHASE_DELAY_MS: '5000',
			LOCALCAST_FAKE_DELAY_PHASE: 'drafting',
		});

		await waitFor(() => {
			const row = database.prepare('SELECT phase FROM generation_jobs WHERE id = ?').get(fixture.job.id) as {phase: string};
			return row.phase === 'drafting';
		}, `worker did not reach drafting:\n${first.output()}`);
		first.child.kill('SIGTERM');
		expect((await waitForExit(first.child)).code).toBe(0);
		expect(database.prepare('SELECT state, phase, lease_owner, lease_expires_at FROM generation_jobs WHERE id = ?').get(fixture.job.id)).toEqual({
			state: 'queued', phase: 'queued', lease_owner: null, lease_expires_at: null,
		});
		expect(database.prepare('PRAGMA quick_check').pluck().get()).toBe('ok');

		await recoverAndAssert(database, fixture.databasePath, fixture.mediaPath, fixture.job.id, fixture.job.runId, {
			firstOutcome: 'interrupted',
			waitForLeaseExpiry: false,
		});
		database.close();
	}, 12_000);

	it('replays idempotently after a crash between output publication and completion', async () => {
		const fixture = createQueuedFixture();
		const database = new Database(fixture.databasePath);
		database.pragma('busy_timeout = 5000');
		const first = spawnWorker(fixture.databasePath, fixture.mediaPath, {
			LOCALCAST_WORKER_ID: 'crash-after-publication',
			LOCALCAST_FAKE_AFTER_PUBLICATION_DELAY_MS: '5000',
		});

		await waitFor(() => (
			(database.prepare('SELECT COUNT(*) AS count FROM audio_assets WHERE run_id = ?').get(fixture.job.runId) as {count: number}).count === 1
		), `worker did not publish fixture output:\n${first.output()}`);
		first.child.kill('SIGKILL');
		expect((await waitForExit(first.child)).signal).toBe('SIGKILL');
		await recoverAndAssert(database, fixture.databasePath, fixture.mediaPath, fixture.job.id, fixture.job.runId);
		database.close();
	}, 12_000);
});
