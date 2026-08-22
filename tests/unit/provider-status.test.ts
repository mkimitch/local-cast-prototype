import {afterEach, describe, expect, it} from 'vitest';
import type Database from 'better-sqlite3';
import {ProviderCheckStore} from '../../server/services/providerCheckStore';
import {recordSpeechProviderSuccess} from '../../server/jobs/generationProcessor';
import {createTestDatabase, testConfig} from '../helpers/database';

const databases: Database.Database[] = [];
afterEach(() => {
	while (databases.length > 0) databases.pop()?.close();
});

describe('provider verification status', () => {
	it('uses the exact status vocabulary and requires each worker session to reverify live access', () => {
		const database = createTestDatabase();
		databases.push(database);
		const checks = new ProviderCheckStore(database, () => '2026-08-05T12:34:56.000Z');
		const config = testConfig({
			processRole: 'app',
			textProvider: 'openai',
			speechProvider: 'openai',
			allowFakeProviders: false,
		});

		expect(checks.summary(config)).toMatchObject({
			generationEnabled: false,
			text: {status: 'CONFIGURED UNVERIFIED'},
			speech: {status: 'CONFIGURED UNVERIFIED'},
		});
		checks.recordContract(config);
		expect(checks.summary(config)).toMatchObject({
			generationEnabled: true,
			text: {status: 'CONTRACT TESTED ONLY'},
			speech: {status: 'CONTRACT TESTED ONLY'},
		});
		checks.recordLive('text', config);
		checks.recordLive('speech', config);
		expect(checks.summary(config)).toMatchObject({
			text: {status: 'LIVE VERIFIED', verifiedAt: '2026-08-05T12:34:56.000Z'},
			speech: {status: 'LIVE VERIFIED', verifiedAt: '2026-08-05T12:34:56.000Z'},
		});
		checks.recordContract(config);
		expect(checks.summary(config)).toMatchObject({
			generationEnabled: true,
			text: {status: 'CONTRACT TESTED ONLY'},
			speech: {status: 'CONTRACT TESTED ONLY'},
		});

		const changedVoice = {...config, openAiSpeechVoice: 'cedar'};
		expect(checks.summary(changedVoice)).toMatchObject({
			text: {status: 'CONTRACT TESTED ONLY'},
			speech: {status: 'CONFIGURED UNVERIFIED', voice: 'cedar'},
		});
		const missingCredential = {...config, processRole: 'worker' as const, openAiApiKey: undefined};
		checks.recordNotConfigured(missingCredential);
		expect(checks.summary(missingCredential)).toMatchObject({
			generationEnabled: false,
			text: {status: 'NOT CONFIGURED'},
			speech: {status: 'NOT CONFIGURED'},
		});
		const persisted = JSON.stringify(database.prepare('SELECT * FROM provider_checks').all());
		expect(persisted).not.toMatch(/api.?key|authorization|credential-canary/i);
	});

	it('does not call a recovered speech cache hit live verification', () => {
		const database = createTestDatabase();
		databases.push(database);
		const checks = new ProviderCheckStore(database, () => '2026-08-06T13:00:00.000Z');
		const config = testConfig({
			textProvider: 'openai',
			speechProvider: 'openai',
			openAiApiKey: 'credential-canary',
			allowFakeProviders: false,
		});
		checks.recordContract(config);

		recordSpeechProviderSuccess({liveRequestPerformed: false}, config, checks);
		expect(checks.summary(config).speech).toMatchObject({status: 'CONTRACT TESTED ONLY', verifiedAt: undefined});
		recordSpeechProviderSuccess({liveRequestPerformed: true}, config, checks);
		expect(checks.summary(config).speech).toMatchObject({status: 'LIVE VERIFIED', verifiedAt: '2026-08-06T13:00:00.000Z'});
	});
});
