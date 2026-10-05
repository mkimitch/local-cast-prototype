import {describe, expect, it, vi} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {OpenAiCredentialStore} from '../../server/credentials/openAiCredentialStore';
import {createChatProcessor} from '../../server/jobs/chatProcessor';
import {createGenerationProcessor} from '../../server/jobs/generationProcessor';
import {GenerationError} from '../../server/jobs/types';
import {OpenAiCredentialService} from '../../server/services/openAiCredentialService';
import {ProviderCheckStore} from '../../server/services/providerCheckStore';
import type {ChatStore} from '../../server/services/chatStore';
import type {GenerationJobStore} from '../../server/jobs/generationJobStore';
import type {ClaimedChatTurn} from '../../server/chat/types';
import type {GenerationJob} from '../../server/jobs/types';
import {createTestDatabase, testConfig} from '../helpers/database';

const errorCode = async (action: () => Promise<unknown>): Promise<string | undefined> => {
	try {
		await action();
		return undefined;
	} catch (error) {
		return error instanceof GenerationError ? error.code : undefined;
	}
};

describe('runtime OpenAI credential resolution', () => {
	it('preserves applicable live verification when app startup reads provider status', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localcast-app-status-startup-'));
		const database = createTestDatabase();
		try {
			const checks = new ProviderCheckStore(database, () => '2026-10-05T12:00:00.000Z');
			const credentials = new OpenAiCredentialStore(path.join(root, '.credentials'));
			const apiKey = 'sk-app-startup-status-credential-1234';
			credentials.replace(apiKey);
			const config = testConfig({
				processRole: 'app',
				textProvider: 'openai',
				speechProvider: 'openai',
				openAiApiKey: undefined,
				allowFakeProviders: false,
			});
			const effective = {...config, openAiApiKey: apiKey};
			checks.recordLive('text', effective);
			checks.recordLive('speech', effective);
			const persisted = database.prepare('SELECT * FROM provider_checks ORDER BY capability').all();
			const verify = vi.fn();

			const service = new OpenAiCredentialService(credentials, checks, verify);
			expect(service.providerSummary(config)).toMatchObject({
				text: {status: 'LIVE VERIFIED'},
				speech: {status: 'LIVE VERIFIED'},
			});
			expect(database.prepare('SELECT * FROM provider_checks ORDER BY capability').all()).toEqual(persisted);
			expect(verify).not.toHaveBeenCalled();
		} finally {
			database.close();
			fs.rmSync(root, {recursive: true, force: true});
		}
	});

	it('preserves applicable live verification across repeated worker startup reconciliation', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localcast-worker-status-startup-'));
		const database = createTestDatabase();
		const fetchSpy = vi.spyOn(globalThis, 'fetch');
		try {
			const checks = new ProviderCheckStore(database, () => '2026-10-05T12:00:00.000Z');
			const credentials = new OpenAiCredentialStore(path.join(root, '.credentials'));
			const apiKey = 'sk-worker-startup-status-credential-1234';
			credentials.replace(apiKey);
			const config = testConfig({
				processRole: 'worker',
				textProvider: 'openai',
				speechProvider: 'openai',
				openAiApiKey: undefined,
				allowFakeProviders: false,
			});
			const effective = {...config, openAiApiKey: apiKey};
			checks.recordLive('text', effective);
			checks.recordLive('speech', effective);
			const persisted = database.prepare('SELECT * FROM provider_checks ORDER BY capability').all();

			createGenerationProcessor(config, {} as GenerationJobStore, credentials, checks);
			createGenerationProcessor(config, {} as GenerationJobStore, credentials, checks);

			expect(checks.summary(effective)).toMatchObject({
				text: {status: 'LIVE VERIFIED'},
				speech: {status: 'LIVE VERIFIED'},
			});
			expect(database.prepare('SELECT * FROM provider_checks ORDER BY capability').all()).toEqual(persisted);
			expect(fetchSpy).not.toHaveBeenCalled();
		} finally {
			fetchSpy.mockRestore();
			database.close();
			fs.rmSync(root, {recursive: true, force: true});
		}
	});

	it.each([
		['missing', () => undefined],
		['unsafe', () => { throw new Error('synthetic unsafe credential store'); }],
	] as const)('invalidates live verification when the worker credential is %s at startup', (_state, resolve) => {
		const database = createTestDatabase();
		try {
			const checks = new ProviderCheckStore(database, () => '2026-10-05T12:00:00.000Z');
			const config = testConfig({
				processRole: 'worker',
				textProvider: 'openai',
				speechProvider: 'openai',
				openAiApiKey: undefined,
				allowFakeProviders: false,
			});
			const previouslyEffective = {...config, openAiApiKey: 'sk-previous-worker-status-credential-1234'};
			checks.recordLive('text', previouslyEffective);
			checks.recordLive('speech', previouslyEffective);

			createGenerationProcessor(config, {} as GenerationJobStore, {resolve}, checks);

			expect(checks.summary(config)).toMatchObject({
				generationEnabled: false,
				text: {status: 'NOT CONFIGURED'},
				speech: {status: 'NOT CONFIGURED'},
			});
			expect(database.prepare('SELECT * FROM provider_checks').all()).toEqual([]);
		} finally {
			database.close();
		}
	});

	it('lets generation use a newly stored key without recreating the processor', async () => {
		const values = [undefined, undefined, 'sk-runtime-generation-credential-1234'];
		const credentials = {resolve: vi.fn(() => values.shift())};
		const config = testConfig({textProvider: 'openai', speechProvider: 'openai', openAiApiKey: undefined, allowFakeProviders: false});
		const processor = createGenerationProcessor(config, {} as GenerationJobStore, credentials);
		const job = {payload: {version: 2, requestId: 'missing-request'}, runId: 'missing-run'} as GenerationJob;

		expect(await errorCode(() => processor.process(job, 'worker', new AbortController().signal))).toBe('PROVIDER_NOT_CONFIGURED');
		expect(await errorCode(() => processor.process(job, 'worker', new AbortController().signal))).toBe('INVALID_JOB_PAYLOAD');
		expect(credentials.resolve).toHaveBeenCalledTimes(3);
	});

	it('keeps a mixed local capability enabled across missing-key startup and UI replacement', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localcast-mixed-runtime-'));
		const database = createTestDatabase();
		try {
			const checks = new ProviderCheckStore(database);
			const credentials = new OpenAiCredentialStore(path.join(root, '.credentials'));
			const config = testConfig({
				processRole: 'app',
				textProvider: 'ollama',
				speechProvider: 'openai',
				ollamaBaseUrl: 'http://127.0.0.1:11434/v1',
				ollamaTextModel: 'local-text',
				openAiApiKey: undefined,
				allowFakeProviders: false,
			});

			createGenerationProcessor(config, {} as GenerationJobStore, credentials, checks);
			expect(checks.summary(config)).toMatchObject({
				generationEnabled: false,
				text: {adapter: 'Ollama', status: 'CONTRACT TESTED ONLY'},
				speech: {status: 'NOT CONFIGURED'},
			});

			const service = new OpenAiCredentialService(credentials, checks, vi.fn());
			service.replace(config, 'sk-runtime-mixed-credential-1234');
			expect(service.providerSummary(config)).toMatchObject({
				generationEnabled: true,
				text: {adapter: 'Ollama', status: 'CONTRACT TESTED ONLY'},
				speech: {adapter: 'OpenAI', status: 'CONTRACT TESTED ONLY'},
			});
		} finally {
			database.close();
			fs.rmSync(root, {recursive: true, force: true});
		}
	});

	it('lets chat use a newly stored key without recreating the processor', async () => {
		const values = [undefined, 'sk-runtime-chat-credential-1234'];
		const credentials = {resolve: vi.fn(() => values.shift())};
		const sentinel = new GenerationError('SYNTHETIC_CONTEXT_REACHED', 'Synthetic context reached', false);
		const chats = {loadGroundingContext: vi.fn(() => { throw sentinel; })} as unknown as ChatStore;
		const config = testConfig({textProvider: 'openai', speechProvider: 'openai', openAiApiKey: undefined, allowFakeProviders: false});
		const processor = createChatProcessor(config, chats, credentials);
		const turn = {id: 'turn', runId: 'run', attemptCount: 1} as ClaimedChatTurn;

		expect(await errorCode(() => processor.process(turn, 'worker', new AbortController().signal))).toBe('PROVIDER_NOT_CONFIGURED');
		expect(await errorCode(() => processor.process(turn, 'worker', new AbortController().signal))).toBe('SYNTHETIC_CONTEXT_REACHED');
		expect(credentials.resolve).toHaveBeenCalledTimes(2);
	});

	it('does not read an irrelevant OpenAI credential for an all-local provider pair', async () => {
		const credentials = {resolve: vi.fn(() => { throw new Error('damaged unused credential'); })};
		const config = testConfig({
			textProvider: 'ollama',
			speechProvider: 'piper',
			ollamaBaseUrl: 'http://127.0.0.1:11434/v1',
			ollamaTextModel: 'local-text',
			piperExecutable: '/missing/piper',
			piperModelPath: '/missing/voice.onnx',
			openAiApiKey: undefined,
			allowFakeProviders: false,
		});
		const processor = createGenerationProcessor(config, {} as GenerationJobStore, credentials);
		const job = {payload: {version: 2, requestId: 'missing-request'}, runId: 'missing-run'} as GenerationJob;

		expect(await errorCode(() => processor.process(job, 'worker', new AbortController().signal))).toBe('PROVIDER_NOT_CONFIGURED');
		expect(credentials.resolve).not.toHaveBeenCalled();
	});
});
