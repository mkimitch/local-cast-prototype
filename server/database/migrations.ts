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
	{
		id: '007_grounded_episode_workflow',
		up: db => {
			if (!hasColumn(db, 'briefing_runs', 'script_format_version')) {
				db.exec('ALTER TABLE briefing_runs ADD COLUMN script_format_version INTEGER CHECK (script_format_version = 1)');
			}
			const claimColumns: Array<[string, string]> = [
				['speaker_role', "TEXT NOT NULL DEFAULT 'host'"],
				['speaker_label', 'TEXT'],
				['voice_profile', 'TEXT'],
			];
			for (const [name, definition] of claimColumns) {
				if (!hasColumn(db, 'transcript_claims', name)) db.exec(`ALTER TABLE transcript_claims ADD COLUMN ${name} ${definition}`);
			}
			db.exec(`
				UPDATE briefing_runs
				SET script_format_version = 1
				WHERE EXISTS (
					SELECT 1 FROM transcript_claims
					WHERE transcript_claims.run_id = briefing_runs.id
				);

				CREATE TABLE IF NOT EXISTS generation_retry_requests (
					job_id TEXT NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
					idempotency_key TEXT NOT NULL,
					requested_attempt_number INTEGER NOT NULL,
					created_at TEXT NOT NULL,
					PRIMARY KEY (job_id, idempotency_key)
				);
			`);
		},
	},
	{
		id: '008_episode_grounded_chat',
		up: db => {
			db.exec(`
				CREATE TABLE IF NOT EXISTS chat_turns (
					id TEXT PRIMARY KEY,
					run_id TEXT NOT NULL REFERENCES briefing_runs(id) ON DELETE CASCADE,
					idempotency_key TEXT NOT NULL UNIQUE CHECK (
						length(idempotency_key) BETWEEN 8 AND 200
						AND idempotency_key = trim(idempotency_key)
						AND instr(idempotency_key, char(0)) = 0
						AND instr(idempotency_key, char(65533)) = 0
						AND instr(hex(CAST(idempotency_key AS BLOB)), 'EFBFBD') = 0
						AND hex(CAST(idempotency_key AS BLOB)) NOT GLOB '*ED[AB][0-9A-F][89AB][0-9A-F]*'
					),
					enqueue_order INTEGER NOT NULL UNIQUE CHECK (enqueue_order > 0),
					question TEXT NOT NULL CHECK (
						length(question) BETWEEN 1 AND 1000
						AND question = trim(question)
						AND instr(question, char(0)) = 0
						AND instr(question, char(65533)) = 0
						AND instr(hex(CAST(question AS BLOB)), 'EFBFBD') = 0
						AND hex(CAST(question AS BLOB)) NOT GLOB '*ED[AB][0-9A-F][89AB][0-9A-F]*'
					),
					state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'answered', 'refused', 'failed')),
					answer_kind TEXT CHECK (answer_kind IN ('answer', 'refusal')),
					refusal_code TEXT CHECK (refusal_code IS NULL OR refusal_code = 'EVIDENCE_INSUFFICIENT'),
					active_slot INTEGER NOT NULL DEFAULT 1 CHECK (active_slot = 1),
					episode_lock INTEGER NOT NULL DEFAULT 1 CHECK (episode_lock IN (0, 1)),
					attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 2),
					lease_owner TEXT,
					lease_expires_at TEXT,
					error_code TEXT,
					error_message TEXT,
					retryable INTEGER NOT NULL DEFAULT 0 CHECK (retryable IN (0, 1)),
					created_at TEXT NOT NULL,
					updated_at TEXT NOT NULL,
					started_at TEXT,
					completed_at TEXT,
					UNIQUE (id, run_id),
					CHECK (
						(state IN ('queued', 'running') AND episode_lock = 1)
						OR (state IN ('answered', 'refused') AND episode_lock = 0)
						OR state = 'failed'
					)
				);

				CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_turns_active_slot
					ON chat_turns(active_slot)
					WHERE state = 'running';

				CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_turns_one_unresolved_per_run
					ON chat_turns(run_id)
					WHERE episode_lock = 1;

				CREATE INDEX IF NOT EXISTS idx_chat_turns_run_order
					ON chat_turns(run_id, enqueue_order);

				CREATE INDEX IF NOT EXISTS idx_chat_turns_fifo
					ON chat_turns(state, enqueue_order);

				CREATE INDEX IF NOT EXISTS idx_chat_turns_lease
					ON chat_turns(state, lease_expires_at);

				CREATE TABLE IF NOT EXISTS chat_claims (
					id TEXT PRIMARY KEY,
					turn_id TEXT NOT NULL,
					run_id TEXT NOT NULL,
					text TEXT NOT NULL CHECK (
						length(text) BETWEEN 1 AND 1200
						AND text = trim(text)
						AND instr(text, char(0)) = 0
						AND instr(text, char(65533)) = 0
						AND instr(hex(CAST(text AS BLOB)), 'EFBFBD') = 0
						AND hex(CAST(text AS BLOB)) NOT GLOB '*ED[AB][0-9A-F][89AB][0-9A-F]*'
					),
					support_status TEXT NOT NULL CHECK (support_status = 'supported'),
					sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
					UNIQUE (id, run_id),
					UNIQUE (turn_id, sort_order),
					FOREIGN KEY (turn_id, run_id) REFERENCES chat_turns(id, run_id) ON DELETE CASCADE
				);

				CREATE TABLE IF NOT EXISTS chat_citations (
					claim_id TEXT NOT NULL,
					run_id TEXT NOT NULL,
					snapshot_id TEXT NOT NULL,
					excerpt TEXT NOT NULL CHECK (
						length(excerpt) BETWEEN 5 AND 600
						AND excerpt = trim(excerpt)
						AND instr(excerpt, char(0)) = 0
						AND instr(excerpt, char(65533)) = 0
						AND instr(hex(CAST(excerpt AS BLOB)), 'EFBFBD') = 0
						AND hex(CAST(excerpt AS BLOB)) NOT GLOB '*ED[AB][0-9A-F][89AB][0-9A-F]*'
					),
					sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
					PRIMARY KEY (claim_id, sort_order),
					FOREIGN KEY (claim_id, run_id) REFERENCES chat_claims(id, run_id) ON DELETE CASCADE,
					FOREIGN KEY (run_id, snapshot_id) REFERENCES episode_evidence_snapshots(run_id, id) ON DELETE RESTRICT
				);

				CREATE INDEX IF NOT EXISTS idx_chat_citations_snapshot
					ON chat_citations(run_id, snapshot_id);

				CREATE TABLE IF NOT EXISTS chat_attempts (
					id TEXT PRIMARY KEY,
					turn_id TEXT NOT NULL REFERENCES chat_turns(id) ON DELETE CASCADE,
					attempt_number INTEGER NOT NULL CHECK (attempt_number BETWEEN 1 AND 2),
					worker_id TEXT NOT NULL,
					started_at TEXT NOT NULL,
					finished_at TEXT,
					outcome TEXT NOT NULL CHECK (outcome IN ('running', 'answered', 'refused', 'failed', 'interrupted', 'recovered')),
					error_code TEXT,
					error_message TEXT,
					UNIQUE (turn_id, attempt_number)
				);

				CREATE TABLE IF NOT EXISTS chat_retry_requests (
					turn_id TEXT NOT NULL REFERENCES chat_turns(id) ON DELETE CASCADE,
					idempotency_key TEXT NOT NULL CHECK (
						length(idempotency_key) BETWEEN 8 AND 200
						AND idempotency_key = trim(idempotency_key)
						AND instr(idempotency_key, char(0)) = 0
						AND instr(idempotency_key, char(65533)) = 0
						AND instr(hex(CAST(idempotency_key AS BLOB)), 'EFBFBD') = 0
						AND hex(CAST(idempotency_key AS BLOB)) NOT GLOB '*ED[AB][0-9A-F][89AB][0-9A-F]*'
					),
					requested_attempt_number INTEGER NOT NULL CHECK (requested_attempt_number = 2),
					created_at TEXT NOT NULL,
					PRIMARY KEY (turn_id, idempotency_key),
					UNIQUE (turn_id)
				);

				CREATE TABLE IF NOT EXISTS chat_provider_calls (
					id TEXT PRIMARY KEY,
					turn_id TEXT NOT NULL,
					attempt_number INTEGER NOT NULL CHECK (attempt_number BETWEEN 1 AND 2),
					stage TEXT NOT NULL CHECK (stage IN ('draft', 'support')),
					model TEXT NOT NULL CHECK (model = 'gpt-5.4-mini-2026-03-17'),
					worker_id TEXT NOT NULL CHECK (length(worker_id) BETWEEN 1 AND 240),
					status TEXT NOT NULL CHECK (status IN ('reserved', 'response_received', 'ambiguous', 'finalized')),
					safe_outcome TEXT CHECK (safe_outcome IS NULL OR safe_outcome IN (
						'response_received', 'draft_refusal', 'draft_answer_validated',
						'support_validated', 'support_rejected', 'invalid_response',
						'invalid_citations', 'provider_rejected', 'response_too_large',
						'empty_response', 'timeout', 'network_failure', 'cancelled'
					)),
					input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens BETWEEN 0 AND 1000000),
					cached_input_tokens INTEGER CHECK (
						cached_input_tokens IS NULL
						OR (cached_input_tokens BETWEEN 0 AND 1000000 AND input_tokens IS NOT NULL AND cached_input_tokens <= input_tokens)
					),
					output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens BETWEEN 0 AND 1000000),
					reasoning_output_tokens INTEGER CHECK (
						reasoning_output_tokens IS NULL
						OR (reasoning_output_tokens BETWEEN 0 AND 1000000 AND output_tokens IS NOT NULL AND reasoning_output_tokens <= output_tokens)
					),
					provider_request_id TEXT CHECK (provider_request_id IS NULL OR length(provider_request_id) BETWEEN 1 AND 240),
					reserved_at TEXT NOT NULL,
					response_received_at TEXT,
					completed_at TEXT,
					updated_at TEXT NOT NULL,
					CHECK (
						(status IS 'reserved' AND safe_outcome IS NULL AND response_received_at IS NULL AND completed_at IS NULL
							AND input_tokens IS NULL AND cached_input_tokens IS NULL AND output_tokens IS NULL
							AND reasoning_output_tokens IS NULL AND provider_request_id IS NULL)
						OR (status IS 'response_received' AND safe_outcome IS 'response_received' AND response_received_at IS NOT NULL AND completed_at IS NULL)
						OR (status IS 'ambiguous' AND (
							safe_outcome IS 'timeout' OR safe_outcome IS 'network_failure' OR safe_outcome IS 'cancelled'
						)
							AND response_received_at IS NULL AND completed_at IS NOT NULL
							AND input_tokens IS NULL AND cached_input_tokens IS NULL AND output_tokens IS NULL
							AND reasoning_output_tokens IS NULL AND provider_request_id IS NULL)
						OR (status IS 'finalized' AND safe_outcome IS NOT NULL AND safe_outcome IN (
							'draft_refusal', 'draft_answer_validated', 'support_validated',
							'support_rejected', 'invalid_response', 'invalid_citations',
							'provider_rejected', 'response_too_large', 'empty_response'
							) AND response_received_at IS NOT NULL AND completed_at IS NOT NULL)
						),
						CHECK (
							safe_outcome IS NULL
							OR safe_outcome IN ('response_received', 'timeout', 'network_failure', 'cancelled')
							OR (stage = 'draft' AND safe_outcome IN (
								'draft_refusal', 'draft_answer_validated', 'invalid_response',
								'invalid_citations', 'provider_rejected', 'response_too_large', 'empty_response'
							))
							OR (stage = 'support' AND safe_outcome IN (
								'support_validated', 'support_rejected', 'invalid_response',
								'provider_rejected', 'response_too_large', 'empty_response'
							))
						),
					UNIQUE (turn_id, attempt_number, stage),
					FOREIGN KEY (turn_id, attempt_number) REFERENCES chat_attempts(turn_id, attempt_number) ON DELETE CASCADE
				);

				CREATE TRIGGER IF NOT EXISTS briefing_runs_reject_chat_replacement
				BEFORE INSERT ON briefing_runs
				WHEN EXISTS (
					SELECT 1 FROM chat_turns WHERE run_id = NEW.id
				)
				BEGIN
					SELECT RAISE(ABORT, 'briefing replacement is not permitted while chat history remains');
				END;

				CREATE TRIGGER IF NOT EXISTS briefing_runs_preserve_chat_identity
				BEFORE UPDATE OF id ON briefing_runs
				WHEN NEW.id IS NOT OLD.id
					AND EXISTS (
						SELECT 1 FROM chat_turns WHERE run_id IN (OLD.id, NEW.id)
					)
				BEGIN
					SELECT RAISE(ABORT, 'briefing identity is immutable while chat history remains');
				END;

				CREATE TRIGGER IF NOT EXISTS chat_turns_reject_replacement
				BEFORE INSERT ON chat_turns
				WHEN EXISTS (
					SELECT 1 FROM chat_turns
					WHERE id = NEW.id
						OR idempotency_key = NEW.idempotency_key
						OR enqueue_order = NEW.enqueue_order
						OR (NEW.state = 'running' AND state = 'running')
						OR (NEW.episode_lock = 1 AND run_id = NEW.run_id AND episode_lock = 1)
				)
				BEGIN
					SELECT RAISE(ABORT, 'chat turn replacement is not permitted');
				END;

				CREATE TRIGGER IF NOT EXISTS chat_turns_reject_partial_index_replacement
				BEFORE UPDATE OF state, episode_lock, run_id ON chat_turns
				WHEN EXISTS (
					SELECT 1 FROM chat_turns
					WHERE id <> OLD.id
						AND (
							(NEW.state = 'running' AND state = 'running')
							OR (NEW.episode_lock = 1 AND run_id = NEW.run_id AND episode_lock = 1)
						)
				)
				BEGIN
					SELECT RAISE(ABORT, 'chat turn partial-index replacement is not permitted');
				END;

				CREATE TRIGGER IF NOT EXISTS chat_claims_reject_replacement
				BEFORE INSERT ON chat_claims
				WHEN EXISTS (
					SELECT 1 FROM chat_claims
					WHERE id = NEW.id OR (turn_id = NEW.turn_id AND sort_order = NEW.sort_order)
				)
				BEGIN
					SELECT RAISE(ABORT, 'chat claim replacement is not permitted');
				END;

				CREATE TRIGGER IF NOT EXISTS chat_citations_reject_replacement
				BEFORE INSERT ON chat_citations
				WHEN EXISTS (
					SELECT 1 FROM chat_citations
					WHERE claim_id = NEW.claim_id AND sort_order = NEW.sort_order
				)
				BEGIN
					SELECT RAISE(ABORT, 'chat citation replacement is not permitted');
				END;

				CREATE TRIGGER IF NOT EXISTS chat_attempts_reject_replacement
				BEFORE INSERT ON chat_attempts
				WHEN EXISTS (
					SELECT 1 FROM chat_attempts
					WHERE id = NEW.id OR (turn_id = NEW.turn_id AND attempt_number = NEW.attempt_number)
				)
				BEGIN
					SELECT RAISE(ABORT, 'chat attempt replacement is not permitted');
				END;

				CREATE TRIGGER IF NOT EXISTS chat_retry_requests_reject_replacement
				BEFORE INSERT ON chat_retry_requests
				WHEN EXISTS (
					SELECT 1 FROM chat_retry_requests WHERE turn_id = NEW.turn_id
				)
				BEGIN
					SELECT RAISE(ABORT, 'chat retry replacement is not permitted');
				END;

				CREATE TRIGGER IF NOT EXISTS chat_provider_calls_reject_replacement
				BEFORE INSERT ON chat_provider_calls
				WHEN EXISTS (
					SELECT 1 FROM chat_provider_calls
					WHERE id = NEW.id
						OR (
							turn_id = NEW.turn_id
							AND attempt_number = NEW.attempt_number
							AND stage = NEW.stage
						)
				)
				BEGIN
					SELECT RAISE(ABORT, 'provider lifecycle replacement is not permitted');
				END;

				CREATE TRIGGER IF NOT EXISTS chat_turns_reject_inserted_publication
				BEFORE INSERT ON chat_turns
				WHEN NEW.state IN ('answered', 'refused')
				BEGIN
					SELECT RAISE(ABORT, 'chat publication requires a running persisted attempt');
				END;

				CREATE TRIGGER IF NOT EXISTS chat_turns_identity_immutable
				BEFORE UPDATE OF id, run_id, idempotency_key, enqueue_order, question, active_slot, created_at ON chat_turns
				WHEN NEW.id IS NOT OLD.id
					OR NEW.run_id IS NOT OLD.run_id
					OR NEW.idempotency_key IS NOT OLD.idempotency_key
					OR NEW.enqueue_order IS NOT OLD.enqueue_order
					OR NEW.question IS NOT OLD.question
					OR NEW.active_slot IS NOT OLD.active_slot
					OR NEW.created_at IS NOT OLD.created_at
				BEGIN
					SELECT RAISE(ABORT, 'chat turn identity is immutable');
				END;

				CREATE TRIGGER IF NOT EXISTS chat_turns_safe_episode_release
				BEFORE UPDATE ON chat_turns
				WHEN NEW.episode_lock = 0
					AND NOT (
						(
							NEW.state = 'failed'
							AND NEW.answer_kind IS NULL
							AND NEW.refusal_code IS NULL
							AND NEW.lease_owner IS NULL
							AND NEW.lease_expires_at IS NULL
							AND NEW.error_code IS NOT NULL
							AND NEW.error_message IS NOT NULL
							AND NEW.completed_at IS NOT NULL
							AND NEW.updated_at = NEW.completed_at
							AND NOT EXISTS (
								SELECT 1 FROM chat_provider_calls
								WHERE turn_id = NEW.id
							)
						)
						OR (
							OLD.state = 'running'
							AND OLD.episode_lock = 1
							AND OLD.attempt_count BETWEEN 1 AND 2
							AND NEW.attempt_count = OLD.attempt_count
							AND OLD.lease_owner IS NOT NULL
							AND OLD.lease_expires_at IS NOT NULL
							AND OLD.started_at IS NOT NULL
							AND NEW.started_at IS OLD.started_at
							AND NEW.completed_at IS NOT NULL
							AND NEW.updated_at = NEW.completed_at
							AND NEW.completed_at >= OLD.updated_at
							AND OLD.lease_expires_at > NEW.completed_at
							AND NEW.lease_owner IS NULL
							AND NEW.lease_expires_at IS NULL
							AND NEW.retryable = 0
							AND NEW.error_code IS NULL
							AND NEW.error_message IS NULL
							AND EXISTS (
								SELECT 1 FROM chat_attempts
								WHERE turn_id = NEW.id
									AND attempt_number = NEW.attempt_count
									AND worker_id = OLD.lease_owner
									AND outcome = 'running'
									AND finished_at IS NULL
									AND error_code IS NULL
									AND error_message IS NULL
							)
							AND (
								SELECT COUNT(*) FROM chat_attempts WHERE turn_id = NEW.id
							) = NEW.attempt_count
							AND NOT EXISTS (
								SELECT 1 FROM chat_provider_calls
								WHERE turn_id = NEW.id
									AND attempt_number < NEW.attempt_count
									AND status <> 'finalized'
							)
							AND (
								NEW.attempt_count = 1
								OR (
									NEW.attempt_count = 2
									AND EXISTS (
										SELECT 1 FROM chat_retry_requests
										WHERE turn_id = NEW.id AND requested_attempt_number = 2
									)
									AND EXISTS (
										SELECT 1 FROM chat_attempts
										WHERE turn_id = NEW.id
											AND attempt_number = 1
											AND outcome IN ('failed', 'interrupted', 'recovered')
											AND finished_at IS NOT NULL
											AND error_code IS NOT NULL
											AND error_message IS NOT NULL
									)
								)
							)
							AND (
								(
									NEW.state = 'answered'
									AND NEW.answer_kind IS 'answer'
									AND NEW.refusal_code IS NULL
									AND (
										SELECT COUNT(*) FROM chat_provider_calls
										WHERE turn_id = NEW.id AND attempt_number = NEW.attempt_count
									) = 2
									AND EXISTS (
										SELECT 1 FROM chat_provider_calls
										WHERE turn_id = NEW.id AND attempt_number = NEW.attempt_count
											AND stage = 'draft' AND worker_id = OLD.lease_owner
											AND status = 'finalized' AND safe_outcome = 'draft_answer_validated'
									)
									AND EXISTS (
										SELECT 1 FROM chat_provider_calls
										WHERE turn_id = NEW.id AND attempt_number = NEW.attempt_count
											AND stage = 'support' AND worker_id = OLD.lease_owner
											AND status = 'finalized' AND safe_outcome = 'support_validated'
									)
									AND EXISTS (
										SELECT 1 FROM chat_claims
										WHERE turn_id = NEW.id AND run_id = NEW.run_id
									)
									AND NOT EXISTS (
										SELECT 1 FROM chat_claims
										WHERE turn_id = NEW.id
											AND NOT EXISTS (
												SELECT 1 FROM chat_citations
												WHERE claim_id = chat_claims.id AND run_id = NEW.run_id
											)
									)
								)
								OR (
									NEW.state = 'refused'
									AND NEW.answer_kind IS 'refusal'
									AND NEW.refusal_code IS 'EVIDENCE_INSUFFICIENT'
									AND (
										SELECT COUNT(*) FROM chat_provider_calls
										WHERE turn_id = NEW.id AND attempt_number = NEW.attempt_count
									) = 1
									AND EXISTS (
										SELECT 1 FROM chat_provider_calls
										WHERE turn_id = NEW.id AND attempt_number = NEW.attempt_count
											AND stage = 'draft' AND worker_id = OLD.lease_owner
											AND status = 'finalized' AND safe_outcome = 'draft_refusal'
									)
									AND NOT EXISTS (
										SELECT 1 FROM chat_claims WHERE turn_id = NEW.id
									)
								)
							)
						)
					)
				BEGIN
					SELECT RAISE(ABORT, 'chat turn cannot release the episode lock without a complete publication or zero-provider failure');
				END;

				CREATE TRIGGER IF NOT EXISTS chat_turns_preserve_provider_history
				BEFORE DELETE ON chat_turns
				WHEN EXISTS (SELECT 1 FROM chat_provider_calls WHERE turn_id = OLD.id)
					AND EXISTS (SELECT 1 FROM briefing_runs WHERE id = OLD.run_id)
				BEGIN
					SELECT RAISE(ABORT, 'provider lifecycle history requires whole-episode deletion');
				END;

				CREATE TRIGGER IF NOT EXISTS chat_claims_reject_published_insert
				BEFORE INSERT ON chat_claims
				WHEN EXISTS (
					SELECT 1 FROM chat_turns
					WHERE id = NEW.turn_id AND state IN ('answered', 'refused')
				)
				BEGIN
					SELECT RAISE(ABORT, 'published chat claims are immutable');
				END;

				CREATE TRIGGER IF NOT EXISTS chat_claims_identity_immutable
				BEFORE UPDATE OF id, turn_id, run_id, sort_order ON chat_claims
				WHEN NEW.id IS NOT OLD.id
					OR NEW.turn_id IS NOT OLD.turn_id
					OR NEW.run_id IS NOT OLD.run_id
					OR NEW.sort_order IS NOT OLD.sort_order
				BEGIN
					SELECT RAISE(ABORT, 'chat claim identity is immutable');
				END;

				CREATE TRIGGER IF NOT EXISTS chat_claims_reject_published_update
				BEFORE UPDATE ON chat_claims
				WHEN EXISTS (
					SELECT 1 FROM chat_turns
					WHERE id IN (OLD.turn_id, NEW.turn_id) AND state IN ('answered', 'refused')
				)
				BEGIN
					SELECT RAISE(ABORT, 'published chat claims are immutable');
				END;

				CREATE TRIGGER IF NOT EXISTS chat_claims_reject_published_delete
				BEFORE DELETE ON chat_claims
				WHEN EXISTS (
					SELECT 1 FROM chat_turns
					WHERE id = OLD.turn_id AND state IN ('answered', 'refused')
				)
				BEGIN
					SELECT RAISE(ABORT, 'published chat claims are immutable');
				END;

				CREATE TRIGGER IF NOT EXISTS chat_citations_reject_published_insert
				BEFORE INSERT ON chat_citations
				WHEN EXISTS (
					SELECT 1 FROM chat_claims
					JOIN chat_turns ON chat_turns.id = chat_claims.turn_id
					WHERE chat_claims.id = NEW.claim_id AND chat_turns.state IN ('answered', 'refused')
				)
				BEGIN
					SELECT RAISE(ABORT, 'published chat citations are immutable');
				END;

				CREATE TRIGGER IF NOT EXISTS chat_citations_identity_immutable
				BEFORE UPDATE OF claim_id, run_id, snapshot_id, sort_order ON chat_citations
				WHEN NEW.claim_id IS NOT OLD.claim_id
					OR NEW.run_id IS NOT OLD.run_id
					OR NEW.snapshot_id IS NOT OLD.snapshot_id
					OR NEW.sort_order IS NOT OLD.sort_order
				BEGIN
					SELECT RAISE(ABORT, 'chat citation identity is immutable');
				END;

				CREATE TRIGGER IF NOT EXISTS chat_citations_reject_published_update
				BEFORE UPDATE ON chat_citations
				WHEN EXISTS (
					SELECT 1 FROM chat_claims
					JOIN chat_turns ON chat_turns.id = chat_claims.turn_id
					WHERE chat_claims.id IN (OLD.claim_id, NEW.claim_id)
						AND chat_turns.state IN ('answered', 'refused')
				)
				BEGIN
					SELECT RAISE(ABORT, 'published chat citations are immutable');
				END;

				CREATE TRIGGER IF NOT EXISTS chat_citations_reject_published_delete
				BEFORE DELETE ON chat_citations
				WHEN EXISTS (
					SELECT 1 FROM chat_claims
					JOIN chat_turns ON chat_turns.id = chat_claims.turn_id
					WHERE chat_claims.id = OLD.claim_id AND chat_turns.state IN ('answered', 'refused')
				)
				BEGIN
					SELECT RAISE(ABORT, 'published chat citations are immutable');
				END;

				CREATE TRIGGER IF NOT EXISTS chat_attempts_identity_immutable
				BEFORE UPDATE OF id, turn_id, attempt_number, worker_id, started_at ON chat_attempts
				WHEN NEW.id IS NOT OLD.id
					OR NEW.turn_id IS NOT OLD.turn_id
					OR NEW.attempt_number IS NOT OLD.attempt_number
					OR NEW.worker_id IS NOT OLD.worker_id
					OR NEW.started_at IS NOT OLD.started_at
				BEGIN
					SELECT RAISE(ABORT, 'chat attempt identity is immutable');
				END;

				CREATE TRIGGER IF NOT EXISTS chat_attempts_monotonic_outcome
				BEFORE UPDATE ON chat_attempts
				WHEN NOT (
					OLD.outcome = 'running'
					AND OLD.finished_at IS NULL
					AND NEW.outcome IN ('answered', 'refused', 'failed', 'interrupted', 'recovered')
					AND NEW.finished_at IS NOT NULL
					AND NEW.finished_at >= OLD.started_at
					AND (
						NEW.outcome NOT IN ('answered', 'refused')
						OR (
							NEW.error_code IS NULL
							AND NEW.error_message IS NULL
							AND EXISTS (
								SELECT 1 FROM chat_turns
								WHERE id = NEW.turn_id
									AND attempt_count = NEW.attempt_number
									AND state = NEW.outcome
									AND episode_lock = 0
							)
						)
					)
				)
				BEGIN
					SELECT RAISE(ABORT, 'chat attempt outcome is immutable after finalization');
				END;

				CREATE TRIGGER IF NOT EXISTS chat_attempts_preserve_provider_history
				BEFORE DELETE ON chat_attempts
				WHEN EXISTS (
					SELECT 1 FROM chat_provider_calls
					WHERE turn_id = OLD.turn_id AND attempt_number = OLD.attempt_number
				)
					AND EXISTS (SELECT 1 FROM chat_turns WHERE id = OLD.turn_id)
				BEGIN
					SELECT RAISE(ABORT, 'provider lifecycle history requires whole-turn deletion');
				END;

				CREATE TRIGGER IF NOT EXISTS chat_retry_requests_identity_immutable
				BEFORE UPDATE OF turn_id, idempotency_key, requested_attempt_number, created_at ON chat_retry_requests
				WHEN NEW.turn_id IS NOT OLD.turn_id
					OR NEW.idempotency_key IS NOT OLD.idempotency_key
					OR NEW.requested_attempt_number IS NOT OLD.requested_attempt_number
					OR NEW.created_at IS NOT OLD.created_at
				BEGIN
					SELECT RAISE(ABORT, 'chat retry identity is immutable');
				END;

				CREATE TRIGGER IF NOT EXISTS chat_provider_calls_begin_reserved
				BEFORE INSERT ON chat_provider_calls
				WHEN NEW.status <> 'reserved'
					OR NEW.safe_outcome IS NOT NULL
					OR NEW.reserved_at IS NOT NEW.updated_at
				BEGIN
					SELECT RAISE(ABORT, 'provider lifecycle must begin with a reservation');
				END;

				CREATE TRIGGER IF NOT EXISTS chat_provider_calls_require_episode_lock
				BEFORE INSERT ON chat_provider_calls
				WHEN NOT EXISTS (
					SELECT 1
					FROM chat_turns
					JOIN chat_attempts
						ON chat_attempts.turn_id = chat_turns.id
						AND chat_attempts.attempt_number = NEW.attempt_number
					WHERE chat_turns.id = NEW.turn_id
						AND chat_turns.state = 'running'
						AND chat_turns.episode_lock = 1
						AND chat_turns.attempt_count = NEW.attempt_number
						AND chat_turns.lease_owner = NEW.worker_id
						AND chat_turns.lease_expires_at > NEW.reserved_at
						AND chat_attempts.worker_id = NEW.worker_id
						AND chat_attempts.outcome = 'running'
						AND chat_attempts.finished_at IS NULL
				)
					OR NOT (
						(
							NEW.stage = 'draft'
							AND NOT EXISTS (
								SELECT 1 FROM chat_provider_calls
								WHERE turn_id = NEW.turn_id AND attempt_number = NEW.attempt_number
							)
						)
						OR (
							NEW.stage = 'support'
							AND (
								SELECT COUNT(*) FROM chat_provider_calls
								WHERE turn_id = NEW.turn_id AND attempt_number = NEW.attempt_number
							) = 1
							AND EXISTS (
								SELECT 1 FROM chat_provider_calls
								WHERE turn_id = NEW.turn_id AND attempt_number = NEW.attempt_number
									AND stage = 'draft' AND worker_id = NEW.worker_id
									AND status = 'finalized' AND safe_outcome = 'draft_answer_validated'
							)
						)
					)
					OR (
						SELECT COUNT(*) FROM chat_provider_calls WHERE turn_id = NEW.turn_id
					) >= 4
				BEGIN
					SELECT RAISE(ABORT, 'provider lifecycle requires the episode lock and current lease');
				END;

				CREATE TRIGGER IF NOT EXISTS chat_provider_calls_identity_immutable
				BEFORE UPDATE OF id, turn_id, attempt_number, stage, model, worker_id, reserved_at ON chat_provider_calls
				WHEN NEW.id IS NOT OLD.id
					OR NEW.turn_id IS NOT OLD.turn_id
					OR NEW.attempt_number IS NOT OLD.attempt_number
					OR NEW.stage IS NOT OLD.stage
					OR NEW.model IS NOT OLD.model
					OR NEW.worker_id IS NOT OLD.worker_id
					OR NEW.reserved_at IS NOT OLD.reserved_at
				BEGIN
					SELECT RAISE(ABORT, 'provider lifecycle identity is immutable');
				END;

				CREATE TRIGGER IF NOT EXISTS chat_provider_call_updates_require_episode_lock
				BEFORE UPDATE ON chat_provider_calls
				WHEN NOT EXISTS (
					SELECT 1
					FROM chat_turns
					JOIN chat_attempts
						ON chat_attempts.turn_id = chat_turns.id
						AND chat_attempts.attempt_number = NEW.attempt_number
					WHERE chat_turns.id = NEW.turn_id
						AND chat_turns.state = 'running'
						AND chat_turns.episode_lock = 1
						AND chat_turns.attempt_count = NEW.attempt_number
						AND chat_turns.lease_owner = NEW.worker_id
						AND chat_turns.lease_expires_at > NEW.updated_at
						AND chat_attempts.worker_id = NEW.worker_id
						AND chat_attempts.outcome = 'running'
						AND chat_attempts.finished_at IS NULL
				)
				BEGIN
					SELECT RAISE(ABORT, 'provider lifecycle requires the episode lock and current lease');
				END;

				CREATE TRIGGER IF NOT EXISTS chat_provider_calls_monotonic_transition
				BEFORE UPDATE ON chat_provider_calls
				WHEN NOT (
					(
						OLD.status IS 'reserved'
						AND NEW.status IS 'response_received'
						AND NEW.safe_outcome IS 'response_received'
						AND NEW.response_received_at IS NOT NULL
						AND NEW.response_received_at = NEW.updated_at
						AND NEW.completed_at IS NULL
						AND NEW.updated_at >= OLD.updated_at
					)
					OR (
						OLD.status IS 'reserved'
						AND NEW.status IS 'ambiguous'
						AND (
							NEW.safe_outcome IS 'timeout'
							OR NEW.safe_outcome IS 'network_failure'
							OR NEW.safe_outcome IS 'cancelled'
						)
						AND NEW.response_received_at IS NULL
						AND NEW.completed_at IS NOT NULL
						AND NEW.completed_at = NEW.updated_at
						AND NEW.updated_at >= OLD.updated_at
					)
					OR (
						OLD.status IS 'response_received'
						AND NEW.status IS 'finalized'
						AND NEW.safe_outcome IS NOT NULL
						AND NEW.safe_outcome NOT IN ('response_received', 'timeout', 'network_failure', 'cancelled')
						AND NEW.input_tokens IS OLD.input_tokens
						AND NEW.cached_input_tokens IS OLD.cached_input_tokens
						AND NEW.output_tokens IS OLD.output_tokens
						AND NEW.reasoning_output_tokens IS OLD.reasoning_output_tokens
						AND NEW.provider_request_id IS OLD.provider_request_id
						AND NEW.response_received_at IS OLD.response_received_at
						AND NEW.completed_at IS NOT NULL
						AND NEW.completed_at = NEW.updated_at
						AND NEW.updated_at >= OLD.updated_at
					)
				)
				BEGIN
					SELECT RAISE(ABORT, 'provider lifecycle transition is not monotonic');
				END;

				CREATE TRIGGER IF NOT EXISTS chat_provider_calls_preserve_evidence
				BEFORE DELETE ON chat_provider_calls
				WHEN EXISTS (SELECT 1 FROM chat_turns WHERE id = OLD.turn_id)
				BEGIN
					SELECT RAISE(ABORT, 'provider lifecycle evidence cannot be deleted while its turn remains');
				END;
			`);
		},
	},
	{
		id: '009_compact_brief_length',
		up: db => {
			if (!hasColumn(db, 'stations', 'brief_length_preset')) {
				db.exec("ALTER TABLE stations ADD COLUMN brief_length_preset TEXT NOT NULL DEFAULT 'standard' CHECK (brief_length_preset IN ('compact', 'standard'))");
			}
			if (!hasColumn(db, 'generation_requests', 'brief_length_preset')) {
				db.exec("ALTER TABLE generation_requests ADD COLUMN brief_length_preset TEXT NOT NULL DEFAULT 'standard' CHECK (brief_length_preset IN ('compact', 'standard'))");
			}
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
