import {lookup as dnsLookup} from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import {BlockList, isIP} from 'node:net';
import type {LookupFunction} from 'node:net';
import type {FeedNetworkScope} from '../../src/types';

export interface FeedFetchLimits {
	maxBytes: number;
	maxRedirects: number;
	totalTimeoutMs: number;
	idleTimeoutMs: number;
	maxHeaderBytes: number;
}

export const feedFetchLimits: FeedFetchLimits = {
	maxBytes: 2 * 1024 * 1024,
	maxRedirects: 5,
	totalTimeoutMs: 15_000,
	idleTimeoutMs: 5_000,
	maxHeaderBytes: 16 * 1024,
} as const;

export type FeedFetchErrorCode =
	| 'INVALID_FEED_URL'
	| 'FEED_DESTINATION_BLOCKED'
	| 'FEED_DNS_FAILED'
	| 'FEED_REDIRECT_INVALID'
	| 'FEED_REDIRECT_LIMIT'
	| 'FEED_CONCURRENCY_LIMIT'
	| 'FEED_TIMEOUT'
	| 'FEED_TOO_LARGE'
	| 'FEED_CONTENT_TYPE_INVALID'
	| 'FEED_CONTENT_ENCODING_INVALID'
	| 'FEED_HTTP_ERROR'
	| 'FEED_CONNECTION_FAILED';

const safeMessages: Record<FeedFetchErrorCode, string> = {
	INVALID_FEED_URL: 'The feed URL is not a valid credential-free HTTP(S) URL',
	FEED_DESTINATION_BLOCKED: 'The feed destination is blocked by the LocalCast network policy',
	FEED_DNS_FAILED: 'The feed hostname could not be resolved safely',
	FEED_REDIRECT_INVALID: 'The feed returned an invalid or unsafe redirect',
	FEED_REDIRECT_LIMIT: 'The feed exceeded the redirect limit',
	FEED_CONCURRENCY_LIMIT: 'Too many feed synchronizations are already pending',
	FEED_TIMEOUT: 'The feed did not respond within the allowed time',
	FEED_TOO_LARGE: 'The feed exceeded the response size limit',
	FEED_CONTENT_TYPE_INVALID: 'The response is not an RSS or Atom XML document',
	FEED_CONTENT_ENCODING_INVALID: 'Compressed feed responses are not accepted',
	FEED_HTTP_ERROR: 'The feed returned an unsuccessful HTTP status',
	FEED_CONNECTION_FAILED: 'The feed connection failed',
};

export class FeedFetchError extends Error {
	readonly safeMessage: string;

	constructor(readonly code: FeedFetchErrorCode, readonly retryable: boolean) {
		super(safeMessages[code]);
		this.name = 'FeedFetchError';
		this.safeMessage = safeMessages[code];
	}
}

type ResolvedAddress = {address: string; family: 4 | 6};
export type FeedResolver = (hostname: string) => Promise<ResolvedAddress[]>;

export interface FeedValidators {
	etag?: string;
	lastModified?: string;
	validatorUrl?: string;
}

export type FeedFetchResult = {
	status: 'ok';
	body: string;
	finalUrl: string;
	etag?: string;
	lastModified?: string;
	networkScope: Exclude<FeedNetworkScope, 'unknown'>;
} | {
	status: 'not_modified';
	finalUrl: string;
	etag?: string;
	lastModified?: string;
	networkScope: Exclude<FeedNetworkScope, 'unknown'>;
};

const alwaysBlockedV4 = new BlockList();
[
	['0.0.0.0', 8],
	['100.64.0.0', 10],
	['169.254.0.0', 16],
	['192.0.0.0', 24],
	['192.0.2.0', 24],
	['192.88.99.0', 24],
	['198.18.0.0', 15],
	['198.51.100.0', 24],
	['203.0.113.0', 24],
	['224.0.0.0', 4],
	['240.0.0.0', 4],
].forEach(([address, prefix]) => alwaysBlockedV4.addSubnet(address as string, prefix as number, 'ipv4'));

