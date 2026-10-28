import type Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {OpenAiCredentialStore} from '../../server/credentials/openAiCredentialStore';
import {verifyOpenAiModelAccess, OpenAiVerificationError} from '../../server/providers/openAiVerification';
import {OpenAiCredentialService} from '../../server/services/openAiCredentialService';
import {ProviderCheckStore} from '../../server/services/providerCheckStore';
import {createTestDatabase, testConfig} from '../helpers/database';

const roots: string[] = [];
const databases: Database.Database[] = [];

afterEach(() => {
	while (databases.length > 0) databases.pop()!.close();
	while (roots.length > 0) fs.rmSync(roots.pop()!, {recursive: true, force: true});
});

const setup = () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localcast-credential-service-'));
	fs.chmodSync(root, 0o700);
	roots.push(root);
	const database = createTestDatabase();
	databases.push(database);
	const credentials = new OpenAiCredentialStore(path.join(root, '.credentials'));
	const checks = new ProviderCheckStore(database, () => '2026-09-23T12:00:00.000Z');
	const config = testConfig({
		processRole: 'app',
		textProvider: 'openai',
		speechProvider: 'openai',
		openAiApiKey: undefined,
		allowFakeProviders: false,
		credentialDirectory: path.join(root, '.credentials'),
	});
	return {root, database, credentials, checks, config};
};

