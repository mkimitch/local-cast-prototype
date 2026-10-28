import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {applyMigrationPlan, applyMigrations, migrationIds, migrationPlanThrough} from '../../server/database/migrations';
import type {Migration} from '../../server/database/migrations';
import {GenerationJobStore} from '../../server/jobs/generationJobStore';
import {installFrozenMigrationSnapshot} from '../fixtures/migrationSnapshots';
import {insertGroundedEpisode} from '../helpers/chat';

const databases: Database.Database[] = [];
const roots: string[] = [];
const database = (): Database.Database => {
	const value = new Database(':memory:');
	value.pragma('foreign_keys = ON');
	databases.push(value);
	return value;
};

const reserveMigrationProviderCall = (
	db: Database.Database,
	options: {
		id: string;
		turnId: string;
		attemptNumber?: number;
		stage?: 'draft' | 'support';
		workerId?: string;
		timestamp: string;
	},
): void => {
	db.prepare(`
		INSERT INTO chat_provider_calls (
			id, turn_id, attempt_number, stage, model, worker_id, status, reserved_at, updated_at
		) VALUES (?, ?, ?, ?, 'gpt-5.4-mini-2026-03-17', ?, 'reserved', ?, ?)
	`).run(
		options.id,
		options.turnId,
		options.attemptNumber ?? 1,
		options.stage ?? 'draft',
		options.workerId ?? 'worker',
		options.timestamp,
		options.timestamp,
	);
};

const receiveMigrationProviderCall = (
	db: Database.Database,
	id: string,
	timestamp: string,
	usage: {
		inputTokens?: number;
		cachedInputTokens?: number;
		outputTokens?: number;
		reasoningOutputTokens?: number;
		providerRequestId?: string;
	} = {},
): void => {
	db.prepare(`
		UPDATE chat_provider_calls
		SET status = 'response_received', safe_outcome = 'response_received',
			input_tokens = ?, cached_input_tokens = ?, output_tokens = ?, reasoning_output_tokens = ?,
			provider_request_id = ?, response_received_at = ?, updated_at = ?
		WHERE id = ?
	`).run(
		usage.inputTokens ?? null,
		usage.cachedInputTokens ?? null,
		usage.outputTokens ?? null,
		usage.reasoningOutputTokens ?? null,
		usage.providerRequestId ?? null,
		timestamp,
		timestamp,
		id,
	);
};

const finalizeMigrationProviderCall = (
	db: Database.Database,
	id: string,
	outcome: string,
	timestamp: string,
): void => {
	receiveMigrationProviderCall(db, id, timestamp);
	db.prepare(`
		UPDATE chat_provider_calls
		SET status = 'finalized', safe_outcome = ?, completed_at = ?, updated_at = ?
		WHERE id = ?
	`).run(outcome, timestamp, timestamp, id);
};

const makeMigrationProviderCallAmbiguous = (
	db: Database.Database,
	id: string,
	outcome: 'timeout' | 'network_failure' | 'cancelled',
	timestamp: string,
): void => {
	db.prepare(`
		UPDATE chat_provider_calls
		SET status = 'ambiguous', safe_outcome = ?, completed_at = ?, updated_at = ?
		WHERE id = ?
	`).run(outcome, timestamp, timestamp, id);
};

const insertMigrationRunningTurn = (
	db: Database.Database,
	options: {
		runId: string;
		turnId: string;
		idempotencyKey: string;
		enqueueOrder: number;
		timestamp: string;
		workerId?: string;
		attemptNumber?: number;
	},
): void => {
	const workerId = options.workerId ?? 'worker';
	const attemptNumber = options.attemptNumber ?? 1;
	db.prepare(`
		INSERT INTO chat_turns (
			id, run_id, idempotency_key, enqueue_order, question, state, episode_lock,
			attempt_count, lease_owner, lease_expires_at, retryable,
			created_at, updated_at, started_at
		) VALUES (?, ?, ?, ?, 'Synthetic migration integrity question?', 'running', 1,
			?, ?, '2026-08-07T12:10:00.000Z', 0, ?, ?, ?)
	`).run(
		options.turnId,
		options.runId,
		options.idempotencyKey,
		options.enqueueOrder,
		attemptNumber,
		workerId,
		options.timestamp,
		options.timestamp,
		options.timestamp,
	);
	db.prepare(`
		INSERT INTO chat_attempts (id, turn_id, attempt_number, worker_id, started_at, outcome)
		VALUES (?, ?, ?, ?, ?, 'running')
	`).run(`attempt-${options.turnId}-${attemptNumber}`, options.turnId, attemptNumber, workerId, options.timestamp);
};

const failMigrationTurn = (
	db: Database.Database,
	turnId: string,
	timestamp: string,
	attemptOutcome: 'failed' | 'interrupted' | 'recovered' = 'failed',
): void => {
	db.prepare(`
		UPDATE chat_turns
		SET state = 'failed', lease_owner = NULL, lease_expires_at = NULL,
			error_code = 'SYNTHETIC_FAILURE', error_message = 'Synthetic failure',
			retryable = 0, updated_at = ?, completed_at = ?
		WHERE id = ?
	`).run(timestamp, timestamp, turnId);
		db.prepare(`
			UPDATE chat_attempts
		SET finished_at = ?, outcome = ?, error_code = 'SYNTHETIC_FAILURE',
			error_message = 'Synthetic failure'
		WHERE turn_id = ? AND outcome = 'running'
	`).run(timestamp, attemptOutcome, turnId);
};

afterEach(() => {
	while (databases.length > 0) databases.pop()?.close();
	while (roots.length > 0) fs.rmSync(roots.pop()!, {recursive: true, force: true});
});

