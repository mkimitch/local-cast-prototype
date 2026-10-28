import {createServer, type Server} from 'node:http';
import express from 'express';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {createSettingsRouter} from '../../server/routes/settings';

const servers: Server[] = [];

afterEach(async () => {
	await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
		server.close(error => error ? reject(error) : resolve());
	})));
});

const start = async (credentialService: {replace: ReturnType<typeof vi.fn>; testConnection: ReturnType<typeof vi.fn>}) => {
	const settings = {
		theme: 'system', contrastMode: 'normal', colorVisionMode: 'default', textSize: 'normal', density: 'normal',
		providers: {
			text: {adapter: 'OpenAI', status: 'CONTRACT TESTED ONLY', reason: 'Contract tested', model: 'gpt-5.4-mini'},
			speech: {adapter: 'OpenAI', status: 'CONTRACT TESTED ONLY', reason: 'Contract tested', model: 'gpt-4o-mini-tts', voice: 'marin'},
		},
		credentials: {openAi: {configured: true, displayHint: '•••1234'}},
		generationEnabled: true,
	} as const;
	const store = {getSettings: vi.fn(() => settings), saveSettings: vi.fn(() => settings)};
	const app = express();
	app.use(express.json());
	app.use('/api', createSettingsRouter({store: store as never, credentialService: credentialService as never}));
	const server = createServer(app);
	servers.push(server);
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('Settings credential test server did not bind');
	return `http://127.0.0.1:${address.port}/api`;
};

describe('provider credential settings HTTP API', () => {
	it('never echoes the complete key and applies no-store to settings responses', async () => {
		const apiKey = 'sk-localcast-route-credential-1234';
		const replace = vi.fn(() => ({configured: true, displayHint: '•••1234'}));
		const testConnection = vi.fn(async () => ({verified: true as const, verifiedAt: '2026-09-23T12:00:00.000Z', capabilities: ['text' as const]}));
		const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const baseUrl = await start({replace, testConnection});

		const replaced = await fetch(`${baseUrl}/settings/provider-credentials/openai`, {
			method: 'PUT',
			headers: {'content-type': 'application/json'},
			body: JSON.stringify({apiKey}),
		});
		const replacementBody = await replaced.text();
		expect(replaced.status).toBe(200);
		expect(replaced.headers.get('cache-control')).toBe('no-store');
		expect(replacementBody).not.toContain(apiKey);
		expect(replace).toHaveBeenCalledWith(expect.anything(), apiKey);
		const tested = await fetch(`${baseUrl}/settings/provider-credentials/openai/test`, {method: 'POST'});
		const testBody = await tested.text();
		expect(tested.status).toBe(200);
		expect(tested.headers.get('cache-control')).toBe('no-store');
		expect(testBody).not.toContain(apiKey);

		const settings = await fetch(`${baseUrl}/settings`);
		expect(settings.headers.get('cache-control')).toBe('no-store');
		expect(await settings.text()).not.toContain(apiKey);
		expect(errorLog.mock.calls.flat().join(' ')).not.toContain(apiKey);
	});

	it('rejects masked placeholders before credential storage', async () => {
		const replace = vi.fn();
		const baseUrl = await start({replace, testConnection: vi.fn()});
		const response = await fetch(`${baseUrl}/settings/provider-credentials/openai`, {
			method: 'PUT',
			headers: {'content-type': 'application/json'},
			body: JSON.stringify({apiKey: '********************1234'}),
		});
		expect(response.status).toBe(400);
		expect(await response.text()).not.toContain('********************1234');
		expect(replace).not.toHaveBeenCalled();
	});

	it.each([
		['19 characters', {apiKey: 'k'.repeat(19)}, 400, false],
		['20 characters', {apiKey: 'k'.repeat(20)}, 200, true],
		['512 characters', {apiKey: 'k'.repeat(512)}, 200, true],
		['513 characters', {apiKey: 'k'.repeat(513)}, 400, false],
		['an extra field', {apiKey: 'k'.repeat(20), unexpected: true}, 400, false],
	] as const)('enforces the credential request boundary for %s', async (_label, body, status, stored) => {
		const replace = vi.fn(() => ({configured: true, displayHint: '••••kkkk'}));
		const baseUrl = await start({replace, testConnection: vi.fn()});
		const response = await fetch(`${baseUrl}/settings/provider-credentials/openai`, {
			method: 'PUT',
			headers: {'content-type': 'application/json'},
			body: JSON.stringify(body),
		});

		expect(response.status).toBe(status);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(replace).toHaveBeenCalledTimes(stored ? 1 : 0);
		expect(await response.text()).not.toContain(body.apiKey);
	});
});
