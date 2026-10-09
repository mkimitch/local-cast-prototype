import {getSystemErrorMap} from 'node:util';

export type HealthStage = 'database_audit' | 'media_access' | 'provider_summary' | 'response';

const systemCodes = new Set([...getSystemErrorMap().values()].map(([code]) => code));
// Exact SQLite result names, including extended errors exposed by better-sqlite3.
const sqliteCodes = new Set([
	'SQLITE_ERROR', 'SQLITE_INTERNAL', 'SQLITE_PERM', 'SQLITE_ABORT', 'SQLITE_BUSY',
	'SQLITE_LOCKED', 'SQLITE_NOMEM', 'SQLITE_READONLY', 'SQLITE_INTERRUPT', 'SQLITE_IOERR',
	'SQLITE_CORRUPT', 'SQLITE_NOTFOUND', 'SQLITE_FULL', 'SQLITE_CANTOPEN', 'SQLITE_PROTOCOL',
	'SQLITE_EMPTY', 'SQLITE_SCHEMA', 'SQLITE_TOOBIG', 'SQLITE_CONSTRAINT', 'SQLITE_MISMATCH',
	'SQLITE_MISUSE', 'SQLITE_NOLFS', 'SQLITE_AUTH', 'SQLITE_FORMAT', 'SQLITE_RANGE', 'SQLITE_NOTADB',
	'SQLITE_BUSY_RECOVERY', 'SQLITE_BUSY_SNAPSHOT', 'SQLITE_BUSY_TIMEOUT',
	'SQLITE_LOCKED_SHAREDCACHE', 'SQLITE_LOCKED_VTAB', 'SQLITE_IOERR_READ',
	'SQLITE_IOERR_SHORT_READ', 'SQLITE_IOERR_FSTAT', 'SQLITE_IOERR_LOCK',
	'SQLITE_IOERR_SHMOPEN', 'SQLITE_IOERR_SHMSIZE', 'SQLITE_IOERR_SHMLOCK', 'SQLITE_IOERR_SHMMAP',
	'SQLITE_CORRUPT_VTAB', 'SQLITE_CORRUPT_SEQUENCE', 'SQLITE_CORRUPT_INDEX',
	'SQLITE_ERROR_MISSING_COLLSEQ', 'SQLITE_ERROR_RETRY', 'SQLITE_ERROR_SNAPSHOT',
	'SQLITE_ERROR_RESERVESIZE', 'SQLITE_ERROR_KEY', 'SQLITE_ERROR_UNABLE',
	'SQLITE_IOERR_WRITE', 'SQLITE_IOERR_FSYNC', 'SQLITE_IOERR_DIR_FSYNC', 'SQLITE_IOERR_TRUNCATE',
	'SQLITE_IOERR_UNLOCK', 'SQLITE_IOERR_RDLOCK', 'SQLITE_IOERR_DELETE', 'SQLITE_IOERR_BLOCKED',
	'SQLITE_IOERR_NOMEM', 'SQLITE_IOERR_ACCESS', 'SQLITE_IOERR_CHECKRESERVEDLOCK',
	'SQLITE_IOERR_CLOSE', 'SQLITE_IOERR_DIR_CLOSE', 'SQLITE_IOERR_SEEK', 'SQLITE_IOERR_DELETE_NOENT',
	'SQLITE_IOERR_MMAP', 'SQLITE_IOERR_GETTEMPPATH', 'SQLITE_IOERR_CONVPATH', 'SQLITE_IOERR_VNODE',
	'SQLITE_IOERR_AUTH', 'SQLITE_IOERR_BEGIN_ATOMIC', 'SQLITE_IOERR_COMMIT_ATOMIC',
	'SQLITE_IOERR_ROLLBACK_ATOMIC', 'SQLITE_IOERR_DATA', 'SQLITE_IOERR_CORRUPTFS', 'SQLITE_IOERR_IN_PAGE',
	'SQLITE_IOERR_BADKEY', 'SQLITE_IOERR_CODEC',
	'SQLITE_CANTOPEN_NOTEMPDIR', 'SQLITE_CANTOPEN_ISDIR', 'SQLITE_CANTOPEN_FULLPATH',
	'SQLITE_CANTOPEN_CONVPATH', 'SQLITE_CANTOPEN_DIRTYWAL', 'SQLITE_CANTOPEN_SYMLINK',
	'SQLITE_READONLY_RECOVERY', 'SQLITE_READONLY_CANTLOCK', 'SQLITE_READONLY_ROLLBACK',
	'SQLITE_READONLY_DBMOVED', 'SQLITE_READONLY_CANTINIT', 'SQLITE_READONLY_DIRECTORY',
	'SQLITE_ABORT_ROLLBACK', 'SQLITE_CONSTRAINT_CHECK', 'SQLITE_CONSTRAINT_COMMITHOOK',
	'SQLITE_CONSTRAINT_FOREIGNKEY', 'SQLITE_CONSTRAINT_FUNCTION', 'SQLITE_CONSTRAINT_NOTNULL',
	'SQLITE_CONSTRAINT_PRIMARYKEY', 'SQLITE_CONSTRAINT_TRIGGER', 'SQLITE_CONSTRAINT_UNIQUE',
	'SQLITE_CONSTRAINT_VTAB', 'SQLITE_CONSTRAINT_ROWID', 'SQLITE_CONSTRAINT_PINNED', 'SQLITE_CONSTRAINT_DATATYPE',
	'SQLITE_NOTICE', 'SQLITE_WARNING', 'SQLITE_NOTICE_RECOVER_WAL', 'SQLITE_NOTICE_RECOVER_ROLLBACK',
	'SQLITE_NOTICE_RBU', 'SQLITE_WARNING_AUTOINDEX', 'SQLITE_AUTH_USER',
]);