const privateV4 = new BlockList();
[
	['10.0.0.0', 8],
	['127.0.0.0', 8],
	['172.16.0.0', 12],
	['192.168.0.0', 16],
].forEach(([address, prefix]) => privateV4.addSubnet(address as string, prefix as number, 'ipv4'));

const alwaysBlockedV6 = new BlockList();
[
	['::', 128],
	['::', 96],
	['64:ff9b:1::', 48],
	['100::', 64],
	['2001::', 23],
	['2001:db8::', 32],
	['2002::', 16],
	['3fff::', 20],
	['fd00:ec2::254', 128],
	['fec0::', 10],
	['fe80::', 10],
	['ff00::', 8],
].forEach(([address, prefix]) => alwaysBlockedV6.addSubnet(address as string, prefix as number, 'ipv6'));

const privateV6 = new BlockList();
privateV6.addSubnet('::1', 128, 'ipv6');
privateV6.addSubnet('fc00::', 7, 'ipv6');

const publicV6 = new BlockList();
publicV6.addSubnet('2000::', 3, 'ipv6');

const stripZone = (value: string): string => value.split('%', 1)[0]!.toLowerCase();

const mappedIpv4 = (value: string): string | undefined => {
	const address = stripZone(value);
	const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address)?.[1];
	if (dotted && isIP(dotted) === 4) return dotted;
	const hexadecimal = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(address);
	if (!hexadecimal) return undefined;
	const high = Number.parseInt(hexadecimal[1]!, 16);
	const low = Number.parseInt(hexadecimal[2]!, 16);
	return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
};

const normalizeAddress = (value: string): ResolvedAddress | undefined => {
	const mapped = mappedIpv4(value);
	if (mapped) return {address: mapped, family: 4};
	const address = stripZone(value);
	const family = isIP(address);
	return family === 4 || family === 6 ? {address, family} : undefined;
};

export const sameFeedAddress = (expected: string, actual: string): boolean => {
	const left = normalizeAddress(expected);
	const right = normalizeAddress(actual);
	return Boolean(left && right && left.family === right.family && left.address === right.address);
};

type AddressClass = 'public' | 'private' | 'always_blocked';

export const classifyFeedAddress = (value: string): AddressClass => {
	const normalized = normalizeAddress(value);
	if (!normalized) return 'always_blocked';
	if (normalized.family === 4) {
		if (alwaysBlockedV4.check(normalized.address, 'ipv4')) return 'always_blocked';
		if (privateV4.check(normalized.address, 'ipv4')) return 'private';
		return 'public';
	}
	if (normalized.address === 'fd00:ec2::254') return 'always_blocked';
	if (privateV6.check(normalized.address, 'ipv6')) return 'private';
	if (alwaysBlockedV6.check(normalized.address, 'ipv6')) return 'always_blocked';
	return publicV6.check(normalized.address, 'ipv6') ? 'public' : 'always_blocked';
};

export const normalizeFeedHostname = (value: string): string => value
	.replace(/^\[|\]$/g, '')
	.replace(/\.$/, '')
	.toLowerCase();

const sensitiveQueryName = (value: string): boolean => {
	const normalized = value.normalize('NFKC').replace(/[._-]/g, '').toLowerCase();
	return /(?:token|secret|password|passwd|apikey|authorization|credential|session|jwt|bearer|signature)/.test(normalized)
		|| /^(?:auth|key|sig)$/.test(normalized);
};

export const hasEmbeddedUrlCredential = (url: URL): boolean => (
	Boolean(url.username || url.password)
	|| [...url.searchParams.keys()].some(sensitiveQueryName)
);

export const parseFeedUrl = (value: string): URL => {
	if (!value || value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value)) throw new FeedFetchError('INVALID_FEED_URL', false);
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new FeedFetchError('INVALID_FEED_URL', false);
	}
	if (
		(url.protocol !== 'http:' && url.protocol !== 'https:')
		|| hasEmbeddedUrlCredential(url)
		|| url.hash
		|| !url.hostname
		|| normalizeFeedHostname(url.hostname).length > 253
	) {
		throw new FeedFetchError('INVALID_FEED_URL', false);
	}
	return url;
};