describe('OpenAI connection verification', () => {
	it('uses the bounded authenticated retrieve-model endpoint without a request body', async () => {
		const apiKey = 'sk-localcast-verification-credential-1234';
		const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
			expect(String(input)).toBe('http://provider.test/v1/models/gpt-5.4-mini');
			expect(init?.method).toBe('GET');
			expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${apiKey}`);
			expect(init?.body).toBeUndefined();
			return new Response(JSON.stringify({id: 'gpt-5.4-mini', object: 'model', owned_by: 'openai'}), {
				status: 200,
				headers: {'content-type': 'application/json'},
			});
		});

		await verifyOpenAiModelAccess(apiKey, 'gpt-5.4-mini', {fetchImpl, baseUrl: 'http://provider.test/v1', allowTestBaseUrl: true});
		expect(fetchImpl).toHaveBeenCalledOnce();
	});

	it.each([
		[401, 'OPENAI_CREDENTIAL_INVALID'],
		[403, 'OPENAI_ACCOUNT_OR_PERMISSION_PROBLEM'],
		[404, 'OPENAI_MODEL_UNAVAILABLE'],
		[429, 'OPENAI_RATE_LIMIT_OR_QUOTA'],
		[503, 'OPENAI_PROVIDER_UNAVAILABLE'],
		[418, 'OPENAI_UNEXPECTED_RESPONSE'],
	] as const)('classifies HTTP %s without exposing provider response data', async (status, code) => {
		const apiKey = 'sk-localcast-classification-credential-1234';
		const fetchImpl = vi.fn<typeof fetch>(async () => new Response(`provider-secret-body-${apiKey}`, {status}));
		const failure = await verifyOpenAiModelAccess(apiKey, 'gpt-5.4-mini', {
			fetchImpl,
			baseUrl: 'http://provider.test/v1',
			allowTestBaseUrl: true,
		}).catch(error => error);

		expect(failure).toBeInstanceOf(OpenAiVerificationError);
		expect(failure).toMatchObject({code});
		expect(JSON.stringify({code: failure.code, message: failure.message})).not.toContain(apiKey);
		expect(failure.message).not.toContain('provider-secret-body');
	});

	it.each([
		['a network failure', vi.fn<typeof fetch>(async () => { throw new Error('synthetic network failure'); }), 'OPENAI_PROVIDER_UNAVAILABLE'],
		['malformed success JSON', vi.fn<typeof fetch>(async () => new Response('{not-json', {status: 200})), 'OPENAI_UNEXPECTED_RESPONSE'],
		['an oversized success response', vi.fn<typeof fetch>(async () => new Response('x'.repeat((64 * 1024) + 1), {status: 200})), 'OPENAI_UNEXPECTED_RESPONSE'],
	] as const)('classifies %s safely', async (_label, fetchImpl, code) => {
		const failure = await verifyOpenAiModelAccess('sk-localcast-response-credential-1234', 'gpt-5.4-mini', {
			fetchImpl,
			baseUrl: 'http://provider.test/v1',
			allowTestBaseUrl: true,
		}).catch(error => error);

		expect(failure).toBeInstanceOf(OpenAiVerificationError);
		expect(failure).toMatchObject({code});
	});

	it('replaces, verifies, and updates the existing provider status without persisting the key', async () => {
		const {database, credentials, checks, config} = setup();
		const apiKey = 'sk-localcast-service-credential-1234';
		const verify = vi.fn(async (receivedKey: string, model: string) => {
			expect(receivedKey).toBe(apiKey);
			expect([config.openAiTextModel, config.openAiSpeechModel]).toContain(model);
		});
		const service = new OpenAiCredentialService(credentials, checks, verify, () => '2026-09-23T12:01:00.000Z');

		const metadata = service.replace(config, apiKey);
		expect(metadata).toMatchObject({configured: true, displayHint: expect.stringMatching(/1234$/)});
		expect(checks.summary(service.effectiveConfig(config))).toMatchObject({
			text: {status: 'CONTRACT TESTED ONLY'},
			speech: {status: 'CONTRACT TESTED ONLY'},
		});
		const result = await service.testConnection(config);
		expect(result).toEqual({verified: true, verifiedAt: '2026-09-23T12:01:00.000Z', capabilities: ['text', 'speech']});
		expect(verify).toHaveBeenCalledTimes(2);
		expect(checks.summary(service.effectiveConfig(config))).toMatchObject({
			text: {status: 'LIVE VERIFIED', verifiedAt: '2026-09-23T12:00:00.000Z'},
			speech: {status: 'LIVE VERIFIED', verifiedAt: '2026-09-23T12:00:00.000Z'},
		});
		expect(JSON.stringify(database.prepare('SELECT * FROM provider_checks').all())).not.toContain(apiKey);
	});

	it('does not silently copy or app-test an environment-only fallback', async () => {
		const {credentials, checks, config, root} = setup();
		const environmentConfig = {...config, openAiApiKey: 'sk-environment-only-credential-1234'};
		const service = new OpenAiCredentialService(credentials, checks, vi.fn());

		await expect(service.testConnection(environmentConfig)).rejects.toMatchObject({
			code: 'OPENAI_CREDENTIAL_NOT_MANAGED',
			httpStatus: 409,
		});
		expect(fs.existsSync(path.join(root, '.credentials'))).toBe(false);
	});

	it('keeps an unrelated live local-provider status when replacing a mixed-pair OpenAI key', () => {
		const {credentials, checks, config} = setup();
		const mixedConfig = {
			...config,
			textProvider: 'ollama' as const,
			ollamaBaseUrl: 'http://127.0.0.1:11434/v1',
			ollamaTextModel: 'local-text',
		};
		checks.recordContract({...mixedConfig, openAiApiKey: 'sk-localcast-old-mixed-credential-1234'});
		checks.recordLive('text', {...mixedConfig, openAiApiKey: 'sk-localcast-old-mixed-credential-1234'});
		const service = new OpenAiCredentialService(credentials, checks, vi.fn());

		service.replace(mixedConfig, 'sk-localcast-new-mixed-credential-5678');

		expect(service.providerSummary(mixedConfig)).toMatchObject({
			text: {adapter: 'Ollama', status: 'LIVE VERIFIED'},
			speech: {adapter: 'OpenAI', status: 'CONTRACT TESTED ONLY'},
		});
	});

	it('does not project stale live evidence after replacement or an unsafe managed store', () => {
		const {root, credentials, checks, config} = setup();
		const oldKey = 'sk-localcast-old-status-credential-1234';
		credentials.replace(oldKey);
		const oldConfig = {...config, openAiApiKey: oldKey};
		checks.recordLive('text', oldConfig);
		checks.recordLive('speech', oldConfig);
		const service = new OpenAiCredentialService(credentials, checks, vi.fn());

		service.replace(config, 'sk-localcast-new-status-credential-5678');
		checks.recordLive('text', oldConfig);
		expect(service.providerSummary(config)).toMatchObject({
			generationEnabled: false,
			text: {status: 'CONFIGURED UNVERIFIED'},
			speech: {status: 'CONTRACT TESTED ONLY'},
		});

		fs.chmodSync(path.join(root, '.credentials', 'openai-api-key'), 0o644);
		expect(service.providerSummary(config)).toMatchObject({
			generationEnabled: false,
			text: {status: 'NOT CONFIGURED'},
			speech: {status: 'NOT CONFIGURED'},
		});
		expect(service.metadata(config)).toEqual({configured: false});
	});

	it('reports a durable replacement as successful when status refresh fails', () => {
		const {credentials, checks, config} = setup();
		vi.spyOn(checks, 'recordContract').mockImplementation(() => { throw new Error('synthetic status failure'); });
		const service = new OpenAiCredentialService(credentials, checks, vi.fn());
		const apiKey = 'sk-localcast-durable-status-failure-1234';

		expect(service.replace(config, apiKey)).toMatchObject({configured: true});
		expect(credentials.resolve()).toBe(apiKey);
		expect(service.providerSummary(config)).toMatchObject({
			text: {status: 'CONFIGURED UNVERIFIED'},
			speech: {status: 'CONFIGURED UNVERIFIED'},
		});
	});
});
