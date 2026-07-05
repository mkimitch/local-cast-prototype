import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import {serverConfig} from './config';

const resolveDatabasePath = (databasePath: string): string => {
	if (databasePath === ':memory:') return databasePath;
	return path.resolve(process.cwd(), databasePath);
};

const databasePath = resolveDatabasePath(serverConfig.databasePath);

if (databasePath !== ':memory:') {
	fs.mkdirSync(path.dirname(databasePath), {recursive: true});
}

export const db = new Database(databasePath);

db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

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

export const closeDatabase = (): void => {
	db.close();
};

