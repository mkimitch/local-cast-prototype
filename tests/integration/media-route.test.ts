import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {afterEach, describe, expect, it} from 'vitest';
import {createMediaIntegrityVerifier, createMediaRouter} from '../../server/routes/media';
import type {MediaIntegrityVerifier} from '../../server/routes/media';
import type {PublishedMediaRecord} from '../../server/services/episodeStore';
import {deterministicFakeMp3Bytes} from '../../server/testing/fakeGenerationProcessor';
import {testConfig} from '../helpers/database';

const roots: string[] = [];

afterEach(() => {
	while (roots.length > 0) fs.rmSync(roots.pop()!, {recursive: true, force: true});
});

const withServer = async (
	mediaPath: string,
	lookup: (assetId: string) => PublishedMediaRecord | undefined,
	assertion: (origin: string) => Promise<void>,
	verifyIntegrity?: MediaIntegrityVerifier,
): Promise<void> => {
	const app = express();
	app.use(createMediaRouter(testConfig({mediaPath}), {getPublishedMedia: lookup}, verifyIntegrity));
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

const fixture = (root: string): {asset: PublishedMediaRecord; bytes: Buffer} => {
	const bytes = deterministicFakeMp3Bytes();
	const filename = 'episode-safe.mp3';
	fs.writeFileSync(path.join(root, filename), bytes);
	return {
		bytes,
		asset: {
			assetId: 'audio-safe',
			runId: 'run-safe',
			storageFilename: filename,
			byteLength: bytes.byteLength,
			mimeType: 'audio/mpeg',
			sha256: createHash('sha256').update(bytes).digest('hex'),
			validatedAt: '2026-08-06T12:00:00.000Z',
		},
	};
};

describe('published media route', () => {
	it('serves GET, HEAD, and validators with exact immutable metadata', async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localcast-media-route-'));
		roots.push(root);
		const {asset, bytes} = fixture(root);

		await withServer(root, id => id === asset.assetId ? asset : undefined, async origin => {
			const response = await fetch(`${origin}/media/audio-safe`);
			expect(response.status).toBe(200);
			expect(response.headers.get('content-type')).toBe('audio/mpeg');
			expect(response.headers.get('content-length')).toBe(String(bytes.byteLength));
			expect(response.headers.get('etag')).toBe(`"${asset.sha256}"`);
			expect(response.headers.get('last-modified')).toBe(new Date(asset.validatedAt).toUTCString());
			expect(response.headers.get('accept-ranges')).toBe('bytes');
			expect(response.headers.get('cache-control')).toBe('private, no-store');
			expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);

			const head = await fetch(`${origin}/media/audio-safe`, {method: 'HEAD'});
			expect(head.status).toBe(200);
			expect(head.headers.get('content-length')).toBe(String(bytes.byteLength));
			expect(head.headers.get('etag')).toBe(`"${asset.sha256}"`);
			expect((await head.arrayBuffer()).byteLength).toBe(0);

			for (const validator of [`"${asset.sha256}"`, `W/"${asset.sha256}"`]) {
				const etagNotModified = await fetch(`${origin}/media/audio-safe`, {headers: {'If-None-Match': validator}});
				expect(etagNotModified.status).toBe(304);
			}
			const dateNotModified = await fetch(`${origin}/media/audio-safe`, {headers: {'If-Modified-Since': new Date(asset.validatedAt).toUTCString()}});
			expect(dateNotModified.status).toBe(304);
			const rangeEtagNotModified = await fetch(`${origin}/media/audio-safe`, {headers: {
				Range: 'bytes=0-7',
				'If-None-Match': `W/"${asset.sha256}"`,
			}});
			expect(rangeEtagNotModified.status).toBe(304);
			expect(rangeEtagNotModified.headers.get('content-range')).toBeNull();
			const rangeDateNotModified = await fetch(`${origin}/media/audio-safe`, {headers: {
				Range: 'bytes=0-7',
				'If-Modified-Since': new Date(asset.validatedAt).toUTCString(),
			}});
			expect(rangeDateNotModified.status).toBe(304);
			const changedEtagWins = await fetch(`${origin}/media/audio-safe`, {headers: {
				'If-None-Match': '"changed"',
				'If-Modified-Since': new Date(asset.validatedAt).toUTCString(),
			}});
			expect(changedEtagWins.status).toBe(200);
			const changedEtagAllowsRange = await fetch(`${origin}/media/audio-safe`, {headers: {
				Range: 'bytes=0-7',
				'If-None-Match': '"changed"',
				'If-Modified-Since': new Date(asset.validatedAt).toUTCString(),
			}});
			expect(changedEtagAllowsRange.status).toBe(206);
			expect(Buffer.from(await changedEtagAllowsRange.arrayBuffer())).toEqual(bytes.subarray(0, 8));
			expect((await fetch(`${origin}/media/unpublished`)).status).toBe(404);
		});
	});

	it('returns byte-exact bounded, open-ended, suffix, and HEAD ranges', async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localcast-media-ranges-'));
		roots.push(root);
		const {asset, bytes} = fixture(root);

		await withServer(root, id => id === asset.assetId ? asset : undefined, async origin => {
			const cases = [
				{header: 'bytes=0-31', start: 0, end: 31},
				{header: 'bytes=32-', start: 32, end: bytes.byteLength - 1},
				{header: 'bytes=-37', start: bytes.byteLength - 37, end: bytes.byteLength - 1},
				{header: `bytes=${bytes.byteLength - 1}-${bytes.byteLength + 100}`, start: bytes.byteLength - 1, end: bytes.byteLength - 1},
				{header: `bytes=-${bytes.byteLength + 100}`, start: 0, end: bytes.byteLength - 1},
			];
			for (const value of cases) {
				const response = await fetch(`${origin}/media/audio-safe`, {headers: {Range: value.header}});
				expect(response.status).toBe(206);
				expect(response.headers.get('content-range')).toBe(`bytes ${value.start}-${value.end}/${bytes.byteLength}`);
				expect(response.headers.get('content-length')).toBe(String(value.end - value.start + 1));
				expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes.subarray(value.start, value.end + 1));
			}

			const head = await fetch(`${origin}/media/audio-safe`, {method: 'HEAD', headers: {Range: 'bytes=4-19'}});
			expect(head.status).toBe(206);
			expect(head.headers.get('content-range')).toBe(`bytes 4-19/${bytes.byteLength}`);
			expect(head.headers.get('content-length')).toBe('16');
			expect((await head.arrayBuffer()).byteLength).toBe(0);
		});
	});

	it('hashes repeated tiny ranges once per stable file identity and revalidates mutations', async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localcast-media-cache-'));
		roots.push(root);
		const {asset, bytes} = fixture(root);
		let hashCount = 0;
		const verifier = createMediaIntegrityVerifier(8, (fd, byteLength) => {
			hashCount += 1;
			const content = Buffer.alloc(byteLength);
			fs.readSync(fd, content, 0, byteLength, 0);
			return createHash('sha256').update(content).digest('hex');
		});

		await withServer(root, id => id === asset.assetId ? asset : undefined, async origin => {
			for (let index = 0; index < 8; index += 1) {
				const response = await fetch(`${origin}/media/audio-safe`, {headers: {Range: `bytes=${index}-${index}`}});
				expect(response.status).toBe(206);
			}
			expect(hashCount).toBe(1);
			const mediaPath = path.join(root, asset.storageFilename);
			fs.writeFileSync(mediaPath, Buffer.alloc(bytes.byteLength, 7));
			expect((await fetch(`${origin}/media/audio-safe`, {headers: {Range: 'bytes=0-0'}})).status).toBe(503);
			expect(hashCount).toBe(2);
		}, verifier);
	});

	it('uses a documented single-range policy and returns exact 416 metadata', async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localcast-media-range-errors-'));
		roots.push(root);
		const {asset, bytes} = fixture(root);

		await withServer(root, id => id === asset.assetId ? asset : undefined, async origin => {
			for (const range of ['items=0-1', 'bytes=', 'bytes=-0', 'bytes=20-10', `bytes=${bytes.byteLength}-`, 'bytes=0-1,4-5', 'bytes=999999999999999999999-']) {
				const response = await fetch(`${origin}/media/audio-safe`, {headers: {Range: range}});
				expect(response.status).toBe(416);
				expect(response.headers.get('content-range')).toBe(`bytes */${bytes.byteLength}`);
				expect(response.headers.get('content-length')).toBe('0');
				expect((await response.arrayBuffer()).byteLength).toBe(0);
			}
		});
	});

	it('honors If-Range and otherwise falls back to the full immutable response', async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localcast-media-if-range-'));
		roots.push(root);
		const {asset, bytes} = fixture(root);

		await withServer(root, id => id === asset.assetId ? asset : undefined, async origin => {
			const matching = await fetch(`${origin}/media/audio-safe`, {headers: {Range: 'bytes=0-7', 'If-Range': `"${asset.sha256}"`}});
			expect(matching.status).toBe(206);
			expect(Buffer.from(await matching.arrayBuffer())).toEqual(bytes.subarray(0, 8));
			const changed = await fetch(`${origin}/media/audio-safe`, {headers: {Range: 'bytes=0-7', 'If-Range': '"changed"'}});
			expect(changed.status).toBe(200);
			expect(Buffer.from(await changed.arrayBuffer())).toEqual(bytes);
			const weak = await fetch(`${origin}/media/audio-safe`, {headers: {Range: 'bytes=0-7', 'If-Range': `W/"${asset.sha256}"`}});
			expect(weak.status).toBe(200);
			expect(Buffer.from(await weak.arrayBuffer())).toEqual(bytes);
		});
	});

	it('rejects traversal metadata, temporary names, symlinks, and same-sized corruption', async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localcast-media-route-negative-'));
		roots.push(root);
		const {asset, bytes} = fixture(root);
		const corruptName = 'episode-corrupt.mp3';
		const corruptPath = path.join(root, corruptName);
		fs.writeFileSync(corruptPath, Buffer.alloc(bytes.byteLength, 9));
		const linkName = 'episode-link.mp3';
		fs.symlinkSync(corruptPath, path.join(root, linkName));
		const temporaryName = '.episode-part.mp3.tmp';
		fs.writeFileSync(path.join(root, temporaryName), bytes);

		await withServer(root, id => {
			if (id === 'audio-corrupt') return {...asset, assetId: id, storageFilename: corruptName};
			if (id === 'audio-link') return {...asset, assetId: id, storageFilename: linkName};
			if (id === 'audio-traversal') return {...asset, assetId: id, storageFilename: '../outside.mp3'};
			if (id === 'audio-temporary') return {...asset, assetId: id, storageFilename: temporaryName};
			return undefined;
		}, async origin => {
			expect((await fetch(`${origin}/media/audio-corrupt`)).status).toBe(503);
			expect((await fetch(`${origin}/media/audio-link`)).status).toBe(503);
			expect((await fetch(`${origin}/media/audio-traversal`)).status).toBe(404);
			expect((await fetch(`${origin}/media/audio-temporary`)).status).toBe(404);
			for (const pathValue of ['/media/%2e%2e%2foutside', '/media/%00', '/media/%ZZ']) {
				expect((await fetch(`${origin}${pathValue}`)).status).not.toBe(200);
			}
		});
	});
});