describe('additive migration history', () => {
	it('migrates an empty database exactly once', () => {
		const db = database();
		applyMigrations(db);
		applyMigrations(db);

		const applied = db.prepare('SELECT id FROM schema_migrations ORDER BY rowid').all() as Array<{id: string}>;
		expect(applied.map(row => row.id)).toEqual(migrationIds);
		expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'generation_jobs'").get()).toBeTruthy();
	});

	it('adds Standard defaults for existing stations and immutable generation requests', () => {
		const db = database();
		applyMigrationPlan(db, migrationPlanThrough('008_episode_grounded_chat'));
		const timestamp = '2026-10-12T12:00:00.000Z';
		db.prepare(`
			INSERT INTO stations (id, revision, name, topic_instruction, default_mode, created_at, updated_at)
			VALUES ('station-existing', 1, 'Existing station', 'Use supplied facts.', 'brief', ?, ?)
		`).run(timestamp, timestamp);
		db.prepare(`
			INSERT INTO briefing_runs (id, title, status, created_at, mode, station_id_snapshot, station_name_snapshot, station_revision, ai_generated)
			VALUES ('run-existing', 'Existing run', 'failed', ?, 'brief', 'station-existing', 'Existing station', 1, 1)
		`).run(timestamp);
		db.prepare(`
			INSERT INTO generation_requests (
				id, run_id, station_id_snapshot, station_revision, station_name,
				topic_instruction, requested_mode, request_hash, requested_at
			) VALUES ('request-existing', 'run-existing', 'station-existing', 1, 'Existing station', 'Use supplied facts.', 'brief', ?, ?)
		`).run('a'.repeat(64), timestamp);

		applyMigrations(db);
		applyMigrations(db);

		expect(db.prepare('SELECT brief_length_preset FROM stations WHERE id = ?').get('station-existing')).toEqual({brief_length_preset: 'standard'});
		expect(db.prepare('SELECT brief_length_preset FROM generation_requests WHERE id = ?').get('request-existing')).toEqual({brief_length_preset: 'standard'});
		expect(() => db.prepare("UPDATE stations SET brief_length_preset = 'short' WHERE id = 'station-existing'").run()).toThrow();
		expect(() => db.prepare("UPDATE generation_requests SET brief_length_preset = 'short' WHERE id = 'request-existing'").run()).toThrow();
		expect((db.prepare('SELECT id FROM schema_migrations ORDER BY rowid DESC LIMIT 1').get() as {id: string}).id).toBe('009_compact_brief_length');
	});

	it.each(['001_initial_schema', '002_source_item_identity', '003_source_sync_metadata', '004_generation_jobs', '005_real_provider_walking_skeleton'])('upgrades a %s snapshot without losing data', migrationId => {
		const db = database();
		installFrozenMigrationSnapshot(db, migrationId);
		db.prepare(`
			INSERT INTO sources (id, type, name, is_active, status, added_at)
			VALUES ('source-existing', 'rss', 'Existing source', 1, 'healthy', '2026-08-05T12:00:00.000Z')
		`).run();
		db.prepare(`
			INSERT INTO sources (id, type, name, is_active, status, added_at)
			VALUES ('legacy-topic', 'manual_topic', 'Legacy direction', 1, 'healthy', '2026-08-05T12:00:00.000Z')
		`).run();
		db.prepare(`
			INSERT INTO source_items (id, source_id, title, content, url, published_at, gathered_at)
			VALUES ('item-existing', 'source-existing', 'Existing item', 'Preserved evidence', 'https://example.test/item', '2026-08-05T11:00:00.000Z', '2026-08-05T12:00:00.000Z')
		`).run();
		db.prepare(`
			INSERT INTO source_items (id, source_id, title, content, gathered_at)
			VALUES ('legacy-topic-item', 'legacy-topic', 'Legacy direction', 'Instruction that must never become evidence', '2026-08-05T12:00:00.000Z')
		`).run();
		db.prepare(`
			INSERT INTO briefing_runs (id, title, status, created_at, completed_at, summary)
			VALUES ('run-complete', 'Completed history', 'complete', '2026-08-05T12:00:00.000Z', '2026-08-05T12:05:00.000Z', 'Preserved summary')
		`).run();
		db.prepare(`
			INSERT INTO briefing_runs (id, title, status, created_at, summary)
			VALUES ('run-orphaned', 'Interrupted legacy run', 'gathering', '2026-08-05T12:10:00.000Z', 'Unsafe partial summary')
		`).run();
		db.prepare("INSERT INTO briefing_run_sources (run_id, source_id) VALUES ('run-complete', 'source-existing'), ('run-orphaned', 'source-existing')").run();
		db.prepare(`
			INSERT INTO briefing_sections (id, run_id, title, type, spoken_text, source_item_ids_json, importance_score, follow_up_prompts_json, sort_order)
			VALUES ('section-existing', 'run-complete', 'History', 'news_summary', 'Preserved transcript', '["item-existing"]', 7, '[]', 0)
		`).run();
		db.prepare(`
			INSERT INTO audio_assets (id, run_id, url, duration_ms, format)
			VALUES ('audio-existing', 'run-complete', '/media/history.mp3', 1234, 'mp3')
		`).run();
		db.prepare(`
			INSERT INTO app_settings (id, settings_json, updated_at)
			VALUES ('default', ?, '2026-08-05T12:00:00.000Z')
		`).run(JSON.stringify({theme: 'dark', aiConfig: {apiKey: 'legacy-secret'}, scheduleEnabled: true}));

		applyMigrations(db);

		expect((db.prepare("SELECT name FROM sources WHERE id = 'source-existing'").get() as {name: string}).name).toBe('Existing source');
		expect((db.prepare("SELECT content FROM source_items WHERE id = 'item-existing'").get() as {content: string}).content).toBe('Preserved evidence');
		expect((db.prepare("SELECT content FROM source_items WHERE id = 'legacy-topic-item'").get() as {content: string}).content).toContain('must never become evidence');
		expect(() => new GenerationJobStore(db).enqueue(['legacy-topic'])).toThrow(/active RSS sources/);
		expect(db.prepare("SELECT status, summary FROM briefing_runs WHERE id = 'run-complete'").get()).toEqual({status: 'complete', summary: 'Preserved summary'});
		expect(db.prepare("SELECT spoken_text FROM briefing_sections WHERE id = 'section-existing'").get()).toEqual({spoken_text: 'Preserved transcript'});
		expect(db.prepare("SELECT url FROM audio_assets WHERE id = 'audio-existing'").get()).toEqual({url: '/media/history.mp3'});
		expect(db.prepare("SELECT status, summary, completed_at FROM briefing_runs WHERE id = 'run-orphaned'").get()).toMatchObject({status: 'failed', summary: null});
		const storedSettings = JSON.parse((db.prepare("SELECT settings_json FROM app_settings WHERE id = 'default'").get() as {settings_json: string}).settings_json);
		expect(storedSettings).toEqual({theme: 'dark'});
		expect(db.prepare('SELECT id FROM schema_migrations ORDER BY rowid').all()).toHaveLength(migrationIds.length);
	});

	it('rolls back all pending migrations when one fails', () => {
		const db = database();
		const plan: Migration[] = [
			{id: 'test_001', up: target => target.exec('CREATE TABLE rolled_back (id TEXT PRIMARY KEY)')},
			{id: 'test_002', up: target => {
				target.exec("INSERT INTO rolled_back (id) VALUES ('before-failure')");
				throw new Error('deterministic migration failure');
			}},
		];

		expect(() => applyMigrationPlan(db, plan)).toThrow('deterministic migration failure');
		expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'rolled_back'").get()).toBeUndefined();
		expect(db.prepare('SELECT id FROM schema_migrations').all()).toEqual([]);
	});

	it('rejects a database with an unknown migration instead of resetting it', () => {
		const db = database();
		db.exec('CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
		db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run('999_future', '2026-08-05T12:00:00.000Z');

		expect(() => applyMigrations(db)).toThrow(/newer than this LocalCast build/);
		expect((db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get() as {count: number}).count).toBe(1);
	});

	it('backfills the versioned single-host transcript seam from migration 006', () => {
		const db = database();
		applyMigrationPlan(db, migrationPlanThrough('006_feed_ingestion_and_fts'));
		db.prepare(`
			INSERT INTO briefing_runs (id, title, status, created_at, mode, ai_generated)
			VALUES ('run-006', 'Existing episode', 'complete', '2026-08-06T12:00:00.000Z', 'brief', 1)
		`).run();
		db.prepare(`
			INSERT INTO briefing_sections (id, run_id, title, type, spoken_text, source_item_ids_json, importance_score, follow_up_prompts_json, sort_order)
			VALUES ('section-006', 'run-006', 'Existing section', 'intro', 'Existing narration', '[]', 5, '[]', 0)
		`).run();
		db.prepare(`
			INSERT INTO transcript_claims (id, run_id, section_id, kind, text, support_status, sort_order)
			VALUES ('claim-006', 'run-006', 'section-006', 'transition', 'Existing narration', 'not_required', 0)
		`).run();
		db.prepare(`
			INSERT INTO briefing_runs (id, title, status, created_at, mode, ai_generated)
			VALUES ('run-monolithic', 'Legacy monolithic episode', 'complete', '2026-08-06T12:00:00.000Z', 'brief', 1)
		`).run();
		db.prepare(`
			INSERT INTO briefing_sections (id, run_id, title, type, spoken_text, source_item_ids_json, importance_score, follow_up_prompts_json, sort_order)
			VALUES ('section-monolithic', 'run-monolithic', 'Legacy section', 'intro', 'Legacy narration', '[]', 5, '[]', 0)
		`).run();

		applyMigrations(db);

		expect(db.prepare('SELECT script_format_version FROM briefing_runs WHERE id = ?').get('run-006')).toEqual({script_format_version: 1});
		expect(db.prepare('SELECT script_format_version FROM briefing_runs WHERE id = ?').get('run-monolithic')).toEqual({script_format_version: null});
		expect(db.prepare('SELECT speaker_role, speaker_label, voice_profile FROM transcript_claims WHERE id = ?').get('claim-006')).toEqual({speaker_role: 'host', speaker_label: null, voice_profile: null});
		expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'generation_retry_requests'").get()).toBeTruthy();
	});

	it('upgrades the synthetic Slice 4 schema to additive durable chat tables without changing episode evidence', () => {
		const db = database();
		applyMigrationPlan(db, migrationPlanThrough('007_grounded_episode_workflow'));
		const episode = insertGroundedEpisode(db);
		const episodeBefore = db.prepare('SELECT * FROM briefing_runs WHERE id = ?').get(episode.runId);
		const evidenceBefore = db.prepare('SELECT * FROM episode_evidence_snapshots WHERE id = ?').get(episode.snapshotId);

		applyMigrations(db);
		applyMigrations(db);

		expect(db.prepare('SELECT * FROM briefing_runs WHERE id = ?').get(episode.runId)).toEqual(episodeBefore);
		expect(db.prepare('SELECT * FROM episode_evidence_snapshots WHERE id = ?').get(episode.snapshotId)).toEqual(evidenceBefore);
			for (const table of ['chat_turns', 'chat_claims', 'chat_citations', 'chat_attempts', 'chat_retry_requests', 'chat_provider_calls']) {
				expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)).toEqual({name: table});
			}
			expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_chat_turns_one_unresolved_per_run'").get()).toEqual({name: 'idx_chat_turns_one_unresolved_per_run'});
			expect(db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_chat_turns_one_unresolved_per_run'").get()).toMatchObject({
				sql: expect.stringContaining('WHERE episode_lock = 1'),
			});
		expect(db.prepare('SELECT id FROM schema_migrations ORDER BY rowid').all()).toHaveLength(migrationIds.length);
	});

	it('enforces and preserves the initial submission identity bound across migration 007 upgrade, reapply, and reopen', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localcast-migration-008-keys-'));
		roots.push(root);
		const databasePath = path.join(root, 'synthetic.sqlite');
		let db = new Database(databasePath);
		try {
			db.pragma('foreign_keys = ON');
			applyMigrationPlan(db, migrationPlanThrough('007_grounded_episode_workflow'));
			const episode = insertGroundedEpisode(db);
			applyMigrations(db);
			applyMigrations(db);
			const timestamp = '2026-08-07T12:00:00.000Z';
				const insert = db.prepare(`
					INSERT INTO chat_turns (
						id, run_id, idempotency_key, enqueue_order, question, state,
						episode_lock, attempt_count, retryable, created_at, updated_at
						) VALUES (?, ?, ?, ?, 'Synthetic migration key?', 'failed', 0, 1, 0, ?, ?)
					`);
			insert.run('chat-key-minimum', episode.runId, '12345678', 1, timestamp, timestamp);
			insert.run('chat-key-maximum', episode.runId, 'm'.repeat(200), 2, timestamp, timestamp);
				insert.run('chat-key-unicode-minimum', episode.runId, '😀'.repeat(8), 3, timestamp, timestamp);
				insert.run('chat-key-unicode-maximum', episode.runId, '😀'.repeat(200), 4, timestamp, timestamp);
				for (const [suffix, key] of [
					['ascii-short', 'a'.repeat(7)],
					['ascii-long', 'a'.repeat(201)],
					['unicode-short', '😀'.repeat(7)],
					['unicode-long', '😀'.repeat(201)],
					['nul-start', `\0${'a'.repeat(8)}`],
					['nul-middle', `abcd\0efgh`],
					['nul-end', `${'a'.repeat(8)}\0`],
					['high-surrogate', `${'a'.repeat(8)}\ud800`],
					['low-surrogate', `${'a'.repeat(8)}\udc00`],
				] as const) {
					expect(() => insert.run(`chat-key-${suffix}`, episode.runId, key, 50, timestamp, timestamp)).toThrow();
				}
				const insertRetry = db.prepare(`
						INSERT INTO chat_retry_requests (turn_id, idempotency_key, requested_attempt_number, created_at)
						VALUES (?, ?, 2, ?)
					`);
				insertRetry.run('chat-key-minimum', '😀'.repeat(8), timestamp);
				insertRetry.run('chat-key-maximum', 'r'.repeat(200), timestamp);
				for (const key of [
					'a'.repeat(7), 'a'.repeat(201), '😀'.repeat(7), '😀'.repeat(201),
					`\0${'a'.repeat(8)}`, `abcd\0efgh`, `${'a'.repeat(8)}\0`,
					`${'a'.repeat(8)}\ud800`, `${'a'.repeat(8)}\udc00`,
				]) {
					expect(() => insertRetry.run('chat-key-unicode-minimum', key, timestamp)).toThrow();
				}
			db.close();

			db = new Database(databasePath);
			db.pragma('foreign_keys = ON');
			applyMigrations(db);
				expect(db.prepare('SELECT idempotency_key FROM chat_turns ORDER BY enqueue_order').all()).toEqual([
				{idempotency_key: '12345678'},
				{idempotency_key: 'm'.repeat(200)},
				{idempotency_key: '😀'.repeat(8)},
				{idempotency_key: '😀'.repeat(200)},
				]);
				expect(db.prepare('SELECT idempotency_key FROM chat_retry_requests ORDER BY turn_id').all()).toEqual([
					{idempotency_key: 'r'.repeat(200)},
					{idempotency_key: '😀'.repeat(8)},
				]);
			expect(db.prepare('SELECT id FROM schema_migrations ORDER BY rowid').all()).toHaveLength(migrationIds.length);
		} finally {
			if (db.open) db.close();
		}
	});

	it('retains the episode lock for every unpublished provider lifecycle status across upgrade and reopen', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localcast-migration-008-provider-lock-'));
		roots.push(root);
		const databasePath = path.join(root, 'synthetic.sqlite');
		const timestamp = '2026-08-07T12:00:00.000Z';
		const statuses = [
			{status: 'reserved', safeOutcome: null},
			{status: 'response_received', safeOutcome: 'response_received'},
			{status: 'ambiguous', safeOutcome: 'timeout'},
			{status: 'finalized', safeOutcome: 'provider_rejected'},
		] as const;
		let db = new Database(databasePath);
		try {
			db.pragma('foreign_keys = ON');
			applyMigrationPlan(db, migrationPlanThrough('007_grounded_episode_workflow'));
			const episodes = statuses.map(({status}) => insertGroundedEpisode(db, {runId: `run-provider-lock-${status}`}));
			const unlockedEpisode = insertGroundedEpisode(db, {runId: 'run-provider-lock-unlocked'});
			const publishedEpisode = insertGroundedEpisode(db, {runId: 'run-provider-lock-published'});
			applyMigrations(db);
			applyMigrations(db);

			for (const [index, lifecycle] of statuses.entries()) {
				const turnId = `chat-provider-lock-${lifecycle.status}`;
				db.prepare(`
					INSERT INTO chat_turns (
						id, run_id, idempotency_key, enqueue_order, question, state, episode_lock,
						attempt_count, lease_owner, lease_expires_at, retryable,
						created_at, updated_at, started_at
					) VALUES (?, ?, ?, ?, ?, 'running', 1, 1, 'worker', ?, 0, ?, ?, ?)
				`).run(
					turnId,
					episodes[index]!.runId,
					`provider-lock-${lifecycle.status}`,
					index + 1,
					`Synthetic ${lifecycle.status} provider lifecycle?`,
					'2026-08-07T12:05:00.000Z',
					timestamp,
					timestamp,
					timestamp,
				);
				db.prepare(`
					INSERT INTO chat_attempts (
						id, turn_id, attempt_number, worker_id, started_at, outcome
					) VALUES (?, ?, 1, 'worker', ?, 'running')
				`).run(`attempt-provider-lock-${lifecycle.status}`, turnId, timestamp);
				const callId = `call-provider-lock-${lifecycle.status}`;
				reserveMigrationProviderCall(db, {id: callId, turnId, timestamp});
				if (lifecycle.status === 'response_received') receiveMigrationProviderCall(db, callId, timestamp);
				if (lifecycle.status === 'ambiguous') makeMigrationProviderCallAmbiguous(db, callId, 'timeout', timestamp);
				if (lifecycle.status === 'finalized') finalizeMigrationProviderCall(db, callId, 'provider_rejected', timestamp);
				db.prepare(`
					UPDATE chat_turns
					SET state = 'failed', lease_owner = NULL, lease_expires_at = NULL,
						error_code = 'SYNTHETIC_FAILURE', error_message = 'Synthetic failure',
						retryable = 0, updated_at = ?, completed_at = ?
					WHERE id = ?
				`).run(timestamp, timestamp, turnId);
		db.prepare(`
			UPDATE chat_attempts
					SET finished_at = ?, outcome = 'failed', error_code = 'SYNTHETIC_FAILURE',
						error_message = 'Synthetic failure'
					WHERE turn_id = ? AND attempt_number = 1
				`).run(timestamp, turnId);
				expect(() => db.prepare('UPDATE chat_turns SET episode_lock = 0 WHERE id = ?').run(turnId)).toThrow(/cannot release the episode lock/);
				const failedTurn = db.prepare('SELECT * FROM chat_turns WHERE id = ?').get(turnId);
				expect(() => db.prepare(`
					UPDATE chat_turns
					SET state = 'answered', answer_kind = 'answer', refusal_code = NULL,
						episode_lock = 0, error_code = NULL, error_message = NULL,
						updated_at = ?, completed_at = ?
					WHERE id = ?
				`).run(timestamp, timestamp, turnId)).toThrow(/cannot release the episode lock/);
				expect(db.prepare('SELECT * FROM chat_turns WHERE id = ?').get(turnId)).toEqual(failedTurn);
				expect(() => db.prepare(`
					UPDATE chat_turns
					SET state = 'refused', answer_kind = 'refusal', refusal_code = 'EVIDENCE_INSUFFICIENT',
						episode_lock = 0, error_code = NULL, error_message = NULL,
						updated_at = ?, completed_at = ?
					WHERE id = ?
				`).run(timestamp, timestamp, turnId)).toThrow(/cannot release the episode lock/);
				expect(db.prepare('SELECT * FROM chat_turns WHERE id = ?').get(turnId)).toEqual(failedTurn);
				expect(() => db.prepare(`
					INSERT INTO chat_turns (
						id, run_id, idempotency_key, enqueue_order, question, state,
						attempt_count, retryable, created_at, updated_at
					) VALUES (?, ?, ?, ?, 'Distinct synthetic question?', 'queued', 0, 0, ?, ?)
				`).run(
					`chat-provider-lock-conflict-${lifecycle.status}`,
					episodes[index]!.runId,
					`provider-lock-conflict-${lifecycle.status}`,
					index + 101,
					timestamp,
					timestamp,
				)).toThrow();
			}

			db.prepare(`
				INSERT INTO chat_turns (
					id, run_id, idempotency_key, enqueue_order, question, state, episode_lock,
					attempt_count, retryable, created_at, updated_at, completed_at
				) VALUES ('chat-provider-lock-unlocked', ?, 'provider-lock-unlocked', 10,
					'Proven pre-provider failure?', 'failed', 0, 1, 0, ?, ?, ?)
			`).run(unlockedEpisode.runId, timestamp, timestamp, timestamp);
			db.prepare(`
				INSERT INTO chat_attempts (
					id, turn_id, attempt_number, worker_id, started_at, finished_at, outcome
				) VALUES ('attempt-provider-lock-unlocked', 'chat-provider-lock-unlocked', 1,
					'worker', ?, ?, 'failed')
			`).run(timestamp, timestamp);
			expect(() => db.prepare(`
				INSERT INTO chat_provider_calls (
					id, turn_id, attempt_number, stage, model, worker_id, status, reserved_at, updated_at
				) VALUES ('call-provider-lock-unlocked', 'chat-provider-lock-unlocked', 1, 'draft',
					'gpt-5.4-mini-2026-03-17', 'worker', 'reserved', ?, ?)
			`).run(timestamp, timestamp)).toThrow(/provider lifecycle requires the episode lock/);

			db.prepare(`
				INSERT INTO chat_turns (
					id, run_id, idempotency_key, enqueue_order, question, state, episode_lock,
					attempt_count, lease_owner, lease_expires_at, retryable, created_at, updated_at, started_at
				) VALUES ('chat-provider-lock-published', ?, 'provider-lock-published', 11,
					'Safely published refusal?', 'running', 1, 1, 'worker', ?, 0, ?, ?, ?)
			`).run(publishedEpisode.runId, '2026-08-07T12:01:00.000Z', timestamp, timestamp, timestamp);
			db.prepare(`
				INSERT INTO chat_attempts (
					id, turn_id, attempt_number, worker_id, started_at, outcome
				) VALUES ('attempt-provider-lock-published', 'chat-provider-lock-published', 1,
					'worker', ?, 'running')
		`).run(timestamp);
			reserveMigrationProviderCall(db, {
				id: 'call-provider-lock-published',
				turnId: 'chat-provider-lock-published',
				timestamp,
			});
			finalizeMigrationProviderCall(db, 'call-provider-lock-published', 'draft_refusal', timestamp);
			db.prepare(`
				UPDATE chat_turns
				SET state = 'refused', answer_kind = 'refusal', refusal_code = 'EVIDENCE_INSUFFICIENT',
					episode_lock = 0, lease_owner = NULL, lease_expires_at = NULL,
					updated_at = ?, completed_at = ?
				WHERE id = 'chat-provider-lock-published'
			`).run(timestamp, timestamp);
			db.prepare(`
				UPDATE chat_attempts SET finished_at = ?, outcome = 'refused'
				WHERE turn_id = 'chat-provider-lock-published' AND attempt_number = 1
			`).run(timestamp);
			expect(() => db.prepare(`
				UPDATE chat_provider_calls SET updated_at = ?
				WHERE id = 'call-provider-lock-published'
			`).run('2026-08-07T12:02:00.000Z')).toThrow(/provider lifecycle/);
			db.close();

			db = new Database(databasePath);
			db.pragma('foreign_keys = ON');
			applyMigrations(db);
			for (const lifecycle of statuses) {
				const {status} = lifecycle;
				const turnId = `chat-provider-lock-${status}`;
				expect(db.prepare('SELECT state, episode_lock FROM chat_turns WHERE id = ?').get(turnId)).toEqual({
					state: 'failed', episode_lock: 1,
				});
				expect(db.prepare('SELECT status, safe_outcome FROM chat_provider_calls WHERE turn_id = ?').get(turnId)).toEqual({
					status: lifecycle.status,
					safe_outcome: lifecycle.safeOutcome,
				});
				expect(() => db.prepare('UPDATE chat_turns SET episode_lock = 0 WHERE id = ?').run(turnId)).toThrow(/cannot release the episode lock/);
			}
			expect(db.prepare('SELECT state, episode_lock FROM chat_turns WHERE id = ?').get('chat-provider-lock-published')).toEqual({
				state: 'refused', episode_lock: 0,
			});
			expect(db.prepare('SELECT id FROM schema_migrations ORDER BY rowid').all()).toHaveLength(migrationIds.length);
		} finally {
			if (db.open) db.close();
		}
	});

	it('rejects an incompatible direct publication and preserves its provider evidence', () => {
		const db = database();
		applyMigrations(db);
		const episode = insertGroundedEpisode(db, {runId: 'run-migration-publication-shape'});
		const timestamp = '2026-08-07T12:00:00.000Z';
		db.prepare(`
			INSERT INTO chat_turns (
				id, run_id, idempotency_key, enqueue_order, question, state, episode_lock,
				attempt_count, lease_owner, lease_expires_at, retryable, created_at, updated_at, started_at
			) VALUES ('chat-publication-shape', ?, 'publication-shape-key', 200,
				'Synthetic incompatible publication?', 'running', 1, 1, 'worker', ?, 0, ?, ?, ?)
		`).run(episode.runId, '2026-08-07T12:05:00.000Z', timestamp, timestamp, timestamp);
		db.prepare(`
			INSERT INTO chat_attempts (id, turn_id, attempt_number, worker_id, started_at, outcome)
			VALUES ('attempt-publication-shape', 'chat-publication-shape', 1, 'worker', ?, 'running')
		`).run(timestamp);
		reserveMigrationProviderCall(db, {
			id: 'call-publication-shape',
			turnId: 'chat-publication-shape',
			timestamp,
		});
		finalizeMigrationProviderCall(db, 'call-publication-shape', 'provider_rejected', timestamp);

		const turnBefore = db.prepare('SELECT * FROM chat_turns WHERE id = ?').get('chat-publication-shape');
		const callBefore = db.prepare('SELECT * FROM chat_provider_calls WHERE id = ?').get('call-publication-shape');
		expect(() => db.prepare(`
			UPDATE chat_turns
			SET state = 'answered', answer_kind = 'answer', episode_lock = 0,
				lease_owner = NULL, lease_expires_at = NULL, updated_at = ?, completed_at = ?
			WHERE id = 'chat-publication-shape'
		`).run(timestamp, timestamp)).toThrow();
		expect(db.prepare('SELECT * FROM chat_turns WHERE id = ?').get('chat-publication-shape')).toEqual(turnBefore);
		expect(() => db.prepare("UPDATE chat_provider_calls SET safe_outcome = 'draft_refusal' WHERE id = 'call-publication-shape'").run()).toThrow();
		expect(() => db.prepare("DELETE FROM chat_provider_calls WHERE id = 'call-publication-shape'").run()).toThrow();
		expect(db.prepare('SELECT * FROM chat_provider_calls WHERE id = ?').get('call-publication-shape')).toEqual(callBefore);
		expect(() => db.prepare(`
			UPDATE chat_turns
			SET state = 'refused', answer_kind = 'refusal', refusal_code = 'EVIDENCE_INSUFFICIENT',
				episode_lock = 0, lease_owner = NULL, lease_expires_at = NULL,
				updated_at = ?, completed_at = ?
			WHERE id = 'chat-publication-shape'
		`).run(timestamp, timestamp)).toThrow(/cannot release the episode lock/);
		expect(db.prepare('SELECT * FROM chat_turns WHERE id = ?').get('chat-publication-shape')).toEqual(turnBefore);
	});

	it('accepts only the exact answer, refusal, and zero-provider release shapes', () => {
		const db = database();
		applyMigrations(db);
		const timestamp = '2026-08-07T12:00:00.000Z';

		const answerEpisode = insertGroundedEpisode(db, {runId: 'run-migration-valid-answer'});
		insertMigrationRunningTurn(db, {
			runId: answerEpisode.runId,
			turnId: 'chat-migration-valid-answer',
			idempotencyKey: 'migration-valid-answer',
			enqueueOrder: 300,
			timestamp,
		});
		reserveMigrationProviderCall(db, {id: 'call-answer-draft', turnId: 'chat-migration-valid-answer', timestamp});
		finalizeMigrationProviderCall(db, 'call-answer-draft', 'draft_answer_validated', timestamp);
		const answerBeforeClaims = db.prepare("SELECT * FROM chat_turns WHERE id = 'chat-migration-valid-answer'").get();
		expect(() => db.prepare(`
			UPDATE chat_turns
			SET state = 'answered', answer_kind = 'answer', episode_lock = 0,
				lease_owner = NULL, lease_expires_at = NULL, retryable = 0,
				error_code = NULL, error_message = NULL, updated_at = ?, completed_at = ?
			WHERE id = 'chat-migration-valid-answer'
		`).run(timestamp, timestamp)).toThrow(/cannot release the episode lock/);
		expect(db.prepare("SELECT * FROM chat_turns WHERE id = 'chat-migration-valid-answer'").get()).toEqual(answerBeforeClaims);

		reserveMigrationProviderCall(db, {
			id: 'call-answer-support',
			turnId: 'chat-migration-valid-answer',
			stage: 'support',
			timestamp,
		});
		finalizeMigrationProviderCall(db, 'call-answer-support', 'support_validated', timestamp);
		const answerBeforeMissingClaims = db.prepare("SELECT * FROM chat_turns WHERE id = 'chat-migration-valid-answer'").get();
		expect(() => db.prepare(`
			UPDATE chat_turns
			SET state = 'answered', answer_kind = 'answer', episode_lock = 0,
				lease_owner = NULL, lease_expires_at = NULL, retryable = 0,
				error_code = NULL, error_message = NULL, updated_at = ?, completed_at = ?
			WHERE id = 'chat-migration-valid-answer'
		`).run(timestamp, timestamp)).toThrow(/cannot release the episode lock/);
		expect(db.prepare("SELECT * FROM chat_turns WHERE id = 'chat-migration-valid-answer'").get()).toEqual(answerBeforeMissingClaims);

		db.prepare(`
			INSERT INTO chat_claims (id, turn_id, run_id, text, support_status, sort_order)
			VALUES ('claim-migration-valid-answer', 'chat-migration-valid-answer', ?,
				'Synthetic supported answer.', 'supported', 0)
		`).run(answerEpisode.runId);
		const answerBeforeMissingCitation = db.prepare("SELECT * FROM chat_turns WHERE id = 'chat-migration-valid-answer'").get();
		expect(() => db.prepare(`
			UPDATE chat_turns
			SET state = 'answered', answer_kind = 'answer', episode_lock = 0,
				lease_owner = NULL, lease_expires_at = NULL, retryable = 0,
				error_code = NULL, error_message = NULL, updated_at = ?, completed_at = ?
			WHERE id = 'chat-migration-valid-answer'
		`).run(timestamp, timestamp)).toThrow(/cannot release the episode lock/);
		expect(db.prepare("SELECT * FROM chat_turns WHERE id = 'chat-migration-valid-answer'").get()).toEqual(answerBeforeMissingCitation);
		db.prepare(`
			INSERT INTO chat_citations (claim_id, run_id, snapshot_id, excerpt, sort_order)
			VALUES ('claim-migration-valid-answer', ?, ?, 'Synthetic evidence excerpt.', 0)
		`).run(answerEpisode.runId, answerEpisode.snapshotId);
		const answerBeforeMismatch = db.prepare("SELECT * FROM chat_turns WHERE id = 'chat-migration-valid-answer'").get();
		expect(() => db.prepare(`
			UPDATE chat_turns
			SET state = 'refused', answer_kind = 'refusal', refusal_code = 'EVIDENCE_INSUFFICIENT',
				episode_lock = 0, lease_owner = NULL, lease_expires_at = NULL,
				updated_at = ?, completed_at = ?
			WHERE id = 'chat-migration-valid-answer'
		`).run(timestamp, timestamp)).toThrow(/cannot release the episode lock/);
		expect(db.prepare("SELECT * FROM chat_turns WHERE id = 'chat-migration-valid-answer'").get()).toEqual(answerBeforeMismatch);
		expect(() => db.prepare(`
			UPDATE chat_turns
			SET state = 'answered', answer_kind = 'answer', episode_lock = 0,
				lease_owner = NULL, lease_expires_at = NULL, error_code = 'MALFORMED',
				updated_at = ?, completed_at = ?
			WHERE id = 'chat-migration-valid-answer'
		`).run(timestamp, timestamp)).toThrow(/cannot release the episode lock/);
		expect(db.prepare("SELECT * FROM chat_turns WHERE id = 'chat-migration-valid-answer'").get()).toEqual(answerBeforeMismatch);
		expect(() => db.prepare(`
			UPDATE chat_turns
			SET state = 'answered', answer_kind = 'answer', episode_lock = 0,
				lease_owner = NULL, lease_expires_at = NULL, updated_at = ?, completed_at = NULL
			WHERE id = 'chat-migration-valid-answer'
		`).run(timestamp)).toThrow(/cannot release the episode lock/);
		expect(db.prepare("SELECT * FROM chat_turns WHERE id = 'chat-migration-valid-answer'").get()).toEqual(answerBeforeMismatch);
		db.prepare(`
			UPDATE chat_turns
			SET state = 'answered', answer_kind = 'answer', refusal_code = NULL,
				episode_lock = 0, lease_owner = NULL, lease_expires_at = NULL,
				retryable = 0, error_code = NULL, error_message = NULL,
				updated_at = ?, completed_at = ?
			WHERE id = 'chat-migration-valid-answer'
		`).run(timestamp, timestamp);
		const answerAttemptBefore = db.prepare(`
			SELECT * FROM chat_attempts
			WHERE turn_id = 'chat-migration-valid-answer' AND attempt_number = 1
		`).get();
		expect(() => db.prepare(`
			UPDATE chat_attempts SET finished_at = ?, outcome = 'refused'
			WHERE turn_id = 'chat-migration-valid-answer' AND attempt_number = 1
		`).run(timestamp)).toThrow(/chat attempt outcome/);
		expect(db.prepare(`
			SELECT * FROM chat_attempts
			WHERE turn_id = 'chat-migration-valid-answer' AND attempt_number = 1
		`).get()).toEqual(answerAttemptBefore);
		db.prepare(`
			UPDATE chat_attempts SET finished_at = ?, outcome = 'answered'
			WHERE turn_id = 'chat-migration-valid-answer' AND attempt_number = 1
		`).run(timestamp);
		expect(db.prepare("SELECT state, episode_lock FROM chat_turns WHERE id = 'chat-migration-valid-answer'").get()).toEqual({state: 'answered', episode_lock: 0});
		const publishedClaim = db.prepare("SELECT * FROM chat_claims WHERE id = 'claim-migration-valid-answer'").get();
		const publishedCitation = db.prepare("SELECT * FROM chat_citations WHERE claim_id = 'claim-migration-valid-answer'").get();
		expect(() => db.prepare("UPDATE chat_claims SET text = 'Rewritten claim.' WHERE id = 'claim-migration-valid-answer'").run()).toThrow(/published chat claims are immutable/);
		expect(() => db.prepare("DELETE FROM chat_claims WHERE id = 'claim-migration-valid-answer'").run()).toThrow(/published chat claims are immutable/);
		expect(() => db.prepare("UPDATE chat_citations SET excerpt = 'Rewritten evidence excerpt.' WHERE claim_id = 'claim-migration-valid-answer'").run()).toThrow(/published chat citations are immutable/);
		expect(() => db.prepare("DELETE FROM chat_citations WHERE claim_id = 'claim-migration-valid-answer'").run()).toThrow(/published chat citations are immutable/);
		expect(db.prepare("SELECT * FROM chat_claims WHERE id = 'claim-migration-valid-answer'").get()).toEqual(publishedClaim);
		expect(db.prepare("SELECT * FROM chat_citations WHERE claim_id = 'claim-migration-valid-answer'").get()).toEqual(publishedCitation);
		db.prepare(`
			INSERT INTO chat_turns (
				id, run_id, idempotency_key, enqueue_order, question, state,
				attempt_count, retryable, created_at, updated_at
			) VALUES ('chat-after-valid-answer', ?, 'after-valid-answer', 301,
				'Synthetic sequential question?', 'queued', 0, 0, ?, ?)
		`).run(answerEpisode.runId, timestamp, timestamp);

		const refusalEpisode = insertGroundedEpisode(db, {runId: 'run-migration-valid-refusal'});
		insertMigrationRunningTurn(db, {
			runId: refusalEpisode.runId,
			turnId: 'chat-migration-valid-refusal',
			idempotencyKey: 'migration-valid-refusal',
			enqueueOrder: 302,
			timestamp,
		});
		reserveMigrationProviderCall(db, {id: 'call-refusal-draft', turnId: 'chat-migration-valid-refusal', timestamp});
		finalizeMigrationProviderCall(db, 'call-refusal-draft', 'draft_refusal', timestamp);
		const refusalBefore = db.prepare("SELECT * FROM chat_turns WHERE id = 'chat-migration-valid-refusal'").get();
		expect(() => db.prepare(`
			UPDATE chat_turns
			SET state = 'answered', answer_kind = 'answer', episode_lock = 0,
				lease_owner = NULL, lease_expires_at = NULL, updated_at = ?, completed_at = ?
			WHERE id = 'chat-migration-valid-refusal'
		`).run(timestamp, timestamp)).toThrow(/cannot release the episode lock/);
		expect(db.prepare("SELECT * FROM chat_turns WHERE id = 'chat-migration-valid-refusal'").get()).toEqual(refusalBefore);
		expect(() => db.prepare(`
			UPDATE chat_turns
			SET state = 'refused', answer_kind = 'refusal', refusal_code = NULL,
				episode_lock = 0, lease_owner = NULL, lease_expires_at = NULL,
				updated_at = ?, completed_at = ?
			WHERE id = 'chat-migration-valid-refusal'
		`).run(timestamp, timestamp)).toThrow(/cannot release the episode lock/);
		expect(db.prepare("SELECT * FROM chat_turns WHERE id = 'chat-migration-valid-refusal'").get()).toEqual(refusalBefore);
		db.prepare(`
			UPDATE chat_turns
			SET state = 'refused', answer_kind = 'refusal', refusal_code = 'EVIDENCE_INSUFFICIENT',
				episode_lock = 0, lease_owner = NULL, lease_expires_at = NULL,
				retryable = 0, error_code = NULL, error_message = NULL,
				updated_at = ?, completed_at = ?
			WHERE id = 'chat-migration-valid-refusal'
		`).run(timestamp, timestamp);
		const refusalAttemptBefore = db.prepare(`
			SELECT * FROM chat_attempts
			WHERE turn_id = 'chat-migration-valid-refusal' AND attempt_number = 1
		`).get();
		expect(() => db.prepare(`
			UPDATE chat_attempts SET finished_at = ?, outcome = 'answered'
			WHERE turn_id = 'chat-migration-valid-refusal' AND attempt_number = 1
		`).run(timestamp)).toThrow(/chat attempt outcome/);
		expect(db.prepare(`
			SELECT * FROM chat_attempts
			WHERE turn_id = 'chat-migration-valid-refusal' AND attempt_number = 1
		`).get()).toEqual(refusalAttemptBefore);
		db.prepare(`
			UPDATE chat_attempts SET finished_at = ?, outcome = 'refused'
			WHERE turn_id = 'chat-migration-valid-refusal' AND attempt_number = 1
		`).run(timestamp);
		expect(db.prepare("SELECT state, episode_lock FROM chat_turns WHERE id = 'chat-migration-valid-refusal'").get()).toEqual({state: 'refused', episode_lock: 0});
		db.prepare(`
			INSERT INTO chat_turns (
				id, run_id, idempotency_key, enqueue_order, question, state,
				attempt_count, retryable, created_at, updated_at
			) VALUES ('chat-after-valid-refusal', ?, 'after-valid-refusal', 303,
				'Synthetic sequential question?', 'queued', 0, 0, ?, ?)
		`).run(refusalEpisode.runId, timestamp, timestamp);

		const failureEpisode = insertGroundedEpisode(db, {runId: 'run-migration-zero-provider-failure'});
		insertMigrationRunningTurn(db, {
			runId: failureEpisode.runId,
			turnId: 'chat-migration-zero-provider-failure',
			idempotencyKey: 'migration-zero-provider-failure',
			enqueueOrder: 304,
			timestamp,
		});
		db.prepare(`
			UPDATE chat_turns
			SET state = 'failed', answer_kind = NULL, refusal_code = NULL,
				episode_lock = 0, lease_owner = NULL, lease_expires_at = NULL,
				error_code = 'PRE_PROVIDER_FAILURE', error_message = 'Synthetic pre-provider failure',
				retryable = 0, updated_at = ?, completed_at = ?
			WHERE id = 'chat-migration-zero-provider-failure'
		`).run(timestamp, timestamp);
		db.prepare(`
			UPDATE chat_attempts
			SET finished_at = ?, outcome = 'failed', error_code = 'PRE_PROVIDER_FAILURE',
				error_message = 'Synthetic pre-provider failure'
			WHERE turn_id = 'chat-migration-zero-provider-failure' AND attempt_number = 1
		`).run(timestamp);
		expect(db.prepare("SELECT state, episode_lock FROM chat_turns WHERE id = 'chat-migration-zero-provider-failure'").get()).toEqual({state: 'failed', episode_lock: 0});
		db.prepare(`
			INSERT INTO chat_turns (
				id, run_id, idempotency_key, enqueue_order, question, state,
				attempt_count, retryable, created_at, updated_at
			) VALUES ('chat-after-zero-provider-failure', ?, 'after-zero-provider-failure', 305,
				'Synthetic sequential question?', 'queued', 0, 0, ?, ?)
		`).run(failureEpisode.runId, timestamp, timestamp);

		db.prepare('DELETE FROM briefing_runs WHERE id = ?').run(answerEpisode.runId);
		expect(db.prepare('SELECT 1 FROM chat_turns WHERE run_id = ?').get(answerEpisode.runId)).toBeUndefined();
		expect(db.prepare("SELECT 1 FROM chat_claims WHERE id = 'claim-migration-valid-answer'").get()).toBeUndefined();
		expect(db.prepare("SELECT 1 FROM chat_provider_calls WHERE id = 'call-answer-draft'").get()).toBeUndefined();
	});

	it.each(['reserved', 'response_received', 'ambiguous'] as const)(
		'rejects attempt-two publication while attempt one remains %s',
		lifecycleStatus => {
			const db = database();
			applyMigrations(db);
			const timestamp = '2026-08-07T12:00:00.000Z';
			const episode = insertGroundedEpisode(db, {runId: `run-migration-prior-${lifecycleStatus}`});
			const turnId = `chat-migration-prior-${lifecycleStatus}`;
			const callId = `call-migration-prior-${lifecycleStatus}`;
			insertMigrationRunningTurn(db, {
				runId: episode.runId,
				turnId,
				idempotencyKey: `migration-prior-${lifecycleStatus}`,
				enqueueOrder: 350,
				timestamp,
			});
			reserveMigrationProviderCall(db, {id: callId, turnId, timestamp});
			if (lifecycleStatus === 'response_received') receiveMigrationProviderCall(db, callId, timestamp);
			if (lifecycleStatus === 'ambiguous') makeMigrationProviderCallAmbiguous(db, callId, 'timeout', timestamp);
			failMigrationTurn(db, turnId, timestamp);
			db.prepare(`
				INSERT INTO chat_retry_requests (turn_id, idempotency_key, requested_attempt_number, created_at)
				VALUES (?, ?, 2, ?)
			`).run(turnId, `retry-prior-${lifecycleStatus}`, timestamp);
			db.prepare(`
				UPDATE chat_turns
				SET state = 'queued', attempt_count = 1, lease_owner = NULL, lease_expires_at = NULL,
					error_code = NULL, error_message = NULL, retryable = 0,
					updated_at = ?, completed_at = NULL
				WHERE id = ?
			`).run(timestamp, turnId);
			db.prepare(`
				UPDATE chat_turns
				SET state = 'running', attempt_count = 2, lease_owner = 'worker-two',
					lease_expires_at = '2026-08-07T12:10:00.000Z', updated_at = ?
				WHERE id = ?
			`).run(timestamp, turnId);
			db.prepare(`
				INSERT INTO chat_attempts (id, turn_id, attempt_number, worker_id, started_at, outcome)
				VALUES (?, ?, 2, 'worker-two', ?, 'running')
			`).run(`attempt-${turnId}-2`, turnId, timestamp);
			reserveMigrationProviderCall(db, {
				id: `call-migration-current-${lifecycleStatus}`,
				turnId,
				attemptNumber: 2,
				workerId: 'worker-two',
				timestamp,
			});
			finalizeMigrationProviderCall(db, `call-migration-current-${lifecycleStatus}`, 'draft_refusal', timestamp);

			const turnBefore = db.prepare('SELECT * FROM chat_turns WHERE id = ?').get(turnId);
			const attemptsBefore = db.prepare('SELECT * FROM chat_attempts WHERE turn_id = ? ORDER BY attempt_number').all(turnId);
			const callsBefore = db.prepare('SELECT * FROM chat_provider_calls WHERE turn_id = ? ORDER BY attempt_number, stage').all(turnId);
			const retryBefore = db.prepare('SELECT * FROM chat_retry_requests WHERE turn_id = ?').get(turnId);
			expect(() => db.prepare(`
				UPDATE chat_turns
				SET state = 'refused', answer_kind = 'refusal', refusal_code = 'EVIDENCE_INSUFFICIENT',
					episode_lock = 0, lease_owner = NULL, lease_expires_at = NULL,
					retryable = 0, error_code = NULL, error_message = NULL,
					updated_at = ?, completed_at = ?
				WHERE id = ?
			`).run(timestamp, timestamp, turnId)).toThrow(/cannot release the episode lock/);
			expect(db.prepare('SELECT * FROM chat_turns WHERE id = ?').get(turnId)).toEqual(turnBefore);
			expect(db.prepare('SELECT * FROM chat_attempts WHERE turn_id = ? ORDER BY attempt_number').all(turnId)).toEqual(attemptsBefore);
			expect(db.prepare('SELECT * FROM chat_provider_calls WHERE turn_id = ? ORDER BY attempt_number, stage').all(turnId)).toEqual(callsBefore);
			expect(db.prepare('SELECT * FROM chat_retry_requests WHERE turn_id = ?').get(turnId)).toEqual(retryBefore);
		},
	);

	it('requires an accepted retry request before attempt-two publication', () => {
		const db = database();
		applyMigrations(db);
		const timestamp = '2026-08-07T12:00:00.000Z';
		const episode = insertGroundedEpisode(db, {runId: 'run-migration-missing-retry'});
		const turnId = 'chat-migration-missing-retry';
		insertMigrationRunningTurn(db, {
			runId: episode.runId,
			turnId,
			idempotencyKey: 'migration-missing-retry',
			enqueueOrder: 351,
			timestamp,
		});
		reserveMigrationProviderCall(db, {id: 'call-migration-missing-retry-1', turnId, timestamp});
		finalizeMigrationProviderCall(db, 'call-migration-missing-retry-1', 'provider_rejected', timestamp);
		failMigrationTurn(db, turnId, timestamp);
		db.prepare(`
			UPDATE chat_turns
			SET state = 'running', attempt_count = 2, lease_owner = 'worker-two',
				lease_expires_at = '2026-08-07T12:10:00.000Z',
				error_code = NULL, error_message = NULL, retryable = 0,
				updated_at = ?, completed_at = NULL
			WHERE id = ?
		`).run(timestamp, turnId);
		db.prepare(`
			INSERT INTO chat_attempts (id, turn_id, attempt_number, worker_id, started_at, outcome)
			VALUES ('attempt-chat-migration-missing-retry-2', ?, 2, 'worker-two', ?, 'running')
		`).run(turnId, timestamp);
		reserveMigrationProviderCall(db, {
			id: 'call-migration-missing-retry-2',
			turnId,
			attemptNumber: 2,
			workerId: 'worker-two',
			timestamp,
		});
		finalizeMigrationProviderCall(db, 'call-migration-missing-retry-2', 'draft_refusal', timestamp);

		const turnBefore = db.prepare('SELECT * FROM chat_turns WHERE id = ?').get(turnId);
		const attemptsBefore = db.prepare('SELECT * FROM chat_attempts WHERE turn_id = ? ORDER BY attempt_number').all(turnId);
		const callsBefore = db.prepare('SELECT * FROM chat_provider_calls WHERE turn_id = ? ORDER BY attempt_number, stage').all(turnId);
		expect(() => db.prepare(`
			UPDATE chat_turns
			SET state = 'refused', answer_kind = 'refusal', refusal_code = 'EVIDENCE_INSUFFICIENT',
				episode_lock = 0, lease_owner = NULL, lease_expires_at = NULL,
				retryable = 0, error_code = NULL, error_message = NULL,
				updated_at = ?, completed_at = ?
			WHERE id = ?
		`).run(timestamp, timestamp, turnId)).toThrow(/cannot release the episode lock/);
		expect(db.prepare('SELECT * FROM chat_turns WHERE id = ?').get(turnId)).toEqual(turnBefore);
		expect(db.prepare('SELECT * FROM chat_attempts WHERE turn_id = ? ORDER BY attempt_number').all(turnId)).toEqual(attemptsBefore);
		expect(db.prepare('SELECT * FROM chat_provider_calls WHERE turn_id = ? ORDER BY attempt_number, stage').all(turnId)).toEqual(callsBefore);
		expect(db.prepare('SELECT * FROM chat_retry_requests WHERE turn_id = ?').all(turnId)).toEqual([]);
	});

	it('makes provider lifecycle identity immutable and preserves evidence until whole-episode deletion', () => {
		const db = database();
		applyMigrations(db);
		const timestamp = '2026-08-07T12:00:00.000Z';
		const episode = insertGroundedEpisode(db, {runId: 'run-migration-provider-identity'});
		insertMigrationRunningTurn(db, {
			runId: episode.runId,
			turnId: 'chat-migration-provider-identity',
			idempotencyKey: 'migration-provider-identity',
			enqueueOrder: 400,
			timestamp,
		});
		reserveMigrationProviderCall(db, {
			id: 'call-migration-provider-identity',
			turnId: 'chat-migration-provider-identity',
			timestamp,
		});
		db.prepare(`
			INSERT INTO chat_attempts (
				id, turn_id, attempt_number, worker_id, started_at, finished_at, outcome,
				error_code, error_message
			) VALUES ('attempt-chat-migration-provider-identity-2',
				'chat-migration-provider-identity', 2, 'other-worker', ?, ?, 'failed',
				'SYNTHETIC_TARGET', 'Synthetic reparent target')
		`).run(timestamp, timestamp);
		const targetEpisode = insertGroundedEpisode(db, {runId: 'run-migration-provider-reparent-target'});
		db.prepare(`
			INSERT INTO chat_turns (
				id, run_id, idempotency_key, enqueue_order, question, state, episode_lock,
				attempt_count, retryable, error_code, error_message, created_at, updated_at, completed_at
			) VALUES ('chat-migration-provider-reparent-target', ?, 'migration-reparent-target', 401,
				'Synthetic reparent target?', 'failed', 1, 1, 0,
				'SYNTHETIC_TARGET', 'Synthetic reparent target', ?, ?, ?)
		`).run(targetEpisode.runId, timestamp, timestamp, timestamp);
		db.prepare(`
			INSERT INTO chat_attempts (
				id, turn_id, attempt_number, worker_id, started_at, finished_at, outcome,
				error_code, error_message
			) VALUES ('attempt-chat-migration-provider-reparent-target-1',
				'chat-migration-provider-reparent-target', 1, 'other-worker', ?, ?, 'failed',
				'SYNTHETIC_TARGET', 'Synthetic reparent target')
		`).run(timestamp, timestamp);

		const providerBefore = db.prepare("SELECT * FROM chat_provider_calls WHERE id = 'call-migration-provider-identity'").get();
		for (const sql of [
			"UPDATE chat_provider_calls SET id = 'call-migration-provider-moved' WHERE id = 'call-migration-provider-identity'",
			"UPDATE chat_provider_calls SET turn_id = 'chat-migration-provider-reparent-target' WHERE id = 'call-migration-provider-identity'",
			"UPDATE chat_provider_calls SET attempt_number = 2 WHERE id = 'call-migration-provider-identity'",
			"UPDATE chat_provider_calls SET stage = 'support' WHERE id = 'call-migration-provider-identity'",
			"UPDATE chat_provider_calls SET model = 'gpt-unapproved' WHERE id = 'call-migration-provider-identity'",
			"UPDATE chat_provider_calls SET worker_id = 'other-worker' WHERE id = 'call-migration-provider-identity'",
			"UPDATE chat_provider_calls SET reserved_at = '2026-08-07T11:59:59.000Z' WHERE id = 'call-migration-provider-identity'",
		]) {
			expect(() => db.prepare(sql).run()).toThrow(/provider lifecycle/);
			expect(db.prepare("SELECT * FROM chat_provider_calls WHERE id = 'call-migration-provider-identity'").get()).toEqual(providerBefore);
		}
		receiveMigrationProviderCall(db, 'call-migration-provider-identity', timestamp, {
			providerRequestId: 'resp_migration_identity',
		});
		const responseBefore = db.prepare("SELECT * FROM chat_provider_calls WHERE id = 'call-migration-provider-identity'").get();
		expect(() => db.prepare(`
			UPDATE chat_provider_calls SET provider_request_id = 'resp_rewritten', updated_at = ?
			WHERE id = 'call-migration-provider-identity'
		`).run(timestamp)).toThrow(/provider lifecycle transition is not monotonic/);
		expect(db.prepare("SELECT * FROM chat_provider_calls WHERE id = 'call-migration-provider-identity'").get()).toEqual(responseBefore);
		db.prepare(`
			UPDATE chat_provider_calls
			SET status = 'finalized', safe_outcome = 'provider_rejected', completed_at = ?, updated_at = ?
			WHERE id = 'call-migration-provider-identity'
		`).run(timestamp, timestamp);
		const providerFinal = db.prepare("SELECT * FROM chat_provider_calls WHERE id = 'call-migration-provider-identity'").get();
		for (const sql of [
			"UPDATE chat_provider_calls SET safe_outcome = 'draft_refusal' WHERE id = 'call-migration-provider-identity'",
			"UPDATE chat_provider_calls SET provider_request_id = 'resp_rewritten' WHERE id = 'call-migration-provider-identity'",
			"UPDATE chat_provider_calls SET input_tokens = 1 WHERE id = 'call-migration-provider-identity'",
			"UPDATE chat_provider_calls SET completed_at = '2026-08-07T12:00:01.000Z' WHERE id = 'call-migration-provider-identity'",
		]) {
			expect(() => db.prepare(sql).run()).toThrow(/provider lifecycle/);
			expect(db.prepare("SELECT * FROM chat_provider_calls WHERE id = 'call-migration-provider-identity'").get()).toEqual(providerFinal);
		}

		const attemptBefore = db.prepare("SELECT * FROM chat_attempts WHERE id = 'attempt-chat-migration-provider-identity-1'").get();
		for (const sql of [
			"UPDATE chat_attempts SET id = 'attempt-moved' WHERE id = 'attempt-chat-migration-provider-identity-1'",
			"UPDATE chat_attempts SET turn_id = 'chat-missing' WHERE id = 'attempt-chat-migration-provider-identity-1'",
			"UPDATE chat_attempts SET attempt_number = 2 WHERE id = 'attempt-chat-migration-provider-identity-1'",
			"UPDATE chat_attempts SET worker_id = 'other-worker' WHERE id = 'attempt-chat-migration-provider-identity-1'",
			"UPDATE chat_attempts SET started_at = '2026-08-07T11:59:59.000Z' WHERE id = 'attempt-chat-migration-provider-identity-1'",
		]) {
			expect(() => db.prepare(sql).run()).toThrow(/chat attempt/);
			expect(db.prepare("SELECT * FROM chat_attempts WHERE id = 'attempt-chat-migration-provider-identity-1'").get()).toEqual(attemptBefore);
		}

		const turnBefore = db.prepare("SELECT * FROM chat_turns WHERE id = 'chat-migration-provider-identity'").get();
		for (const sql of [
			"UPDATE chat_turns SET id = 'chat-moved' WHERE id = 'chat-migration-provider-identity'",
			"UPDATE chat_turns SET run_id = 'run-missing' WHERE id = 'chat-migration-provider-identity'",
		]) {
			expect(() => db.prepare(sql).run()).toThrow(/chat turn identity is immutable/);
			expect(db.prepare("SELECT * FROM chat_turns WHERE id = 'chat-migration-provider-identity'").get()).toEqual(turnBefore);
		}

		expect(() => db.prepare("DELETE FROM chat_provider_calls WHERE id = 'call-migration-provider-identity'").run()).toThrow(/evidence cannot be deleted/);
		expect(() => db.prepare("DELETE FROM chat_attempts WHERE id = 'attempt-chat-migration-provider-identity-1'").run()).toThrow(/provider lifecycle history/);
		expect(() => db.prepare("DELETE FROM chat_turns WHERE id = 'chat-migration-provider-identity'").run()).toThrow(/provider lifecycle history/);
		expect(db.prepare("SELECT * FROM chat_provider_calls WHERE id = 'call-migration-provider-identity'").get()).toEqual(providerFinal);
		expect(db.prepare("SELECT * FROM chat_attempts WHERE id = 'attempt-chat-migration-provider-identity-1'").get()).toEqual(attemptBefore);
		expect(db.prepare("SELECT * FROM chat_turns WHERE id = 'chat-migration-provider-identity'").get()).toEqual(turnBefore);

		db.prepare('DELETE FROM briefing_runs WHERE id = ?').run(episode.runId);
		expect(db.prepare('SELECT 1 FROM chat_turns WHERE run_id = ?').get(episode.runId)).toBeUndefined();
		expect(db.prepare("SELECT 1 FROM chat_provider_calls WHERE id = 'call-migration-provider-identity'").get()).toBeUndefined();
	});

	it('rejects replacement statements that could erase or transfer provider evidence', () => {
		const timestamp = '2026-08-07T12:00:00.000Z';
		const snapshot = (db: Database.Database) => ({
			runs: db.prepare('SELECT * FROM briefing_runs ORDER BY id').all(),
			turns: db.prepare('SELECT * FROM chat_turns ORDER BY id').all(),
			claims: db.prepare('SELECT * FROM chat_claims ORDER BY id').all(),
			citations: db.prepare('SELECT * FROM chat_citations ORDER BY claim_id, sort_order').all(),
			attempts: db.prepare('SELECT * FROM chat_attempts ORDER BY id').all(),
			retries: db.prepare('SELECT * FROM chat_retry_requests ORDER BY turn_id').all(),
			calls: db.prepare('SELECT * FROM chat_provider_calls ORDER BY id').all(),
		});
		const createProviderUsingTurn = (suffix: string, finalizeDraft = false) => {
			const db = database();
			applyMigrations(db);
			const episode = insertGroundedEpisode(db, {runId: `run-migration-replace-${suffix}`});
			const turnId = `chat-migration-replace-${suffix}`;
			const callId = `call-migration-replace-${suffix}`;
			insertMigrationRunningTurn(db, {
				runId: episode.runId,
				turnId,
				idempotencyKey: `migration-replace-${suffix}`,
				enqueueOrder: 450,
				timestamp,
			});
			reserveMigrationProviderCall(db, {id: callId, turnId, timestamp});
			if (finalizeDraft) finalizeMigrationProviderCall(db, callId, 'draft_answer_validated', timestamp);
			return {db, episode, turnId, callId, attemptId: `attempt-${turnId}-1`};
		};

		const providerCase = createProviderUsingTurn('provider', true);
		const providerState = snapshot(providerCase.db);
		expect(() => providerCase.db.prepare(`
			INSERT OR REPLACE INTO chat_provider_calls (
				id, turn_id, attempt_number, stage, model, worker_id, status, reserved_at, updated_at
			) VALUES (?, ?, 1, 'support', 'gpt-5.4-mini-2026-03-17', 'worker', 'reserved', ?, ?)
		`).run(providerCase.callId, providerCase.turnId, timestamp, timestamp)).toThrow();
		expect(snapshot(providerCase.db)).toEqual(providerState);

		const attemptCase = createProviderUsingTurn('attempt');
		const attemptState = snapshot(attemptCase.db);
		expect(() => attemptCase.db.prepare(`
			INSERT OR REPLACE INTO chat_attempts (
				id, turn_id, attempt_number, worker_id, started_at, outcome
			) VALUES (?, ?, 1, 'worker', ?, 'running')
		`).run(attemptCase.attemptId, attemptCase.turnId, timestamp)).toThrow();
		expect(snapshot(attemptCase.db)).toEqual(attemptState);
		const attemptCompositeState = snapshot(attemptCase.db);
		expect(() => attemptCase.db.prepare(`
			INSERT OR REPLACE INTO chat_attempts (
				id, turn_id, attempt_number, worker_id, started_at, outcome
			) VALUES ('attempt-replacement-different-id', ?, 1, 'worker', ?, 'running')
		`).run(attemptCase.turnId, timestamp)).toThrow();
		expect(snapshot(attemptCase.db)).toEqual(attemptCompositeState);

		const turnCase = createProviderUsingTurn('turn');
		const turnState = snapshot(turnCase.db);
		expect(() => turnCase.db.prepare(`
			INSERT OR REPLACE INTO chat_turns
			SELECT * FROM chat_turns WHERE id = ?
		`).run(turnCase.turnId)).toThrow();
		expect(snapshot(turnCase.db)).toEqual(turnState);

		for (const [suffix, conflictColumn] of [
			['idempotency', 'idempotency_key'],
			['enqueue', 'enqueue_order'],
		] as const) {
			const conflictCase = createProviderUsingTurn(`turn-${suffix}`);
			failMigrationTurn(conflictCase.db, conflictCase.turnId, timestamp);
			const before = snapshot(conflictCase.db);
			const idempotencyKey = conflictColumn === 'idempotency_key'
				? `migration-replace-turn-${suffix}`
				: `migration-replace-new-${suffix}`;
			const enqueueOrder = conflictColumn === 'enqueue_order' ? 450 : 451;
			expect(() => conflictCase.db.prepare(`
				INSERT OR REPLACE INTO chat_turns (
					id, run_id, idempotency_key, enqueue_order, question, state, episode_lock,
					attempt_count, retryable, error_code, error_message, created_at, updated_at, completed_at
				) VALUES (?, ?, ?, ?, 'Synthetic replacement?', 'failed', 0,
					1, 0, 'SYNTHETIC', 'Synthetic replacement', ?, ?, ?)
			`).run(
				`chat-replacement-${suffix}`,
				conflictCase.episode.runId,
				idempotencyKey,
				enqueueOrder,
				timestamp,
				timestamp,
				timestamp,
			)).toThrow();
			expect(snapshot(conflictCase.db)).toEqual(before);
		}

		const providerTransfer = createProviderUsingTurn('provider-transfer', true);
		failMigrationTurn(providerTransfer.db, providerTransfer.turnId, timestamp);
		const transferTarget = insertGroundedEpisode(providerTransfer.db, {runId: 'run-migration-replace-provider-target'});
		insertMigrationRunningTurn(providerTransfer.db, {
			runId: transferTarget.runId,
			turnId: 'chat-migration-replace-provider-target',
			idempotencyKey: 'migration-replace-provider-target',
			enqueueOrder: 452,
			timestamp,
		});
		const providerTransferState = snapshot(providerTransfer.db);
		expect(() => providerTransfer.db.prepare(`
			INSERT OR REPLACE INTO chat_provider_calls (
				id, turn_id, attempt_number, stage, model, worker_id, status, reserved_at, updated_at
			) VALUES (?, 'chat-migration-replace-provider-target', 1, 'draft',
				'gpt-5.4-mini-2026-03-17', 'worker', 'reserved', ?, ?)
		`).run(providerTransfer.callId, timestamp, timestamp)).toThrow();
		expect(snapshot(providerTransfer.db)).toEqual(providerTransferState);

		const providerComposite = createProviderUsingTurn('provider-composite');
		const providerCompositeState = snapshot(providerComposite.db);
		expect(() => providerComposite.db.prepare(`
			INSERT OR REPLACE INTO chat_provider_calls (
				id, turn_id, attempt_number, stage, model, worker_id, status, reserved_at, updated_at
			) VALUES ('call-replacement-different-id', ?, 1, 'draft',
				'gpt-5.4-mini-2026-03-17', 'worker', 'reserved', ?, ?)
		`).run(providerComposite.turnId, timestamp, timestamp)).toThrow();
		expect(snapshot(providerComposite.db)).toEqual(providerCompositeState);

		const parentCase = createProviderUsingTurn('parent');
		const parentState = snapshot(parentCase.db);
		expect(() => parentCase.db.prepare(`
			INSERT OR REPLACE INTO briefing_runs
			SELECT * FROM briefing_runs WHERE id = ?
		`).run(parentCase.episode.runId)).toThrow();
		expect(snapshot(parentCase.db)).toEqual(parentState);

		const runningCase = createProviderUsingTurn('running-slot');
		const runningEpisode = insertGroundedEpisode(runningCase.db, {runId: 'run-migration-replace-running-target'});
		const runningState = snapshot(runningCase.db);
		expect(() => runningCase.db.prepare(`
			INSERT OR REPLACE INTO chat_turns (
				id, run_id, idempotency_key, enqueue_order, question, state, episode_lock,
				attempt_count, lease_owner, lease_expires_at, retryable, created_at, updated_at, started_at
			) VALUES ('chat-migration-replace-running-target', ?, 'replace-running-target', 455,
				'Synthetic running target?', 'running', 1, 1, 'worker-target',
				'2026-08-07T12:10:00.000Z', 0, ?, ?, ?)
		`).run(runningEpisode.runId, timestamp, timestamp, timestamp)).toThrow();
		expect(snapshot(runningCase.db)).toEqual(runningState);

		const lockedCase = createProviderUsingTurn('locked-slot');
		failMigrationTurn(lockedCase.db, lockedCase.turnId, timestamp);
		const lockedState = snapshot(lockedCase.db);
		expect(() => lockedCase.db.prepare(`
			INSERT OR REPLACE INTO chat_turns (
				id, run_id, idempotency_key, enqueue_order, question, state, episode_lock,
				attempt_count, retryable, created_at, updated_at
			) VALUES ('chat-migration-replace-locked-target', ?, 'replace-locked-target', 456,
				'Synthetic locked target?', 'queued', 1, 0, 0, ?, ?)
		`).run(lockedCase.episode.runId, timestamp, timestamp)).toThrow();
		expect(snapshot(lockedCase.db)).toEqual(lockedState);

		const partialCase = createProviderUsingTurn('partial-lock');
		failMigrationTurn(partialCase.db, partialCase.turnId, timestamp);
		partialCase.db.prepare(`
			INSERT INTO chat_turns (
				id, run_id, idempotency_key, enqueue_order, question, state, episode_lock,
				attempt_count, retryable, error_code, error_message, created_at, updated_at, completed_at
			) VALUES ('chat-migration-replace-partial-target', ?, 'replace-partial-target', 453,
				'Synthetic target?', 'failed', 0, 1, 0, 'SYNTHETIC', 'Synthetic target', ?, ?, ?)
		`).run(partialCase.episode.runId, timestamp, timestamp, timestamp);
		const partialState = snapshot(partialCase.db);
		expect(() => partialCase.db.prepare(`
			UPDATE OR REPLACE chat_turns
			SET state = 'queued', episode_lock = 1, error_code = NULL, error_message = NULL,
				completed_at = NULL, updated_at = ?
			WHERE id = 'chat-migration-replace-partial-target'
		`).run(timestamp)).toThrow();
		expect(snapshot(partialCase.db)).toEqual(partialState);

		const claimCase = createProviderUsingTurn('claim-source');
		finalizeMigrationProviderCall(claimCase.db, claimCase.callId, 'draft_answer_validated', timestamp);
		reserveMigrationProviderCall(claimCase.db, {
			id: 'call-migration-replace-claim-support',
			turnId: claimCase.turnId,
			stage: 'support',
			timestamp,
		});
		finalizeMigrationProviderCall(claimCase.db, 'call-migration-replace-claim-support', 'support_validated', timestamp);
		claimCase.db.prepare(`
			INSERT INTO chat_claims (id, turn_id, run_id, text, support_status, sort_order)
			VALUES ('claim-migration-replace-source', ?, ?, 'Synthetic published claim.', 'supported', 0)
		`).run(claimCase.turnId, claimCase.episode.runId);
		claimCase.db.prepare(`
			INSERT INTO chat_citations (claim_id, run_id, snapshot_id, excerpt, sort_order)
			VALUES ('claim-migration-replace-source', ?, ?, 'Synthetic published excerpt.', 0)
		`).run(claimCase.episode.runId, claimCase.episode.snapshotId);
		claimCase.db.prepare(`
			UPDATE chat_turns
			SET state = 'answered', answer_kind = 'answer', episode_lock = 0,
				lease_owner = NULL, lease_expires_at = NULL, updated_at = ?, completed_at = ?
			WHERE id = ?
		`).run(timestamp, timestamp, claimCase.turnId);
		claimCase.db.prepare(`
			UPDATE chat_attempts SET outcome = 'answered', finished_at = ? WHERE turn_id = ?
		`).run(timestamp, claimCase.turnId);
		const claimTargetEpisode = insertGroundedEpisode(claimCase.db, {runId: 'run-migration-replace-claim-target'});
		insertMigrationRunningTurn(claimCase.db, {
			runId: claimTargetEpisode.runId,
			turnId: 'chat-migration-replace-claim-target',
			idempotencyKey: 'migration-replace-claim-target',
			enqueueOrder: 454,
			timestamp,
		});
		const claimState = snapshot(claimCase.db);
		expect(() => claimCase.db.prepare(`
			INSERT OR REPLACE INTO chat_claims (id, turn_id, run_id, text, support_status, sort_order)
			VALUES ('claim-migration-replace-source', 'chat-migration-replace-claim-target', ?,
				'Synthetic replacement claim.', 'supported', 0)
		`).run(claimTargetEpisode.runId)).toThrow();
		expect(snapshot(claimCase.db)).toEqual(claimState);
		expect(() => claimCase.db.prepare(`
			INSERT OR REPLACE INTO chat_citations (claim_id, run_id, snapshot_id, excerpt, sort_order)
			SELECT claim_id, run_id, snapshot_id, excerpt, sort_order
			FROM chat_citations WHERE claim_id = 'claim-migration-replace-source'
		`).run()).toThrow();
		expect(snapshot(claimCase.db)).toEqual(claimState);

		const retryCase = createProviderUsingTurn('retry-replacement');
		failMigrationTurn(retryCase.db, retryCase.turnId, timestamp);
		retryCase.db.prepare(`
			INSERT INTO chat_retry_requests (turn_id, idempotency_key, requested_attempt_number, created_at)
			VALUES (?, 'retry-replacement-original', 2, ?)
		`).run(retryCase.turnId, timestamp);
		const retryState = snapshot(retryCase.db);
		expect(() => retryCase.db.prepare(`
			INSERT OR REPLACE INTO chat_retry_requests (
				turn_id, idempotency_key, requested_attempt_number, created_at
			) VALUES (?, 'retry-replacement-new', 2, ?)
		`).run(retryCase.turnId, timestamp)).toThrow();
		expect(snapshot(retryCase.db)).toEqual(retryState);
		expect(() => retryCase.db.prepare(`
			UPDATE OR REPLACE chat_retry_requests
			SET idempotency_key = 'retry-replacement-mutated'
			WHERE turn_id = ?
		`).run(retryCase.turnId)).toThrow(/chat retry identity/);
		expect(snapshot(retryCase.db)).toEqual(retryState);
	});

	it('allows only monotonic provider lifecycle transitions and leaves rejected rows unchanged', () => {
		const timestamp = '2026-08-07T12:00:00.000Z';
		const cases = [
			{
				name: 'reserved',
				advance: (_db: Database.Database, _id: string) => undefined,
				invalidTargets: ['reserved', 'finalized'],
			},
			{
				name: 'response_received',
				advance: (target: Database.Database, id: string) => receiveMigrationProviderCall(target, id, timestamp),
				invalidTargets: ['reserved', 'response_received', 'ambiguous'],
			},
			{
				name: 'ambiguous',
				advance: (target: Database.Database, id: string) => makeMigrationProviderCallAmbiguous(target, id, 'timeout', timestamp),
				invalidTargets: ['reserved', 'response_received', 'ambiguous', 'finalized'],
			},
			{
				name: 'finalized',
				advance: (target: Database.Database, id: string) => finalizeMigrationProviderCall(target, id, 'provider_rejected', timestamp),
				invalidTargets: ['reserved', 'response_received', 'ambiguous', 'finalized'],
			},
		] as const;
		const invalidUpdate = (status: 'reserved' | 'response_received' | 'ambiguous' | 'finalized'): string => {
			if (status === 'reserved') return `
				UPDATE chat_provider_calls
				SET status = 'reserved', safe_outcome = NULL, response_received_at = NULL,
					completed_at = NULL, input_tokens = NULL, cached_input_tokens = NULL,
					output_tokens = NULL, reasoning_output_tokens = NULL,
					provider_request_id = NULL, updated_at = ?
				WHERE id = ?
			`;
			if (status === 'response_received') return `
				UPDATE chat_provider_calls
				SET status = 'response_received', safe_outcome = 'response_received',
					response_received_at = ?, completed_at = NULL, updated_at = ?
				WHERE id = ?
			`;
			if (status === 'ambiguous') return `
				UPDATE chat_provider_calls
				SET status = 'ambiguous', safe_outcome = 'timeout', response_received_at = NULL,
					completed_at = ?, input_tokens = NULL, cached_input_tokens = NULL,
					output_tokens = NULL, reasoning_output_tokens = NULL,
					provider_request_id = NULL, updated_at = ?
				WHERE id = ?
			`;
			return `
				UPDATE chat_provider_calls
				SET status = 'finalized', safe_outcome = 'draft_refusal',
					response_received_at = ?, completed_at = ?, updated_at = ?
				WHERE id = ?
			`;
		};

		for (const [index, lifecycle] of cases.entries()) {
			const db = database();
			applyMigrations(db);
			const episode = insertGroundedEpisode(db, {runId: `run-migration-transition-${lifecycle.name}`});
			const turnId = `chat-migration-transition-${lifecycle.name}`;
			const callId = `call-migration-transition-${lifecycle.name}`;
			insertMigrationRunningTurn(db, {
				runId: episode.runId,
				turnId,
				idempotencyKey: `migration-transition-${lifecycle.name}`,
				enqueueOrder: 500 + index,
				timestamp,
			});
			reserveMigrationProviderCall(db, {id: callId, turnId, timestamp});
			lifecycle.advance(db, callId);
			const before = db.prepare('SELECT * FROM chat_provider_calls WHERE id = ?').get(callId);
			if (lifecycle.name === 'reserved') {
				expect(() => db.prepare(`
					UPDATE chat_provider_calls
					SET status = 'response_received', safe_outcome = NULL,
						response_received_at = ?, updated_at = ?
					WHERE id = ?
				`).run(timestamp, timestamp, callId)).toThrow();
				expect(db.prepare('SELECT * FROM chat_provider_calls WHERE id = ?').get(callId)).toEqual(before);
			}
			for (const invalidTarget of lifecycle.invalidTargets) {
				const args = invalidTarget === 'reserved'
					? [timestamp, callId]
					: invalidTarget === 'response_received' || invalidTarget === 'ambiguous'
						? [timestamp, timestamp, callId]
						: [timestamp, timestamp, timestamp, callId];
				expect(() => db.prepare(invalidUpdate(invalidTarget)).run(...args)).toThrow();
				expect(db.prepare('SELECT * FROM chat_provider_calls WHERE id = ?').get(callId)).toEqual(before);
			}
		}
	});

	it('enforces chat migration bounds, foreign keys, one global running turn, and one locked turn per episode', () => {
		const db = database();
		applyMigrations(db);
		const episode = insertGroundedEpisode(db);
		const lockedFailureEpisode = insertGroundedEpisode(db, {runId: 'run-migration-locked-failure'});
		const timestamp = '2026-08-07T12:00:00.000Z';
		const insertTurn = db.prepare(`
			INSERT INTO chat_turns (
				id, run_id, idempotency_key, enqueue_order, question, state, attempt_count,
				lease_owner, lease_expires_at, retryable, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, 1, 'worker', ?, 0, ?, ?)
		`);
		const insertFailedQuestion = db.prepare(`
			INSERT INTO chat_turns (
				id, run_id, idempotency_key, enqueue_order, question, state, episode_lock,
				attempt_count, retryable, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, 'failed', 0, 1, 0, ?, ?)
		`);
		db.prepare(`
			INSERT INTO chat_turns (
				id, run_id, idempotency_key, enqueue_order, question, state, episode_lock,
				attempt_count, lease_owner, lease_expires_at, retryable,
				created_at, updated_at, started_at
			) VALUES ('chat-failed-unresolved', ?, 'migration-failed-lock', 20,
				'Synthetic unresolved failure?', 'running', 1, 1, 'worker', ?, 0, ?, ?, ?)
		`).run(lockedFailureEpisode.runId, '2026-08-07T12:05:00.000Z', timestamp, timestamp, timestamp);
		db.prepare(`
			INSERT INTO chat_attempts (
				id, turn_id, attempt_number, worker_id, started_at, outcome
			) VALUES ('attempt-failed-unresolved', 'chat-failed-unresolved', 1, 'worker', ?, 'running')
		`).run(timestamp);
		reserveMigrationProviderCall(db, {
			id: 'provider-call-failed-unresolved',
			turnId: 'chat-failed-unresolved',
			timestamp,
		});
		db.prepare(`
			UPDATE chat_turns
			SET state = 'failed', lease_owner = NULL, lease_expires_at = NULL,
				error_code = 'SYNTHETIC_FAILURE', error_message = 'Synthetic failure',
				retryable = 0, updated_at = ?, completed_at = ?
			WHERE id = 'chat-failed-unresolved'
		`).run(timestamp, timestamp);
		db.prepare(`
			UPDATE chat_attempts
			SET finished_at = ?, outcome = 'recovered', error_code = 'SYNTHETIC_FAILURE',
				error_message = 'Synthetic failure'
			WHERE id = 'attempt-failed-unresolved'
		`).run(timestamp);
		expect(() => db.prepare(`
			UPDATE chat_turns SET episode_lock = 0 WHERE id = 'chat-failed-unresolved'
		`).run()).toThrow(/cannot release the episode lock/);
		const finalizedEpisode = insertGroundedEpisode(db, {runId: 'run-migration-finalized-call'});
		db.prepare(`
			INSERT INTO chat_turns (
				id, run_id, idempotency_key, enqueue_order, question, state, episode_lock,
				attempt_count, lease_owner, lease_expires_at, retryable,
				created_at, updated_at, started_at
			) VALUES ('chat-finalized-call', ?, 'migration-finalized-call', 22,
				'Synthetic finalized provider failure?', 'running', 1, 1, 'worker', ?, 0, ?, ?, ?)
		`).run(finalizedEpisode.runId, '2026-08-07T12:05:00.000Z', timestamp, timestamp, timestamp);
		db.prepare(`
			INSERT INTO chat_attempts (
				id, turn_id, attempt_number, worker_id, started_at, outcome
			) VALUES ('attempt-finalized-call', 'chat-finalized-call', 1, 'worker', ?, 'running')
		`).run(timestamp);
		reserveMigrationProviderCall(db, {
			id: 'provider-call-finalized',
			turnId: 'chat-finalized-call',
			timestamp,
		});
		finalizeMigrationProviderCall(db, 'provider-call-finalized', 'provider_rejected', timestamp);
		db.prepare(`
			UPDATE chat_turns
			SET state = 'failed', lease_owner = NULL, lease_expires_at = NULL,
				error_code = 'SYNTHETIC_FAILURE', error_message = 'Synthetic failure',
				retryable = 0, updated_at = ?, completed_at = ?
			WHERE id = 'chat-finalized-call'
		`).run(timestamp, timestamp);
		db.prepare(`
			UPDATE chat_attempts
			SET finished_at = ?, outcome = 'failed', error_code = 'SYNTHETIC_FAILURE',
				error_message = 'Synthetic failure'
			WHERE id = 'attempt-finalized-call'
		`).run(timestamp);
		insertTurn.run('chat-running-1', episode.runId, 'migration-chat-key-1', 1, 'Valid synthetic question?', 'running', '2026-08-07T12:01:00.000Z', timestamp, timestamp);
		expect(() => db.prepare(`
			UPDATE chat_turns SET episode_lock = 0 WHERE id = 'chat-finalized-call'
		`).run()).toThrow(/cannot release the episode lock/);
		expect(() => db.prepare(`
			INSERT INTO chat_turns (
				id, run_id, idempotency_key, enqueue_order, question, state,
				attempt_count, retryable, created_at, updated_at
			) VALUES ('chat-after-failed-unresolved', ?, 'migration-after-failed-lock', 21,
				'Should remain blocked?', 'queued', 0, 0, ?, ?)
		`).run(lockedFailureEpisode.runId, timestamp, timestamp)).toThrow();
		expect(() => insertTurn.run('chat-running-2', episode.runId, 'migration-chat-key-2', 2, 'Another valid question?', 'running', '2026-08-07T12:01:00.000Z', timestamp, timestamp)).toThrow();
		expect(() => db.prepare(`
			INSERT INTO chat_turns (
				id, run_id, idempotency_key, enqueue_order, question, state, attempt_count,
				retryable, created_at, updated_at
			) VALUES ('chat-queued-same-run', ?, 'migration-chat-key-queued', 9, 'Queued conflict?', 'queued', 0, 0, ?, ?)
		`).run(episode.runId, timestamp, timestamp)).toThrow();
		expect(() => insertTurn.run('chat-missing-run', 'missing-run', 'migration-chat-key-3', 3, 'Missing parent?', 'queued', null, timestamp, timestamp)).toThrow();
		expect(() => insertTurn.run('chat-empty', episode.runId, 'migration-chat-key-4', 4, '', 'queued', null, timestamp, timestamp)).toThrow();
		expect(() => insertTurn.run('chat-long', episode.runId, 'migration-chat-key-5', 5, 'x'.repeat(1_001), 'queued', null, timestamp, timestamp)).toThrow();
		expect(() => insertFailedQuestion.run('chat-question-nul', episode.runId, 'migration-chat-key-nul', 10, 'Bad\0question', timestamp, timestamp)).toThrow();
		expect(() => insertFailedQuestion.run('chat-question-surrogate', episode.runId, 'migration-chat-key-surrogate', 11, 'Bad\ud800question', timestamp, timestamp)).toThrow();
		expect(() => insertTurn.run('chat-duplicate-order', episode.runId, 'migration-chat-key-6', 1, 'Duplicate order?', 'queued', null, timestamp, timestamp)).toThrow();
		expect(() => db.prepare(`
			INSERT INTO chat_turns (
				id, run_id, idempotency_key, enqueue_order, question, state, attempt_count,
				retryable, created_at, updated_at
			) VALUES ('chat-too-many-attempts', ?, 'migration-chat-key-7', 7, 'Too many attempts?', 'failed', 3, 0, ?, ?)
		`).run(episode.runId, timestamp, timestamp)).toThrow();

		db.prepare(`
			INSERT INTO chat_attempts (id, turn_id, attempt_number, worker_id, started_at, outcome)
			VALUES ('attempt-running-1', 'chat-running-1', 1, 'worker', ?, 'running')
		`).run(timestamp);
		db.prepare(`
			INSERT INTO chat_claims (id, turn_id, run_id, text, support_status, sort_order)
			VALUES ('migration-valid-claim', 'chat-running-1', ?, 'Valid synthetic claim.', 'supported', 0)
		`).run(episode.runId);
		expect(() => db.prepare(`
			INSERT INTO chat_claims (id, turn_id, run_id, text, support_status, sort_order)
			VALUES ('migration-nul-claim', 'chat-running-1', ?, 'Bad\0claim', 'supported', 1)
		`).run(episode.runId)).toThrow();
		expect(() => db.prepare(`
			INSERT INTO chat_claims (id, turn_id, run_id, text, support_status, sort_order)
			VALUES ('migration-surrogate-claim', 'chat-running-1', ?, 'Bad\ud800claim', 'supported', 1)
		`).run(episode.runId)).toThrow();
		expect(() => db.prepare(`
			INSERT INTO chat_citations (claim_id, run_id, snapshot_id, excerpt, sort_order)
			VALUES ('migration-valid-claim', ?, ?, 'Bad\0excerpt', 0)
		`).run(episode.runId, episode.snapshotId)).toThrow();
		expect(() => db.prepare(`
			INSERT INTO chat_citations (claim_id, run_id, snapshot_id, excerpt, sort_order)
			VALUES ('migration-valid-claim', ?, ?, 'Bad\udc00excerpt', 0)
		`).run(episode.runId, episode.snapshotId)).toThrow();
		expect(() => db.prepare(`
			INSERT INTO chat_retry_requests (turn_id, idempotency_key, requested_attempt_number, created_at)
			VALUES ('chat-running-1', 'retry-invalid-attempt', 1, ?)
		`).run(timestamp)).toThrow();
		db.prepare(`
			INSERT INTO chat_retry_requests (turn_id, idempotency_key, requested_attempt_number, created_at)
			VALUES ('chat-running-1', 'retry-only', 2, ?)
		`).run(timestamp);
		expect(() => db.prepare(`
			INSERT INTO chat_retry_requests (turn_id, idempotency_key, requested_attempt_number, created_at)
			VALUES ('chat-running-1', 'retry-forbidden-second', 2, ?)
		`).run(timestamp)).toThrow();
		expect(() => db.prepare(`
			INSERT INTO chat_provider_calls (
				id, turn_id, attempt_number, stage, model, worker_id, status, reserved_at, updated_at
			) VALUES ('provider-call-bad-model', 'chat-running-1', 1, 'draft', 'unapproved-model', 'worker', 'reserved', ?, ?)
		`).run(timestamp, timestamp)).toThrow();
		const insertProviderCall = db.prepare(`
			INSERT INTO chat_provider_calls (
				id, turn_id, attempt_number, stage, model, worker_id, status, safe_outcome,
				input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens,
				provider_request_id, reserved_at, response_received_at, completed_at, updated_at
			) VALUES (
				?, 'chat-running-1', ?, ?, 'gpt-5.4-mini-2026-03-17', 'worker', ?, ?,
				?, ?, ?, ?, ?, ?, ?, ?, ?
			)
		`);
		const reserved = ['reserved', null, null, null, null, null, null, timestamp, null, null, timestamp] as const;
		expect(() => insertProviderCall.run('provider-call-bad-stage', 1, 'other', ...reserved)).toThrow();
		expect(() => insertProviderCall.run('provider-call-bad-attempt', 3, 'draft', ...reserved)).toThrow();
		expect(() => insertProviderCall.run('provider-call-bad-status', 1, 'draft', 'unknown', null, null, null, null, null, null, timestamp, null, null, timestamp)).toThrow();
		expect(() => insertProviderCall.run('provider-call-reserved-with-usage', 1, 'draft', 'reserved', null, 1, null, null, null, null, timestamp, null, null, timestamp)).toThrow();
		expect(() => insertProviderCall.run('provider-call-negative-input', 1, 'draft', 'response_received', 'response_received', -1, null, null, null, null, timestamp, timestamp, null, timestamp)).toThrow();
		expect(() => insertProviderCall.run('provider-call-oversized-input', 1, 'draft', 'response_received', 'response_received', 1_000_001, null, null, null, null, timestamp, timestamp, null, timestamp)).toThrow();
		expect(() => insertProviderCall.run('provider-call-invalid-cache', 1, 'draft', 'response_received', 'response_received', 10, 11, null, null, null, timestamp, timestamp, null, timestamp)).toThrow();
		expect(() => insertProviderCall.run('provider-call-invalid-reasoning', 1, 'draft', 'response_received', 'response_received', null, null, 5, 6, null, timestamp, timestamp, null, timestamp)).toThrow();
		expect(() => insertProviderCall.run('provider-call-long-id', 1, 'draft', 'response_received', 'response_received', null, null, null, null, 'r'.repeat(241), timestamp, timestamp, null, timestamp)).toThrow();
		expect(() => insertProviderCall.run('provider-call-ambiguous-with-response', 1, 'draft', 'ambiguous', 'timeout', null, null, null, null, null, timestamp, timestamp, timestamp, timestamp)).toThrow();
		expect(() => insertProviderCall.run('provider-call-draft-support-outcome', 1, 'draft', 'finalized', 'support_validated', null, null, null, null, null, timestamp, timestamp, timestamp, timestamp)).toThrow();
		expect(() => insertProviderCall.run('provider-call-support-draft-outcome', 1, 'support', 'finalized', 'draft_refusal', null, null, null, null, null, timestamp, timestamp, timestamp, timestamp)).toThrow();
		reserveMigrationProviderCall(db, {
			id: 'provider-call-valid',
			turnId: 'chat-running-1',
			timestamp,
		});
		receiveMigrationProviderCall(db, 'provider-call-valid', timestamp, {
			inputTokens: 10,
			cachedInputTokens: 2,
			outputTokens: 5,
			reasoningOutputTokens: 1,
			providerRequestId: 'resp_synthetic',
		});
		db.prepare(`
			UPDATE chat_provider_calls
			SET status = 'finalized', safe_outcome = 'draft_refusal', completed_at = ?, updated_at = ?
			WHERE id = 'provider-call-valid'
		`).run(timestamp, timestamp);
		expect(() => db.prepare(`
			INSERT INTO chat_provider_calls (
				id, turn_id, attempt_number, stage, model, worker_id, status, reserved_at, updated_at
			) VALUES (
				'provider-call-duplicate-stage', 'chat-running-1', 1, 'draft',
				'gpt-5.4-mini-2026-03-17', 'worker', 'reserved', ?, ?
			)
		`).run(timestamp, timestamp)).toThrow();
	});
});