const defaultResolver: FeedResolver = async hostname => {
	try {
		const values = await dnsLookup(hostname, {all: true, verbatim: true});
		return values.flatMap(value => value.family === 4 || value.family === 6 ? [{address: value.address, family: value.family}] : []);
	} catch {
		throw new FeedFetchError('FEED_DNS_FAILED', true);
	}
};

const headerValue = (value: string | string[] | undefined, maxLength: number): string | undefined => {
	const candidate = Array.isArray(value) ? value[0] : value;
	if (!candidate || candidate.length > maxLength || /[\r\n\u0000]/.test(candidate)) return undefined;
	return candidate;
};

const allowedContentTypes = new Set([
	'application/atom+xml',
	'application/rss+xml',
	'application/xml',
	'text/xml',
]);

const addMilliseconds = (now: number, milliseconds: number): number => now + milliseconds;

export class SafeFeedFetcher {
	private readonly privateHosts: Set<string>;
	private activeFetches = 0;
	private readonly fetchWaiters: Array<() => void> = [];

	constructor(
		privateHosts: string[] = [],
		private readonly resolver: FeedResolver = defaultResolver,
		private readonly now: () => number = Date.now,
		private readonly limits: FeedFetchLimits = feedFetchLimits,
		private readonly maxConcurrentFetches = 4,
		private readonly maxQueuedFetches = Math.max(8, maxConcurrentFetches * 8),
	) {
		this.privateHosts = new Set(privateHosts.map(normalizeFeedHostname));
	}

	async fetch(feedUrl: string, validators: FeedValidators = {}, signal?: AbortSignal): Promise<FeedFetchResult> {
		const deadline = addMilliseconds(this.now(), this.limits.totalTimeoutMs);
		await this.acquireFetchSlot(signal, deadline);
		try {
			return await this.fetchHop(parseFeedUrl(feedUrl), validators, signal, deadline, new Set(), 0);
		} finally {
			this.releaseFetchSlot();
		}
	}

	private async acquireFetchSlot(signal: AbortSignal | undefined, deadline: number): Promise<void> {
		if (signal?.aborted) throw new DOMException('Worker stopped', 'AbortError');
		if (this.now() >= deadline) throw new FeedFetchError('FEED_TIMEOUT', true);
		if (this.activeFetches < this.maxConcurrentFetches) {
			this.activeFetches += 1;
			return;
		}
		if (this.fetchWaiters.length >= this.maxQueuedFetches) throw new FeedFetchError('FEED_CONCURRENCY_LIMIT', true);
		await new Promise<void>((resolve, reject) => {
			let settled = false;
			const cleanup = () => {
				clearTimeout(timeout);
				signal?.removeEventListener('abort', abort);
			};
			const ready = () => {
				if (settled) return;
				settled = true;
				cleanup();
				this.activeFetches += 1;
				resolve();
			};
			const abort = () => {
				if (settled) return;
				settled = true;
				const index = this.fetchWaiters.indexOf(ready);
				if (index >= 0) this.fetchWaiters.splice(index, 1);
				cleanup();
				reject(new DOMException('Worker stopped', 'AbortError'));
			};
			const timeout = setTimeout(() => {
				if (settled) return;
				settled = true;
				const index = this.fetchWaiters.indexOf(ready);
				if (index >= 0) this.fetchWaiters.splice(index, 1);
				cleanup();
				reject(new FeedFetchError('FEED_TIMEOUT', true));
			}, Math.max(1, deadline - this.now()));
			this.fetchWaiters.push(ready);
			signal?.addEventListener('abort', abort, {once: true});
			if (signal?.aborted) abort();
		});
	}

