import {randomBytes} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {PodcastAccess, podcastTokenEncodedLength} from '../../server/podcast/token';

const roots: string[] = [];

afterEach(() => {
	while (roots.length > 0) fs.rmSync(roots.pop()!, {recursive: true, force: true});
});

const root = (): string => {
	const value = fs.mkdtempSync(path.join(os.tmpdir(), 'localcast-podcast-token-'));
	fs.chmodSync(value, 0o700);
	roots.push(value);
	return value;
};

const randomToken = (): string => randomBytes(32).toString('base64url');

const writeToken = (directory: string, value: string, mode = 0o600): string => {
	const filePath = path.join(directory, `token-${randomBytes(6).toString('hex')}`);
	fs.writeFileSync(filePath, value, {mode});
	fs.chmodSync(filePath, mode);
	return filePath;
};

const load = (filePath: string): PodcastAccess => PodcastAccess.load({
	podcastTokenFile: filePath,
	publicBaseUrl: 'https://localcast.example.test',
})!;

describe('private podcast token boundary', () => {
	it('loads a protected CSPRNG token and compares only fixed-size digests', () => {
		const token = randomToken();
		const access = load(writeToken(root(), token));

		expect(token.length).toBe(podcastTokenEncodedLength);
		expect(access.isAuthorized(token)).toBe(true);
		expect(access.isAuthorized(randomToken())).toBe(false);
		expect(access.isAuthorized(undefined)).toBe(false);
		expect(access.isAuthorized('malformed')).toBe(false);
		expect(new URL(access.feedUrl()).origin === 'https://localcast.example.test').toBe(true);
		expect(new URL(access.feedUrl()).pathname.split('/')[2]?.length).toBe(podcastTokenEncodedLength);
	});

	it('accepts only one terminal newline as file framing', () => {
		const token = randomToken();
		expect(load(writeToken(root(), `${token}\n`)).isAuthorized(token)).toBe(true);
		expect(load(writeToken(root(), `${token}\r\n`)).isAuthorized(token)).toBe(true);
		expect(() => load(writeToken(root(), `${token}\n\n`))).toThrow(/invalid size|strong canonical/);
	});

	it('rejects missing, non-regular, symlinked, and over-permissive files', () => {
		const directory = root();
		expect(() => load(path.join(directory, 'missing'))).toThrow(/missing or unreadable/);
		expect(() => load(directory)).toThrow(/regular non-symlink/);
		const target = writeToken(directory, randomToken());
		const link = path.join(directory, 'link');
		fs.symlinkSync(target, link);
		expect(() => load(link)).toThrow(/regular non-symlink/);
		expect(() => load(writeToken(directory, randomToken(), 0o640))).toThrow(/group or world/);
	});

	it('rejects undersized, malformed, placeholder-like, and repeated-byte values', () => {
		const directory = root();
		for (const value of [
			randomBytes(31).toString('base64url'),
			`${randomToken().slice(0, -1)}!`,
			Buffer.alloc(32).toString('base64url'),
			`localcast${'A'.repeat(34)}`,
			'replace-with-private-podcast-token-value',
		]) {
			expect(() => load(writeToken(directory, value))).toThrow(/invalid size|strong canonical/);
		}
	});

	it('invalidates the old token immediately when a replacement access instance loads', () => {
		const directory = root();
		const oldToken = randomToken();
		const nextToken = randomToken();
		const oldAccess = load(writeToken(directory, oldToken));
		const nextAccess = load(writeToken(directory, nextToken));

		expect(oldAccess.isAuthorized(oldToken)).toBe(true);
		expect(nextAccess.isAuthorized(oldToken)).toBe(false);
		expect(nextAccess.isAuthorized(nextToken)).toBe(true);
	});
});
