import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {afterEach, describe, expect, it} from 'vitest';
import {createMediaRouter} from '../../server/routes/media';
import {deterministicFakeMp3Bytes} from '../../server/testing/fakeGenerationProcessor';
import {testConfig} from '../helpers/database';

const roots: string[] = [];

afterEach(() => {
	while (roots.length > 0) fs.rmSync(roots.pop()!, {recursive: true, force: true});
});

const withServer = async (mediaPath: string, lookup: (assetId: string) => {
	storageFilename: string;
	byteLength: number;
	mimeType: string;
	sha256: string;
} | undefined, assertion: (origin: string) => Promise<void>): Promise<void> => {
	const app = express();
	app.use(createMediaRouter(testConfig({mediaPath}), {getPublishedMedia: lookup}));
	const server = createServer(app);
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	try {
		const address = server.address();
		if (!address || typeof address === 'string') throw new Error('Media test server did not bind');
		await assertion(`http://127.0.0.1:${address.port}`);
	} finally {
		await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
	}
};

describe('published media route', () => {
	it('serves only checksum-valid regular files with exact immutable metadata', async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localcast-media-route-'));
		roots.push(root);
		const bytes = deterministicFakeMp3Bytes();
		const filename = 'episode-safe.mp3';
		fs.writeFileSync(path.join(root, filename), bytes);
		const asset = {
			storageFilename: filename,
			byteLength: bytes.byteLength,
			mimeType: 'audio/mpeg',
			sha256: createHash('sha256').update(bytes).digest('hex'),
		};

		await withServer(root, id => id === 'audio-safe' ? asset : undefined, async origin => {
			const response = await fetch(`${origin}/media/audio-safe`);
			expect(response.status).toBe(200);
			expect(response.headers.get('content-type')).toBe('audio/mpeg');
			expect(response.headers.get('content-length')).toBe(String(bytes.byteLength));
			expect(response.headers.get('etag')).toBe(`"${asset.sha256}"`);
			expect(response.headers.get('cache-control')).toBe('private, no-store');
			expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
			expect((await fetch(`${origin}/media/unpublished`)).status).toBe(404);
		});
	});

	it('rejects traversal metadata, symlinks, and same-sized corruption', async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localcast-media-route-negative-'));
		roots.push(root);
		const bytes = deterministicFakeMp3Bytes();
		const filename = 'episode-corrupt.mp3';
		const filePath = path.join(root, filename);
		fs.writeFileSync(filePath, Buffer.alloc(bytes.byteLength, 9));
		const corrupt = {
			storageFilename: filename,
			byteLength: bytes.byteLength,
			mimeType: 'audio/mpeg',
			sha256: createHash('sha256').update(bytes).digest('hex'),
		};
		const linkName = 'episode-link.mp3';
		fs.symlinkSync(filePath, path.join(root, linkName));

		await withServer(root, id => {
			if (id === 'audio-corrupt') return corrupt;
			if (id === 'audio-link') return {...corrupt, storageFilename: linkName};
			if (id === 'audio-traversal') return {...corrupt, storageFilename: '../outside.mp3'};
			return undefined;
		}, async origin => {
			expect((await fetch(`${origin}/media/audio-corrupt`)).status).toBe(503);
			expect((await fetch(`${origin}/media/audio-link`)).status).toBe(503);
			expect((await fetch(`${origin}/media/audio-traversal`)).status).toBe(404);
		});
	});
});
