import Database from 'better-sqlite3';
import {afterEach, describe, expect, it} from 'vitest';
import {applyMigrationPlan, applyMigrations, migrationIds, migrationPlanThrough} from '../../server/database/migrations';
import type {Migration} from '../../server/database/migrations';
import {GenerationJobStore} from '../../server/jobs/generationJobStore';
import {installFrozenMigrationSnapshot} from '../fixtures/migrationSnapshots';

const databases: Database.Database[] = [];
const database = (): Database.Database => {
	const value = new Database(':memory:');
	value.pragma('foreign_keys = ON');
	databases.push(value);
	return value;
};

afterEach(() => {
	while (databases.length > 0) databases.pop()?.close();
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
});
