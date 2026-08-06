export interface MigrationDatabase {
	exec(sql: string): unknown;
	prepare(sql: string): {
		all(...params: unknown[]): unknown[];
		get(...params: unknown[]): unknown;
		run(...params: unknown[]): {changes: number};
	};
	transaction(fn: () => void): () => void;
}

export interface Migration {
	id: string;
	up: (db: MigrationDatabase) => void;
}

const hasColumn = (db: MigrationDatabase, tableName: string, columnName: string): boolean => {
	const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{name: string}>;
	return rows.some(row => row.name === columnName);
};

const migrations: Migration[] = [
	{
		id: '001_initial_schema',
		up: db => {
				db.exec(`
				CREATE TABLE IF NOT EXISTS sources (
					id TEXT PRIMARY KEY,
					type TEXT NOT NULL,
					name TEXT NOT NULL,
					url TEXT,
					description TEXT,
					category TEXT,
					is_active INTEGER NOT NULL,
					status TEXT,
					added_at TEXT NOT NULL
				);

				CREATE TABLE IF NOT EXISTS source_items (
					id TEXT PRIMARY KEY,
					source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
					title TEXT NOT NULL,
					content TEXT NOT NULL,
					url TEXT,
					published_at TEXT,
					gathered_at TEXT NOT NULL
				);

				CREATE TABLE IF NOT EXISTS briefing_runs (
					id TEXT PRIMARY KEY,
					title TEXT NOT NULL,
					status TEXT NOT NULL,
					created_at TEXT NOT NULL,
					completed_at TEXT,
					summary TEXT
				);

				CREATE TABLE IF NOT EXISTS briefing_run_sources (
					run_id TEXT NOT NULL REFERENCES briefing_runs(id) ON DELETE CASCADE,
					source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
					PRIMARY KEY (run_id, source_id)
				);

				CREATE TABLE IF NOT EXISTS briefing_sections (
					id TEXT PRIMARY KEY,
					run_id TEXT NOT NULL REFERENCES briefing_runs(id) ON DELETE CASCADE,
					title TEXT NOT NULL,
					type TEXT NOT NULL,
					spoken_text TEXT NOT NULL,
					source_item_ids_json TEXT NOT NULL DEFAULT '[]',
					importance_score INTEGER NOT NULL,
					follow_up_prompts_json TEXT NOT NULL DEFAULT '[]',
					sort_order INTEGER NOT NULL
				);

				CREATE TABLE IF NOT EXISTS audio_assets (
					id TEXT PRIMARY KEY,
					run_id TEXT NOT NULL UNIQUE REFERENCES briefing_runs(id) ON DELETE CASCADE,
					url TEXT NOT NULL,
					duration_ms INTEGER NOT NULL,
					format TEXT NOT NULL
				);

				CREATE TABLE IF NOT EXISTS app_settings (
					id TEXT PRIMARY KEY,
					settings_json TEXT NOT NULL,
					updated_at TEXT NOT NULL
				);

				CREATE INDEX IF NOT EXISTS idx_source_items_source_id ON source_items(source_id);
				CREATE INDEX IF NOT EXISTS idx_briefing_runs_created_at ON briefing_runs(created_at);
				CREATE INDEX IF NOT EXISTS idx_briefing_run_sources_source_id ON briefing_run_sources(source_id);
				CREATE INDEX IF NOT EXISTS idx_briefing_sections_run_id ON briefing_sections(run_id, sort_order);
			`);
		},
	},
	{
		id: '002_source_item_identity',
		up: db => {
			if (!hasColumn(db, 'source_items', 'external_id')) {
				db.exec('ALTER TABLE source_items ADD COLUMN external_id TEXT');
			}

			if (!hasColumn(db, 'source_items', 'author')) {
				db.exec('ALTER TABLE source_items ADD COLUMN author TEXT');
			}

			db.exec(`
				CREATE UNIQUE INDEX IF NOT EXISTS idx_source_items_source_external_id
				ON source_items(source_id, external_id)
				WHERE external_id IS NOT NULL;

				CREATE INDEX IF NOT EXISTS idx_source_items_published_at ON source_items(published_at);
				CREATE INDEX IF NOT EXISTS idx_source_items_gathered_at ON source_items(gathered_at);
			`);
		},
	},
	{
		id: '003_source_sync_metadata',
		up: db => {
			if (!hasColumn(db, 'sources', 'last_synced_at')) {
				db.exec('ALTER TABLE sources ADD COLUMN last_synced_at TEXT');
			}

			if (!hasColumn(db, 'sources', 'last_sync_status')) {
				db.exec('ALTER TABLE sources ADD COLUMN last_sync_status TEXT');
			}

			if (!hasColumn(db, 'sources', 'last_sync_error')) {
				db.exec('ALTER TABLE sources ADD COLUMN last_sync_error TEXT');
			}

			if (!hasColumn(db, 'sources', 'consecutive_sync_failures')) {
				db.exec('ALTER TABLE sources ADD COLUMN consecutive_sync_failures INTEGER NOT NULL DEFAULT 0');
			}

			if (!hasColumn(db, 'sources', 'next_sync_after')) {
				db.exec('ALTER TABLE sources ADD COLUMN next_sync_after TEXT');
			}

			db.exec('CREATE INDEX IF NOT EXISTS idx_sources_next_sync_after ON sources(next_sync_after)');
		},
	},
	{
		id: '004_generation_jobs',
		up: db => {
			db.exec(`
				CREATE TABLE IF NOT EXISTS localcast_metadata (
					key TEXT PRIMARY KEY,
					value TEXT NOT NULL,
					updated_at TEXT NOT NULL
				);

				CREATE TABLE IF NOT EXISTS generation_jobs (
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

				CREATE UNIQUE INDEX IF NOT EXISTS idx_generation_jobs_active_slot
					ON generation_jobs(active_slot)
					WHERE state = 'running';

				CREATE INDEX IF NOT EXISTS idx_generation_jobs_fifo
					ON generation_jobs(state, datetime(created_at), id);

				CREATE INDEX IF NOT EXISTS idx_generation_jobs_lease
					ON generation_jobs(state, lease_expires_at);

				CREATE TABLE IF NOT EXISTS generation_attempts (
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

				CREATE TABLE IF NOT EXISTS generation_job_events (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					job_id TEXT NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
					attempt_number INTEGER,
					phase TEXT NOT NULL CHECK (phase IN ('queued', 'syncing', 'selecting', 'drafting', 'validating', 'rendering_audio', 'complete', 'failed')),
					detail TEXT,
					created_at TEXT NOT NULL
				);

				CREATE INDEX IF NOT EXISTS idx_generation_job_events_order
					ON generation_job_events(job_id, id);
			`);

			const rows = db.prepare('SELECT id, settings_json FROM app_settings').all() as Array<{id: string; settings_json: string}>;
			const update = db.prepare('UPDATE app_settings SET settings_json = ?, updated_at = ? WHERE id = ?');
			const now = new Date().toISOString();
			const allowedKeys = ['orbTheme', 'theme', 'contrastMode', 'colorVisionMode', 'textSize', 'density'];

			for (const row of rows) {
				try {
					const current = JSON.parse(row.settings_json) as Record<string, unknown>;
					const sanitized = Object.fromEntries(allowedKeys.flatMap(key => current[key] === undefined ? [] : [[key, current[key]]]));
					update.run(JSON.stringify(sanitized), now, row.id);
				} catch {
					update.run('{}', now, row.id);
				}
			}

			db.prepare(`
				UPDATE briefing_runs
				SET status = 'failed', completed_at = COALESCE(completed_at, ?), summary = NULL
				WHERE status NOT IN ('complete', 'failed')
					AND NOT EXISTS (SELECT 1 FROM generation_jobs WHERE generation_jobs.run_id = briefing_runs.id)
			`).run(now);
		},
	},
	{
		id: '005_real_provider_walking_skeleton',
		up: db => {
			db.exec(`
				CREATE TABLE IF NOT EXISTS notes (
					id TEXT PRIMARY KEY,
					revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
					title TEXT NOT NULL,
					body TEXT NOT NULL,
					author TEXT,
					original_url TEXT,
					created_at TEXT NOT NULL,
					updated_at TEXT NOT NULL
				);

				CREATE TABLE IF NOT EXISTS stations (
					id TEXT PRIMARY KEY,
					revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
					name TEXT NOT NULL,
					topic_instruction TEXT NOT NULL,
					default_mode TEXT NOT NULL CHECK (default_mode IN ('brief', 'deep')),
					created_at TEXT NOT NULL,
					updated_at TEXT NOT NULL
				);

				CREATE TABLE IF NOT EXISTS station_notes (
					station_id TEXT NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
					note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
					sort_order INTEGER NOT NULL,
					PRIMARY KEY (station_id, note_id)
				);

				CREATE TABLE IF NOT EXISTS station_sources (
					station_id TEXT NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
					source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
					sort_order INTEGER NOT NULL,
					PRIMARY KEY (station_id, source_id)
				);

				CREATE TABLE IF NOT EXISTS generation_requests (
					id TEXT PRIMARY KEY,
					run_id TEXT NOT NULL UNIQUE REFERENCES briefing_runs(id) ON DELETE CASCADE,
					station_id_snapshot TEXT NOT NULL,
					station_revision INTEGER NOT NULL,
					station_name TEXT NOT NULL,
					topic_instruction TEXT NOT NULL,
					requested_mode TEXT NOT NULL CHECK (requested_mode IN ('brief', 'deep')),
					request_hash TEXT NOT NULL,
					requested_at TEXT NOT NULL
				);

				CREATE TABLE IF NOT EXISTS generation_request_notes (
					request_id TEXT NOT NULL REFERENCES generation_requests(id) ON DELETE CASCADE,
					note_id_snapshot TEXT NOT NULL,
					note_revision INTEGER NOT NULL,
					title TEXT NOT NULL,
					body TEXT NOT NULL,
					author TEXT,
					original_url TEXT,
					sort_order INTEGER NOT NULL,
					PRIMARY KEY (request_id, note_id_snapshot)
				);

				CREATE TABLE IF NOT EXISTS generation_request_sources (
					request_id TEXT NOT NULL REFERENCES generation_requests(id) ON DELETE CASCADE,
					source_id_snapshot TEXT NOT NULL,
					sort_order INTEGER NOT NULL,
					PRIMARY KEY (request_id, source_id_snapshot)
				);

				CREATE TABLE IF NOT EXISTS episode_evidence_snapshots (
					id TEXT PRIMARY KEY,
					run_id TEXT NOT NULL REFERENCES briefing_runs(id) ON DELETE CASCADE,
					request_id TEXT NOT NULL REFERENCES generation_requests(id) ON DELETE CASCADE,
					kind TEXT NOT NULL CHECK (kind IN ('note', 'feed')),
					original_id_snapshot TEXT NOT NULL,
					title TEXT NOT NULL,
					body TEXT NOT NULL,
					author TEXT,
					original_url TEXT,
					published_at TEXT,
					content_sha256 TEXT NOT NULL,
					sort_order INTEGER NOT NULL,
					UNIQUE (run_id, id)
				);

				CREATE TABLE IF NOT EXISTS transcript_claims (
					id TEXT PRIMARY KEY,
					run_id TEXT NOT NULL REFERENCES briefing_runs(id) ON DELETE CASCADE,
					section_id TEXT NOT NULL REFERENCES briefing_sections(id) ON DELETE CASCADE,
					kind TEXT NOT NULL CHECK (kind IN ('factual', 'transition')),
					text TEXT NOT NULL,
					support_status TEXT NOT NULL CHECK (support_status IN ('not_required', 'supported')),
					sort_order INTEGER NOT NULL
				);

				CREATE TABLE IF NOT EXISTS episode_citations (
					claim_id TEXT NOT NULL REFERENCES transcript_claims(id) ON DELETE CASCADE,
					snapshot_id TEXT NOT NULL REFERENCES episode_evidence_snapshots(id) ON DELETE RESTRICT,
					excerpt TEXT NOT NULL,
					sort_order INTEGER NOT NULL,
					PRIMARY KEY (claim_id, snapshot_id, sort_order)
				);

				CREATE TABLE IF NOT EXISTS provider_checks (
					capability TEXT PRIMARY KEY CHECK (capability IN ('text', 'speech')),
					adapter TEXT NOT NULL,
					model TEXT NOT NULL,
					voice TEXT,
					configuration_fingerprint TEXT NOT NULL,
					status TEXT NOT NULL CHECK (status IN ('LIVE VERIFIED', 'CONTRACT TESTED ONLY', 'NOT CONFIGURED')),
					reason TEXT NOT NULL,
					verified_at TEXT,
					updated_at TEXT NOT NULL
				);

				CREATE INDEX IF NOT EXISTS idx_station_notes_order ON station_notes(station_id, sort_order);
				CREATE INDEX IF NOT EXISTS idx_station_sources_order ON station_sources(station_id, sort_order);
				CREATE INDEX IF NOT EXISTS idx_evidence_run_order ON episode_evidence_snapshots(run_id, sort_order);
				CREATE INDEX IF NOT EXISTS idx_claims_run_order ON transcript_claims(run_id, section_id, sort_order);
				CREATE INDEX IF NOT EXISTS idx_citations_claim_order ON episode_citations(claim_id, sort_order);
			`);

			const runColumns: Array<[string, string]> = [
				['mode', "TEXT CHECK (mode IN ('brief', 'deep'))"],
				['station_id_snapshot', 'TEXT'],
				['station_name_snapshot', 'TEXT'],
				['station_revision', 'INTEGER'],
				['text_provider', 'TEXT'],
				['text_model', 'TEXT'],
				['speech_provider', 'TEXT'],
				['speech_model', 'TEXT'],
				['speech_voice', 'TEXT'],
				['ai_generated', 'INTEGER NOT NULL DEFAULT 0'],
			];
			for (const [name, definition] of runColumns) {
				if (!hasColumn(db, 'briefing_runs', name)) db.exec(`ALTER TABLE briefing_runs ADD COLUMN ${name} ${definition}`);
			}

			const audioColumns: Array<[string, string]> = [
				['storage_filename', 'TEXT'],
				['mime_type', 'TEXT'],
				['byte_length', 'INTEGER'],
				['sha256', 'TEXT'],
				['validated_at', 'TEXT'],
				['provider', 'TEXT'],
				['model', 'TEXT'],
				['voice', 'TEXT'],
				['ai_generated', 'INTEGER NOT NULL DEFAULT 0'],
			];
			for (const [name, definition] of audioColumns) {
				if (!hasColumn(db, 'audio_assets', name)) db.exec(`ALTER TABLE audio_assets ADD COLUMN ${name} ${definition}`);
			}

			const settingsRows = db.prepare('SELECT id, settings_json FROM app_settings').all() as Array<{id: string; settings_json: string}>;
			const updateSettings = db.prepare('UPDATE app_settings SET settings_json = ?, updated_at = ? WHERE id = ?');
			const allowedSettings = ['orbTheme', 'theme', 'contrastMode', 'colorVisionMode', 'textSize', 'density'];
			const timestamp = new Date().toISOString();
			for (const row of settingsRows) {
				try {
					const current = JSON.parse(row.settings_json) as Record<string, unknown>;
					const sanitized = Object.fromEntries(allowedSettings.flatMap(key => current[key] === undefined ? [] : [[key, current[key]]]));
					updateSettings.run(JSON.stringify(sanitized), timestamp, row.id);
				} catch {
					updateSettings.run('{}', timestamp, row.id);
				}
			}

			db.prepare(`
				UPDATE briefing_runs
				SET status = 'failed', completed_at = COALESCE(completed_at, ?), summary = NULL
				WHERE status NOT IN ('complete', 'failed')
					AND NOT EXISTS (SELECT 1 FROM generation_jobs WHERE generation_jobs.run_id = briefing_runs.id)
			`).run(timestamp);
		},
	},
	{
		id: '006_feed_ingestion_and_fts',
		up: db => {
			const sourceColumns: Array<[string, string]> = [
				['feed_etag', 'TEXT'],
				['feed_last_modified', 'TEXT'],
				['feed_validator_url', 'TEXT'],
				['feed_network_scope', "TEXT NOT NULL DEFAULT 'unknown' CHECK (feed_network_scope IN ('public', 'private', 'unknown'))"],
				['last_checked_at', 'TEXT'],
				['last_changed_at', 'TEXT'],
				['last_sync_error_code', 'TEXT'],
				['sync_lease_owner', 'TEXT'],
				['sync_lease_expires_at', 'TEXT'],
			];
			for (const [name, definition] of sourceColumns) {
				if (!hasColumn(db, 'sources', name)) db.exec(`ALTER TABLE sources ADD COLUMN ${name} ${definition}`);
			}

			if (!hasColumn(db, 'source_items', 'feed_source_url')) {
				db.exec('ALTER TABLE source_items ADD COLUMN feed_source_url TEXT');
			}
			if (!hasColumn(db, 'source_items', 'network_scope')) {
				db.exec("ALTER TABLE source_items ADD COLUMN network_scope TEXT NOT NULL DEFAULT 'unknown' CHECK (network_scope IN ('public', 'private', 'unknown'))");
			}
			db.exec(`
				UPDATE source_items
				SET feed_source_url = (
					SELECT sources.url FROM sources WHERE sources.id = source_items.source_id
				)
				WHERE feed_source_url IS NULL
			`);

			const requestSourceColumns: Array<[string, string]> = [
				['source_name_snapshot', 'TEXT'],
				['source_url_snapshot', 'TEXT'],
				['network_scope_snapshot', "TEXT NOT NULL DEFAULT 'unknown'"],
				['sync_status', "TEXT NOT NULL DEFAULT 'pending'"],
				['sync_error_code', 'TEXT'],
				['synced_at', 'TEXT'],
			];
			for (const [name, definition] of requestSourceColumns) {
				if (!hasColumn(db, 'generation_request_sources', name)) db.exec(`ALTER TABLE generation_request_sources ADD COLUMN ${name} ${definition}`);
			}

			const evidenceColumns: Array<[string, string]> = [
				['source_id_snapshot', 'TEXT'],
				['source_name_snapshot', 'TEXT'],
				['network_scope', "TEXT NOT NULL DEFAULT 'user_supplied'"],
			];
			for (const [name, definition] of evidenceColumns) {
				if (!hasColumn(db, 'episode_evidence_snapshots', name)) db.exec(`ALTER TABLE episode_evidence_snapshots ADD COLUMN ${name} ${definition}`);
			}

			db.exec(`
				CREATE INDEX IF NOT EXISTS idx_sources_sync_lease ON sources(sync_lease_expires_at);
				CREATE INDEX IF NOT EXISTS idx_source_items_feed_url ON source_items(source_id, feed_source_url);

				CREATE VIRTUAL TABLE IF NOT EXISTS material_fts USING fts5(
					kind UNINDEXED,
					material_id UNINDEXED,
					source_id UNINDEXED,
					source_name,
					title,
					body,
					author,
					url UNINDEXED,
					occurred_at UNINDEXED,
					tokenize = 'unicode61 remove_diacritics 2'
				);

				CREATE TRIGGER IF NOT EXISTS material_fts_source_item_insert
				AFTER INSERT ON source_items BEGIN
					INSERT INTO material_fts(kind, material_id, source_id, source_name, title, body, author, url, occurred_at)
					SELECT 'feed', NEW.id, NEW.source_id, s.name, NEW.title, NEW.content, COALESCE(NEW.author, ''), COALESCE(NEW.url, ''), COALESCE(NEW.published_at, NEW.gathered_at)
					FROM sources s WHERE s.id = NEW.source_id;
				END;

				CREATE TRIGGER IF NOT EXISTS material_fts_source_item_update
				AFTER UPDATE ON source_items BEGIN
					DELETE FROM material_fts WHERE kind = 'feed' AND material_id = OLD.id;
					INSERT INTO material_fts(kind, material_id, source_id, source_name, title, body, author, url, occurred_at)
					SELECT 'feed', NEW.id, NEW.source_id, s.name, NEW.title, NEW.content, COALESCE(NEW.author, ''), COALESCE(NEW.url, ''), COALESCE(NEW.published_at, NEW.gathered_at)
					FROM sources s WHERE s.id = NEW.source_id;
				END;

				CREATE TRIGGER IF NOT EXISTS material_fts_source_item_delete
				AFTER DELETE ON source_items BEGIN
					DELETE FROM material_fts WHERE kind = 'feed' AND material_id = OLD.id;
				END;

				CREATE TRIGGER IF NOT EXISTS material_fts_source_name_update
				AFTER UPDATE OF name ON sources BEGIN
					UPDATE material_fts SET source_name = NEW.name WHERE kind = 'feed' AND source_id = NEW.id;
				END;

				CREATE TRIGGER IF NOT EXISTS material_fts_note_insert
				AFTER INSERT ON notes BEGIN
					INSERT INTO material_fts(kind, material_id, source_id, source_name, title, body, author, url, occurred_at)
					VALUES ('note', NEW.id, '', 'Pasted note', NEW.title, NEW.body, COALESCE(NEW.author, ''), COALESCE(NEW.original_url, ''), NEW.updated_at);
				END;

				CREATE TRIGGER IF NOT EXISTS material_fts_note_update
				AFTER UPDATE ON notes BEGIN
					DELETE FROM material_fts WHERE kind = 'note' AND material_id = OLD.id;
					INSERT INTO material_fts(kind, material_id, source_id, source_name, title, body, author, url, occurred_at)
					VALUES ('note', NEW.id, '', 'Pasted note', NEW.title, NEW.body, COALESCE(NEW.author, ''), COALESCE(NEW.original_url, ''), NEW.updated_at);
				END;

				CREATE TRIGGER IF NOT EXISTS material_fts_note_delete
				AFTER DELETE ON notes BEGIN
					DELETE FROM material_fts WHERE kind = 'note' AND material_id = OLD.id;
				END;

				DELETE FROM material_fts;
				INSERT INTO material_fts(kind, material_id, source_id, source_name, title, body, author, url, occurred_at)
				SELECT 'feed', si.id, si.source_id, s.name, si.title, si.content, COALESCE(si.author, ''), COALESCE(si.url, ''), COALESCE(si.published_at, si.gathered_at)
				FROM source_items si JOIN sources s ON s.id = si.source_id;
				INSERT INTO material_fts(kind, material_id, source_id, source_name, title, body, author, url, occurred_at)
				SELECT 'note', n.id, '', 'Pasted note', n.title, n.body, COALESCE(n.author, ''), COALESCE(n.original_url, ''), n.updated_at
				FROM notes n;
			`);

			const settingsRows = db.prepare('SELECT id, settings_json FROM app_settings').all() as Array<{id: string; settings_json: string}>;
			const updateSettings = db.prepare('UPDATE app_settings SET settings_json = ?, updated_at = ? WHERE id = ?');
			const allowedSettings = ['orbTheme', 'theme', 'contrastMode', 'colorVisionMode', 'textSize', 'density'];
			const timestamp = new Date().toISOString();
			for (const row of settingsRows) {
				try {
					const current = JSON.parse(row.settings_json) as Record<string, unknown>;
					const sanitized = Object.fromEntries(allowedSettings.flatMap(key => current[key] === undefined ? [] : [[key, current[key]]]));
					updateSettings.run(JSON.stringify(sanitized), timestamp, row.id);
				} catch {
					updateSettings.run('{}', timestamp, row.id);
				}
			}
			db.prepare(`
				UPDATE briefing_runs
				SET status = 'failed', completed_at = COALESCE(completed_at, ?), summary = NULL
				WHERE status NOT IN ('complete', 'failed')
					AND NOT EXISTS (SELECT 1 FROM generation_jobs WHERE generation_jobs.run_id = briefing_runs.id)
			`).run(timestamp);
		},
	},
];

