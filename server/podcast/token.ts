import {createHash, timingSafeEqual} from 'node:crypto';
import fs from 'node:fs';
import type {ServerConfig} from '../config';

export const podcastTokenByteLength = 32;
export const podcastTokenEncodedLength = 43;

const canonicalToken = (value: string): Buffer | undefined => {
	if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return undefined;
	const decoded = Buffer.from(value, 'base64url');
	if (decoded.byteLength !== podcastTokenByteLength || decoded.toString('base64url') !== value) return undefined;
	return decoded;
};

const isObviouslyWeak = (value: string, decoded: Buffer): boolean => {
	if (/(replace|example|change.?me|localcast)/i.test(value)) return true;
	return new Set(decoded).size < 16;
};

const digest = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();

const readProtectedToken = (filePath: string): string => {
	let descriptor: number;
	try {
		descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
	} catch (error) {
		if (error && typeof error === 'object' && 'code' in error && error.code === 'ELOOP') {
			throw new Error('LocalCast podcast token file must be a regular non-symlink file');
		}
		throw new Error('LocalCast podcast token file is missing or unreadable');
	}

	try {
		const stat = fs.fstatSync(descriptor);
		if (!stat.isFile()) throw new Error('LocalCast podcast token file must be a regular non-symlink file');
		if ((stat.mode & 0o077) !== 0) throw new Error('LocalCast podcast token file must not grant group or world permissions');
		if (stat.size < podcastTokenEncodedLength || stat.size > podcastTokenEncodedLength + 2) {
			throw new Error('LocalCast podcast token file has an invalid size');
		}
		const raw = fs.readFileSync(descriptor, 'utf8');
		const value = raw.endsWith('\r\n') ? raw.slice(0, -2) : raw.endsWith('\n') ? raw.slice(0, -1) : raw;
		const decoded = canonicalToken(value);
		if (!decoded || isObviouslyWeak(value, decoded)) {
			throw new Error('LocalCast podcast token must be a strong canonical 256-bit base64url value');
		}
		return value;
	} finally {
		fs.closeSync(descriptor);
	}
};

export class PodcastAccess {
	private readonly expectedDigest: Buffer;

	private constructor(
		private readonly token: string,
		readonly publicBaseUrl: string,
	) {
		this.expectedDigest = digest(token);
	}

	static load(config: Pick<ServerConfig, 'podcastTokenFile' | 'publicBaseUrl'>): PodcastAccess | undefined {
		if (!config.podcastTokenFile && !config.publicBaseUrl) return undefined;
		if (!config.podcastTokenFile || !config.publicBaseUrl) {
			throw new Error('LocalCast podcast delivery requires both a public origin and protected token file');
		}
		return new PodcastAccess(readProtectedToken(config.podcastTokenFile), config.publicBaseUrl);
	}

	isAuthorized(candidate: string | undefined): boolean {
		const supplied = typeof candidate === 'string' ? candidate : '';
		const suppliedDigest = digest(supplied.slice(0, 8_192));
		const equal = timingSafeEqual(this.expectedDigest, suppliedDigest);
		return equal && canonicalToken(supplied) !== undefined;
	}

	feedUrl(): string {
		return `${this.publicBaseUrl}/podcast/${encodeURIComponent(this.token)}/feed.xml`;
	}

	enclosureUrl(runId: string): string {
		return `${this.publicBaseUrl}/podcast/${encodeURIComponent(this.token)}/episodes/${encodeURIComponent(runId)}.mp3`;
	}
}
