export interface MigrationDatabase {
	exec(sql: string): unknown;
	prepare(sql: string): {
		all(...params: unknown[]): unknown[];
		get(...params: unknown[]): unknown;
		run(...params: unknown[]): {changes: number};
	};
	transaction(fn: () => void): () => void;
}

interface Migration {
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
];

export const applyMigrations = (db: MigrationDatabase): void => {
	db.exec(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			id TEXT PRIMARY KEY,
			applied_at TEXT NOT NULL
		);
	`);

	const appliedRows = db.prepare('SELECT id FROM schema_migrations').all() as Array<{id: string}>;
	const appliedIds = new Set(appliedRows.map(row => row.id));
	const insertMigration = db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)');

	const runPending = db.transaction(() => {
		for (const migration of migrations) {
			if (appliedIds.has(migration.id)) continue;

			migration.up(db);
			insertMigration.run(migration.id, new Date().toISOString());
		}
	});

	runPending();
};