	private resolveAddresses(hostname: string, signal: AbortSignal | undefined, deadline: number): Promise<ResolvedAddress[]> {
		return new Promise((resolve, reject) => {
			let settled = false;
			const cleanup = () => {
				clearTimeout(timeout);
				signal?.removeEventListener('abort', abort);
			};
			const finish = (callback: () => void) => {
				if (settled) return;
				settled = true;
				cleanup();
				callback();
			};
			const abort = () => finish(() => reject(new DOMException('Worker stopped', 'AbortError')));
			const timeout = setTimeout(() => finish(() => reject(new FeedFetchError('FEED_TIMEOUT', true))), Math.max(1, deadline - this.now()));
			signal?.addEventListener('abort', abort, {once: true});
			if (signal?.aborted) {
				abort();
				return;
			}
			void this.resolver(hostname).then(
				addresses => finish(() => resolve(addresses)),
				error => finish(() => reject(error)),
			);
		});
	}

	private releaseFetchSlot(): void {
		this.activeFetches = Math.max(0, this.activeFetches - 1);
		this.fetchWaiters.shift()?.();
	}

	private async fetchHop(
		url: URL,
		validators: FeedValidators,
		signal: AbortSignal | undefined,
		deadline: number,
		visited: Set<string>,
		redirectCount: number,
	): Promise<FeedFetchResult> {
		if (signal?.aborted) throw new DOMException('Worker stopped', 'AbortError');
		if (this.now() >= deadline) throw new FeedFetchError('FEED_TIMEOUT', true);
		if (visited.has(url.href)) throw new FeedFetchError('FEED_REDIRECT_LIMIT', false);
		visited.add(url.href);

		const hostname = normalizeFeedHostname(url.hostname);
		const literal = normalizeAddress(hostname);
		let addresses: ResolvedAddress[];
		try {
			addresses = literal ? [literal] : await this.resolveAddresses(hostname, signal, deadline);
		} catch (error) {
			if (error instanceof FeedFetchError) throw error;
			throw new FeedFetchError('FEED_DNS_FAILED', true);
		}
		if (this.now() >= deadline) throw new FeedFetchError('FEED_TIMEOUT', true);
		const unique = [...new Map(addresses.flatMap(value => {
			const normalized = normalizeAddress(value.address);
			return normalized ? [[`${normalized.family}:${normalized.address}`, normalized] as const] : [];
		})).values()];
		if (unique.length === 0) throw new FeedFetchError('FEED_DNS_FAILED', true);

		const classes = unique.map(value => classifyFeedAddress(value.address));
		if (classes.includes('always_blocked')) throw new FeedFetchError('FEED_DESTINATION_BLOCKED', false);
		const reachesPrivate = classes.includes('private');
		if (reachesPrivate && !this.privateHosts.has(hostname)) throw new FeedFetchError('FEED_DESTINATION_BLOCKED', false);
		const networkScope: Exclude<FeedNetworkScope, 'unknown'> = reachesPrivate ? 'private' : 'public';
		const pinned = unique[0]!;

		return new Promise<FeedFetchResult>((resolve, reject) => {
			let settled = false;
			const fail = (error: unknown) => {
				if (settled) return;
				settled = true;
				cleanup();
				reject(error);
			};
			const succeed = (result: FeedFetchResult) => {
				if (settled) return;
				settled = true;
				cleanup();
				resolve(result);
			};
			const remaining = Math.max(1, deadline - this.now());
			const totalTimer = setTimeout(() => {
				request.destroy();
				fail(new FeedFetchError('FEED_TIMEOUT', true));
			}, remaining);
			const abort = () => {
				request.destroy();
				fail(new DOMException('Worker stopped', 'AbortError'));
			};
			const cleanup = () => {
				clearTimeout(totalTimer);
				signal?.removeEventListener('abort', abort);
			};

			const headers: Record<string, string> = {
				Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8',
				'Accept-Encoding': 'identity',
				'User-Agent': 'LocalCastPrototype/0.2',
			};
			if (validators.validatorUrl === url.href) {
				if (validators.etag) headers['If-None-Match'] = validators.etag;
				if (validators.lastModified) headers['If-Modified-Since'] = validators.lastModified;
			}

			const pinnedLookup: LookupFunction = (_lookupHostname, _options, callback) => {
				callback(null, pinned.address, pinned.family);
			};
			const transport = url.protocol === 'https:' ? https : http;
			const request = transport.request(url, {
				method: 'GET',
				headers,
				agent: false,
				lookup: pinnedLookup,
				autoSelectFamily: false,
				maxHeaderSize: this.limits.maxHeaderBytes,
				...(url.protocol === 'https:' && isIP(hostname) === 0 ? {servername: hostname} : {}),
			} as http.RequestOptions, response => {
				const remote = response.socket.remoteAddress ? normalizeAddress(response.socket.remoteAddress) : undefined;
				if (!remote || !sameFeedAddress(pinned.address, remote.address) || remote.family !== pinned.family) {
					response.destroy();
					fail(new FeedFetchError('FEED_DESTINATION_BLOCKED', false));
					return;
				}

				const status = response.statusCode || 0;
				if ([301, 302, 303, 307, 308].includes(status)) {
					response.destroy();
					if (redirectCount >= this.limits.maxRedirects) {
						fail(new FeedFetchError('FEED_REDIRECT_LIMIT', false));
						return;
					}
					const location = headerValue(response.headers.location, 2048);
					if (!location) {
						fail(new FeedFetchError('FEED_REDIRECT_INVALID', false));
						return;
					}
					let target: URL;
					try {
						target = parseFeedUrl(new URL(location, url).href);
					} catch {
						fail(new FeedFetchError('FEED_REDIRECT_INVALID', false));
						return;
					}
					cleanup();
					settled = true;
					void this.fetchHop(target, validators, signal, deadline, visited, redirectCount + 1).then(resolve, reject);
					return;
				}

				const etag = headerValue(response.headers.etag, 512);
				const lastModified = headerValue(response.headers['last-modified'], 128);
				if (status === 304) {
					response.resume();
					succeed({status: 'not_modified', finalUrl: url.href, etag, lastModified, networkScope});
					return;
				}
				if (status < 200 || status >= 300) {
					response.destroy();
					fail(new FeedFetchError('FEED_HTTP_ERROR', status >= 500 || status === 408 || status === 429));
					return;
				}

				const encoding = headerValue(response.headers['content-encoding'], 64)?.toLowerCase();
				if (encoding && encoding !== 'identity') {
					response.destroy();
					fail(new FeedFetchError('FEED_CONTENT_ENCODING_INVALID', false));
					return;
				}
				const contentType = headerValue(response.headers['content-type'], 256)?.split(';', 1)[0]?.trim().toLowerCase();
				if (!contentType || !allowedContentTypes.has(contentType)) {
					response.destroy();
					fail(new FeedFetchError('FEED_CONTENT_TYPE_INVALID', false));
					return;
				}
				const contentLength = headerValue(response.headers['content-length'], 64);
				if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > this.limits.maxBytes)) {
					response.destroy();
					fail(new FeedFetchError('FEED_TOO_LARGE', false));
					return;
				}

				const chunks: Buffer[] = [];
				let byteLength = 0;
				response.setTimeout(this.limits.idleTimeoutMs, () => {
					response.destroy();
					fail(new FeedFetchError('FEED_TIMEOUT', true));
				});
				response.on('data', (chunk: Buffer) => {
					byteLength += chunk.byteLength;
					if (byteLength > this.limits.maxBytes) {
						response.destroy();
						fail(new FeedFetchError('FEED_TOO_LARGE', false));
						return;
					}
					chunks.push(chunk);
				});
				response.once('end', () => succeed({
					status: 'ok',
					body: Buffer.concat(chunks, byteLength).toString('utf8'),
					finalUrl: url.href,
					etag,
					lastModified,
					networkScope,
				}));
				response.once('error', () => fail(new FeedFetchError('FEED_CONNECTION_FAILED', true)));
			});

			request.setTimeout(this.limits.idleTimeoutMs, () => {
				request.destroy();
				fail(new FeedFetchError('FEED_TIMEOUT', true));
			});
			request.once('error', () => fail(new FeedFetchError('FEED_CONNECTION_FAILED', true)));
			signal?.addEventListener('abort', abort, {once: true});
			request.end();
		});
	}
}
