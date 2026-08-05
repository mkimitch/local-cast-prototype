import Database from 'better-sqlite3';
import type {ServerConfig} from '../config';
import {verifyStorage} from '../storage';
import {applyMigrations, migrationIds} from './migrations';

export interface DatabaseHealth {
	sqliteVersion: string;
	fts5: boolean;
	quickCheck: 'ok';
	foreignKeyViolations: number;
	schemaVersion: string;
}

export interface OpenDatabaseOptions {
	initializingStorage?: boolean;
}

const verifyInstallationIdentity = (
	database: Database.Database,
	config: ServerConfig,
	initializingStorage: boolean,
): void => {
	if (config.runtimeMode !== 'production' || !config.installationId) return;

	const row = database.prepare("SELECT value FROM localcast_metadata WHERE key = 'installation_id'").get() as {value: string} | undefined;
	if (initializingStorage) {
		if (row && row.value !== config.installationId) {
			throw new Error('Database belongs to a different LocalCast installation');
		}

		database.prepare(`
			INSERT INTO localcast_metadata (key, value, updated_at)
			VALUES ('installation_id', ?, ?)
			ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
		`).run(config.installationId, new Date().toISOString());
		return;
	}

	if (!row || row.value !== config.installationId) {
		throw new Error('Database installation identity does not match the mounted LocalCast storage');
	}
};

const verifyExistingInstallationIdentity = (database: Database.Database, config: ServerConfig): void => {
	if (config.runtimeMode !== 'production' || !config.installationId) return;

	const metadataTable = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'localcast_metadata'").get();
	if (!metadataTable) {
		throw new Error('Database is not initialized for this LocalCast installation; run the explicit storage initialization command');
	}

	const row = database.prepare("SELECT value FROM localcast_metadata WHERE key = 'installation_id'").get() as {value: string} | undefined;
	if (!row || row.value !== config.installationId) {
		throw new Error('Database installation identity does not match the mounted LocalCast storage');
	}
};

export const inspectDatabaseHealth = (database: Database.Database): DatabaseHealth => {
	const sqliteVersion = (database.prepare('SELECT sqlite_version() AS version').get() as {version: string}).version;
	const fts5 = (database.prepare("SELECT sqlite_compileoption_used('ENABLE_FTS5') AS enabled").get() as {enabled: number}).enabled === 1;
	const quickCheckRows = database.pragma('quick_check') as Array<{quick_check: string}>;
	const foreignKeyRows = database.pragma('foreign_key_check') as unknown[];
	const migrations = database.prepare('SELECT id FROM schema_migrations ORDER BY rowid').all() as Array<{id: string}>;
	const quickCheck = quickCheckRows.length === 1 && quickCheckRows[0]?.quick_check === 'ok' ? 'ok' : undefined;

	if (!fts5) throw new Error('This SQLite build does not include required FTS5 support');
	if (quickCheck !== 'ok') throw new Error('SQLite quick_check failed');
	if (foreignKeyRows.length > 0) throw new Error('SQLite foreign_key_check found violations');
	if (migrations.length !== migrationIds.length || migrations.some((row, index) => row.id !== migrationIds[index])) {
		throw new Error('SQLite migration version does not match this LocalCast build');
	}

	return {
		sqliteVersion,
		fts5,
		quickCheck,
		foreignKeyViolations: foreignKeyRows.length,
		schemaVersion: migrationIds.at(-1) || 'none',
	};
};

export const openDatabase = (config: ServerConfig, options: OpenDatabaseOptions = {}): Database.Database => {
	verifyStorage(config, {allowMissingDatabase: options.initializingStorage === true});

	const database = new Database(config.databasePath);
	try {
		database.pragma('foreign_keys = ON');
		database.pragma('busy_timeout = 5000');
		if (options.initializingStorage !== true) verifyExistingInstallationIdentity(database, config);
		if (config.databasePath !== ':memory:') database.pragma('journal_mode = WAL');
		applyMigrations(database);
		verifyInstallationIdentity(database, config, options.initializingStorage === true);
		inspectDatabaseHealth(database);
		return database;
	} catch (error) {
		database.close();
		throw error;
	}
};
