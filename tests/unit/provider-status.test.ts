import {afterEach, describe, expect, it} from 'vitest';
import type Database from 'better-sqlite3';
import {ProviderCheckStore} from '../../server/services/providerCheckStore';
import {recordSpeechProviderFailure, recordSpeechProviderSuccess, recordTextProviderFailure} from '../../server/jobs/generationProcessor';
import {GenerationError} from '../../server/jobs/types';
import {createTestDatabase, testConfig} from '../helpers/database';

const databases: Database.Database[] = [];
afterEach(() => {
	while (databases.length > 0) databases.pop()?.close();
});

describe('provider verification status', () => {
	it('preserves applicable live verification and contract evidence across repeated reconciliation', () => {
		const database = createTestDatabase();
		databases.push(database);
		let now = '2026-08-05T12:34:56.000Z';
		const checks = new ProviderCheckStore(database, () => now);
		const config = testConfig({
			processRole: 'worker',
			textProvider: 'openai',
			speechProvider: 'openai',
			openAiApiKey: 'credential-canary',
			allowFakeProviders: false,
		});

		expect(checks.summary(config)).toMatchObject({
			generationEnabled: false,
			text: {status: 'CONFIGURED UNVERIFIED'},
			speech: {status: 'CONFIGURED UNVERIFIED'},
		});
		checks.recordContract(config);
		const appConfig = {...config, processRole: 'app' as const, openAiApiKey: undefined};
		expect(checks.summary(appConfig, {allowAppOpenAiStatusProjection: true})).toMatchObject({
			generationEnabled: true,
			text: {status: 'CONTRACT TESTED ONLY'},
			speech: {status: 'CONTRACT TESTED ONLY'},
		});
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
		const liveRows = database.prepare('SELECT * FROM provider_checks ORDER BY capability').all();
		now = '2026-08-05T13:00:00.000Z';
		checks.recordContract(config);
		checks.recordContract(config);
		expect(checks.summary(config)).toMatchObject({
			generationEnabled: true,
			text: {status: 'LIVE VERIFIED', verifiedAt: '2026-08-05T12:34:56.000Z'},
			speech: {status: 'LIVE VERIFIED', verifiedAt: '2026-08-05T12:34:56.000Z'},
		});
		expect(database.prepare('SELECT * FROM provider_checks ORDER BY capability').all()).toEqual(liveRows);
	});

	it('keeps applicable contract-only evidence and its reason idempotent', () => {
		const database = createTestDatabase();
		databases.push(database);
		let now = '2026-08-05T12:34:56.000Z';
		const checks = new ProviderCheckStore(database, () => now);
		const config = testConfig({
			processRole: 'worker',
			textProvider: 'openai',
			speechProvider: 'openai',
			openAiApiKey: 'credential-canary',
			allowFakeProviders: false,
		});
		checks.recordContract(config);
		const contractRows = database.prepare('SELECT * FROM provider_checks ORDER BY capability').all();
		now = '2026-08-05T13:00:00.000Z';
		checks.recordContract(config);
		expect(database.prepare('SELECT * FROM provider_checks ORDER BY capability').all()).toEqual(contractRows);

		checks.recordFailure('text', config, 'Connection test failed: OPENAI_PROVIDER_UNAVAILABLE');
		const failureRow = database.prepare("SELECT * FROM provider_checks WHERE capability = 'text'").get();
		now = '2026-08-05T13:30:00.000Z';
		checks.recordContract(config, ['text']);
		expect(database.prepare("SELECT * FROM provider_checks WHERE capability = 'text'").get()).toEqual(failureRow);
		expect(checks.summary(config).text).toMatchObject({
			status: 'CONTRACT TESTED ONLY',
			reason: 'Connection test failed: OPENAI_PROVIDER_UNAVAILABLE',
			verifiedAt: undefined,
		});
	});

	it('invalidates stale live evidence for credential, model, voice, and availability changes', () => {
		const database = createTestDatabase();
		databases.push(database);
		const checks = new ProviderCheckStore(database, () => '2026-08-05T12:34:56.000Z');
		const config = testConfig({
			processRole: 'worker',
			textProvider: 'openai',
			speechProvider: 'openai',
			openAiApiKey: 'credential-canary',
			allowFakeProviders: false,
		});
		checks.recordLive('text', config);
		checks.recordLive('speech', config);

		const replacedCredential = {...config, openAiApiKey: 'replacement-credential-canary'};
		expect(checks.summary(replacedCredential)).toMatchObject({
			text: {status: 'CONFIGURED UNVERIFIED'},
			speech: {status: 'CONFIGURED UNVERIFIED'},
		});
		checks.recordContract(replacedCredential);
		expect(checks.summary(replacedCredential)).toMatchObject({
			text: {status: 'CONTRACT TESTED ONLY', verifiedAt: undefined},
			speech: {status: 'CONTRACT TESTED ONLY', verifiedAt: undefined},
		});
		checks.recordLive('text', replacedCredential);
		checks.recordLive('speech', replacedCredential);

		const changedConfiguration = {
			...replacedCredential,
			openAiTextModel: 'gpt-5.4-mini-replacement',
			openAiSpeechVoice: 'cedar',
		};
		expect(checks.summary(changedConfiguration)).toMatchObject({
			text: {status: 'CONFIGURED UNVERIFIED', model: 'gpt-5.4-mini-replacement'},
			speech: {status: 'CONFIGURED UNVERIFIED', voice: 'cedar'},
		});
		checks.recordContract(changedConfiguration);
		expect(checks.summary(changedConfiguration)).toMatchObject({
			text: {status: 'CONTRACT TESTED ONLY', verifiedAt: undefined},
			speech: {status: 'CONTRACT TESTED ONLY', verifiedAt: undefined},
		});

		const missingCredential = {...changedConfiguration, openAiApiKey: undefined};
		checks.recordNotConfigured(missingCredential);
		expect(checks.summary(missingCredential)).toMatchObject({
			generationEnabled: false,
			text: {status: 'NOT CONFIGURED'},
			speech: {status: 'NOT CONFIGURED'},
		});
		const persisted = JSON.stringify(database.prepare('SELECT * FROM provider_checks').all());
		expect(persisted).not.toMatch(/api.?key|authorization|credential-canary/i);
	});

	it('keeps local and mixed-provider evidence capability-scoped', () => {
		const database = createTestDatabase();
		databases.push(database);
		const checks = new ProviderCheckStore(database, () => '2026-08-05T12:34:56.000Z');
		const localConfig = testConfig({
			textProvider: 'ollama',
			speechProvider: 'piper',
			ollamaBaseUrl: 'http://127.0.0.1:11434/v1',
			ollamaTextModel: 'local-text',
			piperExecutable: '/opt/piper/piper',
			piperModelPath: '/opt/piper/voices/local.onnx',
			openAiApiKey: undefined,
			allowFakeProviders: false,
		});
		checks.recordContract(localConfig);
		checks.recordLive('text', localConfig);
		checks.recordLive('speech', localConfig);
		checks.recordContract(localConfig);
		expect(checks.summary(localConfig)).toMatchObject({
			text: {adapter: 'Ollama', status: 'LIVE VERIFIED'},
			speech: {adapter: 'Piper', status: 'LIVE VERIFIED'},
		});

		const mixedConfig = {
			...localConfig,
			textProvider: 'lm_studio' as const,
			lmStudioBaseUrl: 'http://127.0.0.1:1234/v1',
			lmStudioTextModel: 'replacement-local-text',
		};
		checks.recordContract(mixedConfig, ['text']);
		expect(checks.summary(mixedConfig)).toMatchObject({
			text: {adapter: 'LM Studio', status: 'CONTRACT TESTED ONLY'},
			speech: {adapter: 'Piper', status: 'LIVE VERIFIED'},
		});

		const changedPiper = {...mixedConfig, piperModelPath: '/opt/piper/voices/replacement.onnx'};
		checks.recordContract(changedPiper, ['speech']);
		expect(checks.summary(changedPiper)).toMatchObject({
			text: {adapter: 'LM Studio', status: 'CONTRACT TESTED ONLY'},
			speech: {adapter: 'Piper', status: 'CONTRACT TESTED ONLY'},
		});
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

	it('preserves applicable verification for local persistence and media failures', () => {
		const database = createTestDatabase();
		databases.push(database);
		const checks = new ProviderCheckStore(database, () => '2026-10-08T12:00:00.000Z');
		const config = testConfig({
			textProvider: 'openai',
			speechProvider: 'openai',
			openAiApiKey: 'credential-canary',
			allowFakeProviders: false,
		});
		checks.recordLive('text', config);
		checks.recordLive('speech', config);
		const liveRows = database.prepare('SELECT * FROM provider_checks ORDER BY capability').all();

		recordTextProviderFailure(new GenerationError('EPISODE_PERSISTENCE_FAILED', 'The episode could not be persisted', true), config, checks);
		recordSpeechProviderFailure(new GenerationError('AUDIO_WRITE_FAILED', 'The generated speech could not be written safely', true), config, checks);

		expect(database.prepare('SELECT * FROM provider_checks ORDER BY capability').all()).toEqual(liveRows);
	});

	it('still records capability failures for both provider types', () => {
		const database = createTestDatabase();
		databases.push(database);
		const checks = new ProviderCheckStore(database, () => '2026-10-08T12:00:00.000Z');
		const config = testConfig({
			textProvider: 'openai',
			speechProvider: 'openai',
			openAiApiKey: 'credential-canary',
			allowFakeProviders: false,
		});
		checks.recordLive('text', config);
		checks.recordLive('speech', config);

		recordTextProviderFailure(new GenerationError('OPENAI_AUTHENTICATION_FAILED', 'The credential was rejected', false, 'failure'), config, checks);
		recordSpeechProviderFailure(new GenerationError('OPENAI_TTS_NETWORK_FAILURE', 'The speech provider could not be reached', true, 'failure'), config, checks);

		expect(checks.summary(config)).toMatchObject({
			text: {status: 'CONTRACT TESTED ONLY', reason: 'Live request failed: OPENAI_AUTHENTICATION_FAILED'},
			speech: {status: 'CONTRACT TESTED ONLY', reason: 'Live request failed: OPENAI_TTS_NETWORK_FAILURE'},
		});
	});
});
