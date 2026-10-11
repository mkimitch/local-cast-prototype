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

export type QuickCheckFailureCategory =
	| 'non_ok_result'
	| 'empty_result'
	| 'multiple_results'
	| 'unexpected_result_shape'
	| 'exception';

export interface QuickCheckFailureDiagnostic {
	category: QuickCheckFailureCategory;
	rowCount?: number;
	expectedColumnShape: boolean;
	inTransaction: boolean;
	durationMs: number;
	connectionReadonly: boolean;
}

export class QuickCheckHealthError extends Error {
	readonly code?: string;

	constructor(
		readonly diagnostic: QuickCheckFailureDiagnostic,
		cause?: unknown,
	) {
		super('SQLite quick_check failed');
		this.name = 'QuickCheckHealthError';
		const causeCode = typeof cause === 'object' && cause !== null && 'code' in cause ? cause.code : undefined;
		if (typeof causeCode === 'string') this.code = causeCode;
	}
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

const quickCheckDuration = (startedAt: bigint): number => (
	Math.min(60_000, Math.max(0, Math.round((Number(process.hrtime.bigint() - startedAt) / 1_000_000) * 1_000) / 1_000))
);

const quickCheckContext = (
	database: Database.Database,
	startedAt: bigint,
	input: Pick<QuickCheckFailureDiagnostic, 'category' | 'rowCount' | 'expectedColumnShape'>,
): QuickCheckFailureDiagnostic => ({
	...input,
	inTransaction: database.inTransaction,
	durationMs: quickCheckDuration(startedAt),
	connectionReadonly: database.readonly,
});

const inspectQuickCheck = (database: Database.Database): 'ok' => {
	const startedAt = process.hrtime.bigint();
	let value: unknown;
	try {
		value = database.pragma('quick_check');
	} catch (error) {
		throw new QuickCheckHealthError(quickCheckContext(database, startedAt, {
			category: 'exception',
			expectedColumnShape: false,
		}), error);
	}

	if (!Array.isArray(value)) {
		throw new QuickCheckHealthError(quickCheckContext(database, startedAt, {
			category: 'unexpected_result_shape',
			expectedColumnShape: false,
		}));
	}
	if (value.length === 0) {
		throw new QuickCheckHealthError(quickCheckContext(database, startedAt, {
			category: 'empty_result',
			rowCount: 0,
			expectedColumnShape: false,
		}));
	}
	const expectedColumnShape = value.every(row => (
		typeof row === 'object'
		&& row !== null
		&& 'quick_check' in row
		&& typeof row.quick_check === 'string'
	));
	if (!expectedColumnShape) {
		throw new QuickCheckHealthError(quickCheckContext(database, startedAt, {
			category: 'unexpected_result_shape',
			rowCount: value.length,
			expectedColumnShape,
		}));
	}
	if (value.length !== 1) {
		throw new QuickCheckHealthError(quickCheckContext(database, startedAt, {
			category: 'multiple_results',
			rowCount: value.length,
			expectedColumnShape,
		}));
	}
	if (value[0].quick_check !== 'ok') {
		throw new QuickCheckHealthError(quickCheckContext(database, startedAt, {
			category: 'non_ok_result',
			rowCount: value.length,
			expectedColumnShape,
		}));
	}
	return 'ok';
};

export const inspectDatabaseHealth = (database: Database.Database): DatabaseHealth => {
	const sqliteVersion = (database.prepare('SELECT sqlite_version() AS version').get() as {version: string}).version;
	const fts5 = (database.prepare("SELECT sqlite_compileoption_used('ENABLE_FTS5') AS enabled").get() as {enabled: number}).enabled === 1;
	const quickCheck = inspectQuickCheck(database);
	const foreignKeyRows = database.pragma('foreign_key_check') as unknown[];
	const migrations = database.prepare('SELECT id FROM schema_migrations ORDER BY rowid').all() as Array<{id: string}>;

	if (!fts5) throw new Error('This SQLite build does not include required FTS5 support');
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
