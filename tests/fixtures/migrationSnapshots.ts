import type Database from 'better-sqlite3';

const initialSchema = `
	CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
	CREATE TABLE sources (
		id TEXT PRIMARY KEY, type TEXT NOT NULL, name TEXT NOT NULL, url TEXT, description TEXT,
		category TEXT, is_active INTEGER NOT NULL, status TEXT, added_at TEXT NOT NULL
	);
	CREATE TABLE source_items (
		id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
		title TEXT NOT NULL, content TEXT NOT NULL, url TEXT, published_at TEXT, gathered_at TEXT NOT NULL
	);
	CREATE TABLE briefing_runs (
		id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL,
		completed_at TEXT, summary TEXT
	);
	CREATE TABLE briefing_run_sources (
		run_id TEXT NOT NULL REFERENCES briefing_runs(id) ON DELETE CASCADE,
		source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
		PRIMARY KEY (run_id, source_id)
	);
	CREATE TABLE briefing_sections (
		id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES briefing_runs(id) ON DELETE CASCADE,
		title TEXT NOT NULL, type TEXT NOT NULL, spoken_text TEXT NOT NULL,
		source_item_ids_json TEXT NOT NULL DEFAULT '[]', importance_score INTEGER NOT NULL,
		follow_up_prompts_json TEXT NOT NULL DEFAULT '[]', sort_order INTEGER NOT NULL
	);
	CREATE TABLE audio_assets (
		id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE REFERENCES briefing_runs(id) ON DELETE CASCADE,
		url TEXT NOT NULL, duration_ms INTEGER NOT NULL, format TEXT NOT NULL
	);
	CREATE TABLE app_settings (id TEXT PRIMARY KEY, settings_json TEXT NOT NULL, updated_at TEXT NOT NULL);
	CREATE INDEX idx_source_items_source_id ON source_items(source_id);
	CREATE INDEX idx_briefing_runs_created_at ON briefing_runs(created_at);
	CREATE INDEX idx_briefing_run_sources_source_id ON briefing_run_sources(source_id);
	CREATE INDEX idx_briefing_sections_run_id ON briefing_sections(run_id, sort_order);
`;

const migration002 = `
	ALTER TABLE source_items ADD COLUMN external_id TEXT;
	ALTER TABLE source_items ADD COLUMN author TEXT;
	CREATE UNIQUE INDEX idx_source_items_source_external_id ON source_items(source_id, external_id) WHERE external_id IS NOT NULL;
	CREATE INDEX idx_source_items_published_at ON source_items(published_at);
	CREATE INDEX idx_source_items_gathered_at ON source_items(gathered_at);
`;

const migration003 = `
	ALTER TABLE sources ADD COLUMN last_synced_at TEXT;
	ALTER TABLE sources ADD COLUMN last_sync_status TEXT;
	ALTER TABLE sources ADD COLUMN last_sync_error TEXT;
	ALTER TABLE sources ADD COLUMN consecutive_sync_failures INTEGER NOT NULL DEFAULT 0;
	ALTER TABLE sources ADD COLUMN next_sync_after TEXT;
	CREATE INDEX idx_sources_next_sync_after ON sources(next_sync_after);
`;

const migration004 = `
	CREATE TABLE localcast_metadata (
		key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL
	);
	CREATE TABLE generation_jobs (
		id TEXT PRIMARY KEY,
		run_id TEXT NOT NULL UNIQUE REFERENCES briefing_runs(id) ON DELETE CASCADE,
		idempotency_key TEXT UNIQUE,
		payload_version INTEGER NOT NULL,
		payload_json TEXT NOT NULL,
		state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'complete', 'failed')),
		phase TEXT NOT NULL CHECK (phase IN ('queued', 'syncing', 'selecting', 'drafting', 'validating', 'rendering_audio', 'complete', 'failed')),
		active_slot INTEGER NOT NULL DEFAULT 1 CHECK (active_slot = 1),
		attempt_count INTEGER NOT NULL DEFAULT 0,
		lease_owner TEXT,
		lease_expires_at TEXT,
		error_code TEXT,
		error_message TEXT,
		retryable INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		started_at TEXT,
		completed_at TEXT
	);
	CREATE UNIQUE INDEX idx_generation_jobs_active_slot ON generation_jobs(active_slot) WHERE state = 'running';
	CREATE INDEX idx_generation_jobs_fifo ON generation_jobs(state, datetime(created_at), id);
	CREATE INDEX idx_generation_jobs_lease ON generation_jobs(state, lease_expires_at);
	CREATE TABLE generation_attempts (
		id TEXT PRIMARY KEY,
		job_id TEXT NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
		attempt_number INTEGER NOT NULL,
		worker_id TEXT NOT NULL,
		started_at TEXT NOT NULL,
		finished_at TEXT,
		outcome TEXT CHECK (outcome IN ('running', 'complete', 'failed', 'interrupted', 'recovered')),
		error_code TEXT,
		error_message TEXT,
		UNIQUE (job_id, attempt_number)
	);
	CREATE TABLE generation_job_events (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		job_id TEXT NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
		attempt_number INTEGER,
		phase TEXT NOT NULL CHECK (phase IN ('queued', 'syncing', 'selecting', 'drafting', 'validating', 'rendering_audio', 'complete', 'failed')),
		detail TEXT,
		created_at TEXT NOT NULL
	);
	CREATE INDEX idx_generation_job_events_order ON generation_job_events(job_id, id);
`;

export const installFrozenMigrationSnapshot = (database: Database.Database, migrationId: string): void => {
	database.exec(initialSchema);
	database.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run('001_initial_schema', '2026-01-01T00:00:00.000Z');
	if (migrationId === '001_initial_schema') return;

	database.exec(migration002);
	database.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run('002_source_item_identity', '2026-01-02T00:00:00.000Z');
	if (migrationId === '002_source_item_identity') return;

	database.exec(migration003);
	database.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run('003_source_sync_metadata', '2026-01-03T00:00:00.000Z');
	if (migrationId === '003_source_sync_metadata') return;

	if (migrationId !== '004_generation_jobs') throw new Error(`Unknown frozen migration snapshot: ${migrationId}`);
	database.exec(migration004);
	database.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run('004_generation_jobs', '2026-01-04T00:00:00.000Z');
};
