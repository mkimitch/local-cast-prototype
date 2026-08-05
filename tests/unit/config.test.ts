import {describe, expect, it} from 'vitest';
import {parseServerConfig, providerSummaryForConfig} from '../../server/config';

const productionEnvironment = {
	NODE_ENV: 'production',
	LOCALCAST_RUNTIME_MODE: 'production',
	LOCALCAST_PROCESS_ROLE: 'app',
	DATABASE_PATH: '/var/lib/localcast/data/localcast.sqlite',
	MEDIA_PATH: '/var/lib/localcast/media',
	LOCALCAST_INSTALLATION_ID: 'localcast-test-installation',
	LOCALCAST_TRUSTED_ORIGINS: 'https://localcast.example.test',
} satisfies NodeJS.ProcessEnv;

describe('server environment contract', () => {
	it.each([
		['unset runtime mode', {}, /LOCALCAST_RUNTIME_MODE/],
		['unknown runtime mode', {LOCALCAST_RUNTIME_MODE: 'staging'}, /LOCALCAST_RUNTIME_MODE/],
		['unknown provider', {LOCALCAST_RUNTIME_MODE: 'development', TEXT_PROVIDER: 'mock'}, /TEXT_PROVIDER/],
		['memory database outside tests', {LOCALCAST_RUNTIME_MODE: 'development', DATABASE_PATH: ':memory:'}, /in-memory SQLite/],
		['automatic startup sync', {LOCALCAST_RUNTIME_MODE: 'development', RSS_SYNC_ON_START: 'true'}, /automatic RSS/],
		['automatic interval sync', {LOCALCAST_RUNTIME_MODE: 'development', RSS_SYNC_INTERVAL_MINUTES: '15'}, /automatic RSS/],
		['wildcard origin', {LOCALCAST_RUNTIME_MODE: 'development', LOCALCAST_TRUSTED_ORIGINS: '*'}, /wildcard/],
		['non-http origin', {LOCALCAST_RUNTIME_MODE: 'development', LOCALCAST_TRUSTED_ORIGINS: 'file:///tmp/index.html'}, /http or https/],
	])('rejects %s', (_name, environment, error) => {
		expect(() => parseServerConfig(environment)).toThrow(error);
	});

	it('defaults development to explicit not-configured providers', () => {
		const config = parseServerConfig({LOCALCAST_RUNTIME_MODE: 'development'});
		const status = providerSummaryForConfig(config);

		expect(config.textProvider).toBe('not_configured');
		expect(config.speechProvider).toBe('not_configured');
		expect(status.generationEnabled).toBe(false);
		expect(status.text.status).toBe('NOT CONFIGURED');
		expect(status.speech.status).toBe('NOT CONFIGURED');
	});

	it.each([
		[{...productionEnvironment, DATABASE_PATH: undefined}, /DATABASE_PATH/],
		[{...productionEnvironment, MEDIA_PATH: undefined}, /MEDIA_PATH/],
		[{...productionEnvironment, LOCALCAST_INSTALLATION_ID: 'short'}, /INSTALLATION_ID/],
		[{...productionEnvironment, LOCALCAST_INSTALLATION_ID: 'replace-with-a-unique-installation-id'}, /INSTALLATION_ID/],
		[{...productionEnvironment, MEDIA_PATH: '/var/lib/localcast/data'}, /must be distinct/],
		[{...productionEnvironment, MEDIA_PATH: '/var/lib/localcast/data/../data'}, /must be distinct/],
		[{...productionEnvironment, MEDIA_PATH: '/var/lib/localcast/data/media'}, /must be distinct/],
		[{...productionEnvironment, TEXT_PROVIDER: 'fake', LOCALCAST_ALLOW_FAKE_PROVIDERS: 'true'}, /only in test mode/],
		[{...productionEnvironment, LOCALCAST_FAKE_FAILURE_PHASE: 'drafting'}, /failure injection/],
		[{...productionEnvironment, LOCALCAST_FAKE_PHASE_DELAY_MS: '100'}, /phase delay/],
		[{...productionEnvironment, LOCALCAST_FAKE_DELAY_PHASE: 'drafting'}, /delay phase/],
		[{...productionEnvironment, LOCALCAST_FAKE_AFTER_PUBLICATION_DELAY_MS: '100'}, /publication delay/],
		[{...productionEnvironment, LOCALCAST_RUNTIME_MODE: 'test', TEXT_PROVIDER: 'fake', SPEECH_PROVIDER: 'fake', LOCALCAST_ALLOW_FAKE_PROVIDERS: 'true'}, /production builds require production runtime mode/],
		[{...productionEnvironment, NODE_ENV: 'test'}, /requires NODE_ENV=production/],
	])('fails closed for an invalid production matrix entry', (environment, error) => {
		expect(() => parseServerConfig(environment)).toThrow(error);
	});

	it('accepts an explicit production configuration without enabling generation', () => {
		const config = parseServerConfig(productionEnvironment);
		const status = providerSummaryForConfig(config);

		expect(config.runtimeMode).toBe('production');
		expect(config.databasePath).toBe(productionEnvironment.DATABASE_PATH);
		expect(config.trustedOrigins).toEqual(['https://localcast.example.test']);
		expect(status.generationEnabled).toBe(false);
	});

	it('allows deterministic fakes only with both explicit test gates', () => {
		expect(() => parseServerConfig({
			LOCALCAST_RUNTIME_MODE: 'test',
			TEXT_PROVIDER: 'fake',
			SPEECH_PROVIDER: 'fake',
		})).toThrow(/explicit opt-in/);

		const config = parseServerConfig({
			NODE_ENV: 'test',
			LOCALCAST_RUNTIME_MODE: 'test',
			DATABASE_PATH: ':memory:',
			TEXT_PROVIDER: 'fake',
			SPEECH_PROVIDER: 'fake',
			LOCALCAST_ALLOW_FAKE_PROVIDERS: 'true',
		});
		const status = providerSummaryForConfig(config);

		expect(status.generationEnabled).toBe(true);
		expect(status.text.status).toBe('CONTRACT TESTED ONLY');
		expect(status.speech.status).toBe('CONTRACT TESTED ONLY');
	});
});