export const migrationIds = migrations.map(migration => migration.id);

export const applyMigrationPlan = (db: MigrationDatabase, plan: Migration[]): void => {
	db.exec(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			id TEXT PRIMARY KEY,
			applied_at TEXT NOT NULL
		);
	`);

	const appliedRows = db.prepare('SELECT id FROM schema_migrations').all() as Array<{id: string}>;
	const appliedIds = new Set(appliedRows.map(row => row.id));
	const knownIds = new Set(plan.map(migration => migration.id));
	const unknownIds = [...appliedIds].filter(id => !knownIds.has(id));
	if (unknownIds.length > 0) {
		throw new Error(`Database schema is newer than this LocalCast build: ${unknownIds.join(', ')}`);
	}

	const insertMigration = db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)');

	const runPending = db.transaction(() => {
		for (const migration of plan) {
			if (appliedIds.has(migration.id)) continue;

			migration.up(db);
			insertMigration.run(migration.id, new Date().toISOString());
		}
	});

	runPending();
};

export const applyMigrations = (db: MigrationDatabase): void => applyMigrationPlan(db, migrations);

export const migrationPlanThrough = (id: string): Migration[] => {
	const index = migrations.findIndex(migration => migration.id === id);
	if (index < 0) throw new Error(`Unknown migration target: ${id}`);
	return migrations.slice(0, index + 1);
};
