import {createHash, randomBytes} from 'node:crypto';
import {createServer, request as httpRequest} from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {createApp} from '../../server/app';
import {testConfig} from '../helpers/database';

const roots: string[] = [];

afterEach(() => {
	while (roots.length > 0) fs.rmSync(roots.pop()!, {recursive: true, force: true});
});

const fingerprint = async (response: Response): Promise<Record<string, string | number | null>> => {
	const body = Buffer.from(await response.arrayBuffer());
	return {
		status: response.status,
		cache: response.headers.get('cache-control'),
		contentType: response.headers.get('content-type'),
		length: body.byteLength,
		sha256: createHash('sha256').update(body).digest('hex'),
	};
};

const safeRequest = async (url: string, init: RequestInit = {}): Promise<Response> => new Promise((resolve, reject) => {
	const target = new URL(url);
	const request = httpRequest({
		host: target.hostname,
		port: target.port,
		path: `${target.pathname}${target.search}`,
		method: init.method || 'GET',
		headers: init.headers as Record<string, string> | undefined,
	}, response => {
		const chunks: Buffer[] = [];
		response.on('data', chunk => chunks.push(Buffer.from(chunk)));
		response.once('end', () => {
			const headers = new Headers();
			for (let index = 0; index < response.rawHeaders.length; index += 2) {
				headers.append(response.rawHeaders[index], response.rawHeaders[index + 1]);
			}
			resolve(new Response(Buffer.concat(chunks), {status: response.statusCode, headers}));
		});
	});
	request.once('error', () => reject(new Error('Private-route origin request failed')));
	request.end();
});

describe('canonical application origin', () => {
	it('fails closed for untrusted Host and proxy headers without trusting request-derived URLs', async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localcast-origin-'));
		fs.chmodSync(root, 0o700);
		roots.push(root);
		const token = randomBytes(32).toString('base64url');
		const tokenPath = path.join(root, 'podcast-token');
		fs.writeFileSync(tokenPath, token, {mode: 0o600});
		const publicBaseUrl = 'https://localcast.example.test';
		const config = testConfig({
			processRole: 'app',
			publicBaseUrl,
			podcastTokenFile: tokenPath,
			trustedOrigins: [publicBaseUrl],
			webDistPath: path.join(root, 'missing-web-build'),
		});
		const server = createServer(createApp(config));
		await new Promise<void>((resolve, reject) => {
			server.once('error', reject);
			server.listen(0, '127.0.0.1', resolve);
		});
		try {
			const address = server.address();
			if (!address || typeof address === 'string') throw new Error('Origin test server did not bind');
			const origin = `http://127.0.0.1:${address.port}`;
			const canonicalHeaders = {Host: 'localcast.example.test', 'X-Forwarded-Host': 'localcast.example.test', 'X-Forwarded-Proto': 'https'};
			expect((await safeRequest(`${origin}/api/podcast/status`, {headers: canonicalHeaders})).status).toBe(200);
			for (const headers of [
				{Host: 'unexpected.example.test'},
				{...canonicalHeaders, 'X-Forwarded-Host': 'unexpected.example.test'},
				{...canonicalHeaders, 'X-Forwarded-Proto': 'http'},
				{...canonicalHeaders, 'X-Forwarded-Port': '80'},
				{...canonicalHeaders, Forwarded: 'host=unexpected.example.test;proto=https'},
			]) {
				expect((await safeRequest(`${origin}/api/health`, {headers})).status).toBe(421);
			}
			expect((await safeRequest(`${origin}/api/settings`, {headers: {...canonicalHeaders, Origin: 'https://unexpected.example.test'}})).status).toBe(403);

			const routine = await safeRequest(`${origin}/api/podcast/status`, {headers: {...canonicalHeaders, Origin: publicBaseUrl}});
			const routineBody = await routine.text();
			expect(routine.status).toBe(200);
			expect(routineBody.includes(token)).toBe(false);
			expect((await safeRequest(`${origin}/api/podcast/subscription-url`, {method: 'POST', headers: canonicalHeaders})).status).toBe(403);
			const reveal = await safeRequest(`${origin}/api/podcast/subscription-url`, {method: 'POST', headers: {...canonicalHeaders, Origin: publicBaseUrl}});
			const revealBody = await reveal.json() as {subscriptionUrl?: string};
			expect(reveal.status).toBe(200);
			expect(typeof revealBody.subscriptionUrl === 'string' && revealBody.subscriptionUrl.startsWith(`${publicBaseUrl}/podcast/`) && revealBody.subscriptionUrl.endsWith('/feed.xml')).toBe(true);
			revealBody.subscriptionUrl = '';

			const wrongHostPodcast = await fingerprint(await safeRequest(`${origin}/podcast/${randomBytes(32).toString('base64url')}/feed.xml`, {headers: {Host: 'unexpected.example.test'}}));
			const malformedPodcast = await fingerprint(await safeRequest(`${origin}/podcast/%ZZ/feed.xml`, {headers: canonicalHeaders}));
			const wrongOriginPodcast = await fingerprint(await safeRequest(`${origin}/podcast/${randomBytes(32).toString('base64url')}/feed.xml`, {
				headers: {...canonicalHeaders, Origin: 'https://unexpected.example.test'},
			}));
			expect(JSON.stringify(wrongHostPodcast) === JSON.stringify(malformedPodcast)).toBe(true);
			expect(JSON.stringify(wrongOriginPodcast) === JSON.stringify(malformedPodcast)).toBe(true);
			expect(malformedPodcast.status).toBe(404);
		} finally {
			await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
		}
	});
});
