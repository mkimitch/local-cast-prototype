import type Database from 'better-sqlite3';
import {describe, expect, it, vi} from 'vitest';
import {inspectDatabaseHealth, QuickCheckHealthError} from '../../server/database/connection';
import {createHealthDiagnostics} from '../../server/routes/healthDiagnostics';

const databaseWithQuickCheck = (value: unknown, options: {throws?: boolean; inTransaction?: boolean; readonly?: boolean} = {}): Database.Database => ({
	readonly: options.readonly ?? false,
	inTransaction: options.inTransaction ?? false,
	transaction: (callback: () => unknown) => ({deferred: callback}),
	prepare: vi.fn((sql: string) => ({
		get: () => sql.includes('sqlite_version') ? {version: '3.53.2'} : {enabled: 1},
	})),
	pragma: vi.fn((name: string) => {
		if (name !== 'quick_check') throw new Error('unexpected synthetic pragma');
		if (options.throws) throw value;
		return value;
	}),
} as unknown as Database.Database);

const inspectFailure = (database: Database.Database): QuickCheckHealthError => {
	try {
		inspectDatabaseHealth(database);
	} catch (error) {
		if (error instanceof QuickCheckHealthError) return error;
		throw error;
	}
	throw new Error('Expected quick-check inspection to fail');
};

describe('quick-check result diagnostics', () => {
	it.each([
		['non_ok_result', [{quick_check: 'private integrity detail'}], 1, true],
		['empty_result', [], 0, false],
		['multiple_results', [{quick_check: 'private first detail'}, {quick_check: 'private second detail'}], 2, true],
		['unexpected_result_shape', [{unexpected: 'private shape detail'}], 1, false],
	] as const)('classifies %s without retaining raw result content', (category, value, rowCount, expectedColumnShape) => {
		const error = inspectFailure(databaseWithQuickCheck(value, {inTransaction: true}));
		expect(error.message).toBe('SQLite quick_check failed');
		expect(error.diagnostic).toMatchObject({
			category,
			rowCount,
			expectedColumnShape,
			inTransaction: true,
			connectionReadonly: false,
			durationMs: expect.any(Number),
		});
		expect(JSON.stringify(error)).not.toMatch(/private|integrity detail|shape detail/);
	});

	it('retains only a recognized SQLite exception code plus safe connection-local metadata', () => {
		const error = inspectFailure(databaseWithQuickCheck(
			Object.assign(new Error('private path and SQL'), {code: 'SQLITE_BUSY_SNAPSHOT'}),
			{throws: true, readonly: true},
		));
		expect(error).toMatchObject({
			code: 'SQLITE_BUSY_SNAPSHOT',
			diagnostic: {
				category: 'exception',
				expectedColumnShape: false,
				inTransaction: false,
				connectionReadonly: true,
				durationMs: expect.any(Number),
			},
		});
		const write = vi.fn();
		createHealthDiagnostics(write).failure('database_audit', error);
		expect(JSON.parse(write.mock.calls[0]![0])).toEqual({
			event: 'health_not_ready',
			stage: 'database_audit',
			classification: 'sqlite',
			code: 'SQLITE_BUSY_SNAPSHOT',
			category: 'exception',
			expectedColumnShape: false,
			inTransaction: false,
			durationMs: error.diagnostic.durationMs,
			connectionReadonly: true,
			suppressed: 0,
		});
		expect(write.mock.calls[0]![0]).not.toMatch(/private|path and SQL/);
	});

	it('logs bounded structural metadata for a noncanonical result', () => {
		const error = inspectFailure(databaseWithQuickCheck([{quick_check: 'private corruption detail'}]));
		const write = vi.fn();
		createHealthDiagnostics(write).failure('database_audit', error);
		expect(JSON.parse(write.mock.calls[0]![0])).toEqual({
			event: 'health_not_ready',
			stage: 'database_audit',
			classification: 'quick_check_failed',
			category: 'non_ok_result',
			rowCount: 1,
			expectedColumnShape: true,
			inTransaction: false,
			durationMs: error.diagnostic.durationMs,
			connectionReadonly: false,
			suppressed: 0,
		});
		expect(write.mock.calls[0]![0]).not.toMatch(/private|corruption/);
	});
});
