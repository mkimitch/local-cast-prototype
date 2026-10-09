import {describe, expect, it, vi} from 'vitest';
import {createHealthDiagnostics} from '../../server/routes/healthDiagnostics';

describe('bounded health diagnostics', () => {
	it.each(['SQLITE_IOERR_ACCESS', 'SQLITE_IOERR_SEEK', 'SQLITE_IOERR_MMAP', 'SQLITE_READONLY_CANTLOCK', 'SQLITE_BUSY_SNAPSHOT'])('retains recognized extended code %s without its private error details', code => {
		const write = vi.fn();
		createHealthDiagnostics(write).failure('database_audit', Object.assign(new Error('private database detail'), {code}));
		expect(JSON.parse(write.mock.calls[0]![0])).toEqual({event: 'health_not_ready', stage: 'database_audit', classification: 'sqlite', code, suppressed: 0});
	});

	it('logs at most one failure per minute even when stages change, then one recovery', () => {
		let time = 0;
		const write = vi.fn();
		const diagnostics = createHealthDiagnostics(write, () => time);
		const error = Object.assign(new Error('private-path secret-canary SELECT private_data'), {code: 'SQLITE_BUSY'});
		diagnostics.failure('database_audit', error);
		for (time = 2_000; time < 60_000; time += 2_000) diagnostics.failure('media_access', error);
		expect(write).toHaveBeenCalledTimes(1);
		diagnostics.failure('database_audit', error);
		expect(write).toHaveBeenCalledTimes(2);
		expect(JSON.parse(write.mock.calls[1]![0])).toEqual({
			event: 'health_not_ready', stage: 'database_audit', classification: 'sqlite', code: 'SQLITE_BUSY', suppressed: 29,
		});
		diagnostics.recovery();
		diagnostics.recovery();
		expect(write).toHaveBeenCalledTimes(3);
		expect(JSON.parse(write.mock.calls[2]![0])).toEqual({event: 'health_recovered', previousStage: 'database_audit', suppressed: 0});
		expect(JSON.stringify(write.mock.calls)).not.toMatch(/private|secret-canary|SELECT/);
	});

	it('does not let alternating failure and recovery flood logs', () => {
		let time = 0;
		const write = vi.fn();
		const diagnostics = createHealthDiagnostics(write, () => time);
		for (; time < 60_000; time += 2_000) {
			diagnostics.failure('media_access', new Error('private'));
			diagnostics.recovery();
		}
		expect(write).toHaveBeenCalledTimes(2);
		diagnostics.failure('provider_summary', new Error('private'));
		expect(write).toHaveBeenCalledTimes(3);
	});

	it.each([
		['This SQLite build does not include required FTS5 support', 'fts5_unavailable'],
		['SQLite quick_check failed', 'quick_check_failed'],
		['SQLite foreign_key_check found violations', 'foreign_key_violations'],
		['SQLite migration version does not match this LocalCast build', 'schema_mismatch'],
	])('classifies the known audit assertion: %s', (message, classification) => {
		const write = vi.fn();
		createHealthDiagnostics(write).failure('database_audit', new Error(message));
		expect(JSON.parse(write.mock.calls[0]![0])).toMatchObject({stage: 'database_audit', classification});
		expect(write.mock.calls[0]![0]).not.toContain(message);
	});

	it.each([
		Object.assign(new Error('secret-canary /private/file SELECT content'), {code: 'SQLITE_SECRET_CANARY', name: 'private-name'}),
		{code: 'ESECRET_CANARY', message: 'secret-canary'},
		'secret-canary',
		new Proxy({}, {has: () => { throw new Error('secret-canary'); }}),
	])('never serializes arbitrary exception fields or unrecognized codes', error => {
		const write = vi.fn();
		expect(() => createHealthDiagnostics(write).failure('database_audit', error)).not.toThrow();
		const entry = JSON.parse(write.mock.calls[0]![0]);
		expect(entry).not.toHaveProperty('code');
		expect(Object.keys(entry).sort()).toEqual(['classification', 'event', 'stage', 'suppressed']);
		expect(write.mock.calls[0]![0]).not.toMatch(/secret|private|SELECT|CANARY/);
	});

	it('contains sink and clock failures', () => {
		const diagnostics = createHealthDiagnostics(() => { throw new Error('logger unavailable'); });
		expect(() => diagnostics.failure('database_audit', new Error('private'))).not.toThrow();
		expect(() => diagnostics.recovery()).not.toThrow();
		const brokenClock = createHealthDiagnostics(vi.fn(), () => { throw new Error('clock failed'); });
		expect(() => brokenClock.failure('database_audit', new Error('private'))).not.toThrow();
		expect(() => brokenClock.recovery()).not.toThrow();
	});
});