// Only these exact application assertions may contribute a diagnostic classification.
// Never log an exception's message, name, stack, path, SQL, or arbitrary code.
const auditAssertions = new Map([
	['This SQLite build does not include required FTS5 support', 'fts5_unavailable'],
	['SQLite quick_check failed', 'quick_check_failed'],
	['SQLite foreign_key_check found violations', 'foreign_key_violations'],
	['SQLite migration version does not match this LocalCast build', 'schema_mismatch'],
]);

const classify = (stage: HealthStage, error: unknown): {classification: string; code?: string} => {
	try {
		if (typeof error === 'object' && error !== null) {
			const code: unknown = 'code' in error ? error.code : undefined;
			if (typeof code === 'string' && sqliteCodes.has(code)) return {classification: 'sqlite', code};
			if (typeof code === 'string' && systemCodes.has(code)) return {classification: 'system', code};
		}
		if (error instanceof Error) {
			const assertion = stage === 'database_audit' ? auditAssertions.get(error.message) : undefined;
			if (assertion) return {classification: assertion};
			if (error instanceof TypeError) return {classification: 'type_error'};
			if (error instanceof RangeError) return {classification: 'range_error'};
			return {classification: 'error'};
		}
	} catch {
		// Even a throwing exception property must not affect the readiness response.
	}
	return {classification: 'unknown'};
};

export const createHealthDiagnostics = (
	write: (entry: string) => void = entry => console.error(entry),
	now: () => number = () => performance.now(),
) => {
	let lastFailureLog = -Infinity;
	let reportedFailure: HealthStage | undefined;
	let suppressed = 0;
	return {
		failure: (stage: HealthStage, error: unknown): void => {
			try {
				const time = now();
				if (time - lastFailureLog < 60_000) {
					suppressed += 1;
					return;
				}
				lastFailureLog = time;
				reportedFailure = stage;
				write(JSON.stringify({event: 'health_not_ready', stage, ...classify(stage, error), suppressed}));
				suppressed = 0;
			} catch {
				// Diagnostics are best-effort and cannot change health semantics.
			}
		},
		recovery: (): void => {
			try {
				const stage = reportedFailure;
				reportedFailure = undefined;
				if (stage) write(JSON.stringify({event: 'health_recovered', previousStage: stage, suppressed}));
				suppressed = 0;
			} catch {
				// Keep the failure rate-limit across recovery, including rapid flapping.
			}
		},
	};
};
