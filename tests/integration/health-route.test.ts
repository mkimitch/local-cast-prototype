import express from 'express';
import {createServer, type Server} from 'node:http';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {createHealthRouter} from '../../server/routes/health';
import {createHealthDiagnostics} from '../../server/routes/healthDiagnostics';
import {inspectDatabaseHealth, type DatabaseHealth} from '../../server/database/connection';
import {createTestDatabase} from '../helpers/database';

const servers: Server[] = [];
afterEach(async () => {
	for (const server of servers.splice(0)) {
		await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
	}
});

const harness = async () => {
	const db = createTestDatabase();
	let healthyDatabase: DatabaseHealth;
	try { healthyDatabase = inspectDatabaseHealth(db); } finally { db.close(); }
	const order: string[] = [];
	const dependencies = {
		inspectDatabase: vi.fn(() => { order.push('database'); return healthyDatabase; }),
		checkMediaAccess: vi.fn(() => { order.push('media'); }),
		providerSummary: vi.fn(() => {
			order.push('providers');
			return {
				text: {adapter: 'None', status: 'NOT CONFIGURED' as const, reason: 'No provider selected'},
				speech: {adapter: 'None', status: 'NOT CONFIGURED' as const, reason: 'No provider selected'},
				generationEnabled: false,
			};
		}),
	};
	const write = vi.fn();
	const app = express();
	app.use('/api', createHealthRouter(dependencies, createHealthDiagnostics(write, () => 0)));
	const server = createServer(app);
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	servers.push(server);
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('Test listener unavailable');
	return {dependencies, write, order, get: () => fetch(`http://127.0.0.1:${address.port}/api/health`)};
};

const unavailable = {ok: false, service: 'local-cast-api', code: 'NOT_READY'};

describe('health route observability', () => {
	it('retains the successful response and executes all checks in their original order', async () => {
		const value = await harness();
		const response = await value.get();
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			ok: true, service: 'local-cast-api', mediaWritable: true,
			database: {quickCheck: 'ok', fts5: true, foreignKeyViolations: 0, schemaVersion: '009_compact_brief_length'},
		});
		expect(value.order).toEqual(['database', 'media', 'providers']);
		expect(value.write).not.toHaveBeenCalled();
	});

	it.each([
		['inspectDatabase', 'database_audit', 'SQLITE_BUSY_SNAPSHOT', 'sqlite'],
		['checkMediaAccess', 'media_access', 'EACCES', 'system'],
		['providerSummary', 'provider_summary', 'SQLITE_ERROR', 'sqlite'],
	] as const)('reports %s failure privately while retaining the 503 response', async (dependency, stage, code, classification) => {
		const value = await harness();
		value.dependencies[dependency].mockImplementation(() => {
			throw Object.assign(new Error('secret-canary /private/path SELECT settings token=value'), {code, path: '/private/path'});
		});
		const response = await value.get();
		expect(response.status).toBe(503);
		expect(await response.json()).toEqual(unavailable);
		expect(JSON.parse(value.write.mock.calls[0]![0])).toEqual({event: 'health_not_ready', stage, classification, code, suppressed: 0});
		expect(JSON.stringify(value.write.mock.calls)).not.toMatch(/secret|private|SELECT|token/);
		if (dependency === 'inspectDatabase') expect(value.dependencies.checkMediaAccess).not.toHaveBeenCalled();
		if (dependency !== 'providerSummary') expect(value.dependencies.providerSummary).not.toHaveBeenCalled();
	});

	it('suppresses repeated probes, restores 200 on recovery, and logs that transition once', async () => {
		const value = await harness();
		const healthy = value.dependencies.inspectDatabase.getMockImplementation()!;
		value.dependencies.inspectDatabase.mockImplementation(() => { throw new Error('SQLite quick_check failed'); });
		for (let probe = 0; probe < 30; probe += 1) {
			const response = await value.get();
			expect(response.status).toBe(503);
			expect(await response.json()).toEqual(unavailable);
		}
		expect(value.write).toHaveBeenCalledTimes(1);
		value.dependencies.inspectDatabase.mockImplementation(healthy);
		for (let probe = 0; probe < 2; probe += 1) {
			const response = await value.get();
			expect(response.status).toBe(200);
			await response.arrayBuffer();
		}
		expect(value.write).toHaveBeenCalledTimes(2);
		expect(JSON.parse(value.write.mock.calls[1]![0])).toEqual({event: 'health_recovered', previousStage: 'database_audit', suppressed: 29});
	});

	it('keeps both 503 and recovered 200 behavior if the diagnostic sink throws', async () => {
		const value = await harness();
		value.write.mockImplementation(() => { throw new Error('logger-canary'); });
		value.dependencies.checkMediaAccess.mockImplementationOnce(() => { throw new Error('media-canary'); });
		const failed = await value.get();
		expect(failed.status).toBe(503);
		expect(await failed.json()).toEqual(unavailable);
		const recovered = await value.get();
		expect(recovered.status).toBe(200);
		expect(await recovered.json()).toMatchObject({ok: true});
	});
});
