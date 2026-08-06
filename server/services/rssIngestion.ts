import {createHash, randomUUID} from 'node:crypto';
import Parser from 'rss-parser';
import type {Source, SourceItem} from '../../src/types';
import {serverConfig} from '../config';
import {FeedFetchError, SafeFeedFetcher, hasEmbeddedUrlCredential, parseFeedUrl} from './safeFeedFetcher';
import {sourceStore, type SourceItemInput, type SourceStore} from './sourceStore';

export type FeedSyncErrorCode =
	| FeedFetchError['code']
	| 'SOURCE_NOT_FOUND'
	| 'SOURCE_CHANGED'
	| 'SOURCE_SYNC_IN_PROGRESS'
	| 'SOURCE_SYNC_LEASE_LOST'
	| 'FEED_MALFORMED';

const syncMessages: Record<Exclude<FeedSyncErrorCode, FeedFetchError['code']>, string> = {
	SOURCE_NOT_FOUND: 'The selected RSS source no longer exists',
	SOURCE_CHANGED: 'The selected RSS source changed after generation was requested',
	SOURCE_SYNC_IN_PROGRESS: 'This source is already being synchronized',
	SOURCE_SYNC_LEASE_LOST: 'The source synchronization lease was lost',
	FEED_MALFORMED: 'The response could not be parsed as a safe RSS or Atom feed',
};

export class FeedSyncError extends Error {
	constructor(
		readonly code: FeedSyncErrorCode,
		readonly safeMessage: string,
		readonly retryable: boolean,
	) {
		super(safeMessage);
		this.name = 'FeedSyncError';
	}
}

export interface SyncResult {
	source: Source;
	items: SourceItem[];
	insertedCount: number;
	updatedCount: number;
	notModified?: boolean;
	skipped?: boolean;
	code?: FeedSyncErrorCode;
	message?: string;
}

export interface SyncAllResult {
	results: SyncResult[];
	errors: Array<{sourceId: string; code: FeedSyncErrorCode; message: string}>;
	skipped: Array<{sourceId: string; nextSyncAfter?: string; code?: FeedSyncErrorCode; message: string}>;
}

export interface SyncOptions {
	force?: boolean;
	signal?: AbortSignal;
	expectedUrl?: string;
}

type ParsedItem = Parser.Item & {author?: string; id?: string};

export const feedParsingLimits = {
	maxItems: 25,
	maxTitleCharacters: 500,
	maxBodyCharacters: 50_000,
	maxAuthorCharacters: 500,
	maxItemUrlCharacters: 2_048,
} as const;

const minuteMs = 60 * 1000;
const syncLeaseMs = 30_000;
const parser = new Parser<Record<string, unknown>, ParsedItem>();

const decodeBasicEntities = (value: string): string => value
	.replace(/&nbsp;/gi, ' ')
	.replace(/&amp;/gi, '&')
	.replace(/&lt;/gi, '<')
	.replace(/&gt;/gi, '>')
	.replace(/&quot;/gi, '"')
	.replace(/&#39;/gi, "'");

const cleanText = (value: string | undefined, maxCharacters: number): string => {
	if (!value) return '';
	return decodeBasicEntities(value)
		.replace(/<script[\s\S]*?<\/script>/gi, ' ')
		.replace(/<style[\s\S]*?<\/style>/gi, ' ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, maxCharacters);
};

const normalizeDate = (value: string | undefined): string | undefined => {
	if (!value) return undefined;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

const safeItemUrl = (value: string | undefined, baseUrl: string): string | undefined => {
	if (!value || value.length > feedParsingLimits.maxItemUrlCharacters || /[\u0000-\u001f\u007f]/.test(value)) return undefined;
	try {
		const url = new URL(value, baseUrl);
		if ((url.protocol !== 'http:' && url.protocol !== 'https:') || hasEmbeddedUrlCredential(url)) return undefined;
		return url.href.length <= feedParsingLimits.maxItemUrlCharacters ? url.href : undefined;
	} catch {
		return undefined;
	}
};

const hashIdentity = (value: string): string => createHash('sha256').update(value).digest('hex');

const backoffMsForFailureCount = (failureCount: number): number => {
	if (failureCount <= 1) return 15 * minuteMs;
	if (failureCount === 2) return 60 * minuteMs;
	return 6 * 60 * minuteMs;
};

const isBackoffActive = (source: Source, now: number): boolean => {
	if (!source.nextSyncAfter) return false;
	const nextSyncAfter = new Date(source.nextSyncAfter).getTime();
	return Number.isFinite(nextSyncAfter) && nextSyncAfter > now;
};

const itemToSourceItemInput = (
	item: ParsedItem,
	gatheredAt: string,
	feedSourceUrl: string,
	finalUrl: string,
	networkScope: SourceItemInput['networkScope'],
): SourceItemInput => {
	const itemUrl = safeItemUrl(item.link?.trim(), finalUrl);
	const title = cleanText(item.title, feedParsingLimits.maxTitleCharacters)
		|| cleanText(itemUrl, feedParsingLimits.maxTitleCharacters)
		|| 'Untitled RSS item';
	const content = cleanText(item.contentSnippet, feedParsingLimits.maxBodyCharacters)
		|| cleanText(item.summary, feedParsingLimits.maxBodyCharacters)
		|| cleanText(item.content, feedParsingLimits.maxBodyCharacters)
		|| title;
	const publishedAt = normalizeDate(item.isoDate || item.pubDate);
	const rawIdentity = item.guid || item.id || itemUrl || `${title}|${publishedAt || ''}|${content.slice(0, 500)}`;
	return {
		externalId: hashIdentity(rawIdentity),
		title,
		content,
		url: itemUrl,
		author: cleanText(item.creator || item.author, feedParsingLimits.maxAuthorCharacters) || undefined,
		publishedAt,
		gatheredAt,
		feedSourceUrl,
		networkScope,
	};
};

const toSyncError = (error: unknown): FeedSyncError => {
	if (error instanceof FeedSyncError) return error;
	if (error instanceof FeedFetchError) return new FeedSyncError(error.code, error.safeMessage, error.retryable);
	return new FeedSyncError('FEED_MALFORMED', syncMessages.FEED_MALFORMED, false);
};

export class RssIngestionService {
	constructor(
		private readonly store: SourceStore = sourceStore,
		private readonly fetcher: SafeFeedFetcher = new SafeFeedFetcher(serverConfig.rssPrivateHosts),
		private readonly now: () => Date = () => new Date(),
		private readonly createLeaseOwner: () => string = randomUUID,
	) {}

	async syncSource(sourceInput: Source, options: SyncOptions = {force: true}): Promise<SyncResult> {
		const source = this.store.getSource(sourceInput.id);
		if (!source || source.type !== 'rss') {
			throw new FeedSyncError('SOURCE_NOT_FOUND', syncMessages.SOURCE_NOT_FOUND, false);
		}
		if (source.feedUrlInvalid) throw new FeedSyncError('INVALID_FEED_URL', 'The feed URL is not a valid credential-free HTTP(S) URL', false);
		if (!source.url) throw new FeedSyncError('SOURCE_NOT_FOUND', syncMessages.SOURCE_NOT_FOUND, false);

		const nowMs = this.now().getTime();
		let canonicalUrl: string;
		try {
			canonicalUrl = parseFeedUrl(source.url).href;
		} catch (error) {
			const failure = toSyncError(error);
			const failureCount = (source.consecutiveSyncFailures || 0) + 1;
			this.store.updateSource(source.id, {
				status: 'error',
				lastSyncStatus: 'error',
				lastSyncError: failure.safeMessage,
				lastSyncErrorCode: failure.code,
				lastCheckedAt: new Date(nowMs).toISOString(),
				consecutiveSyncFailures: failureCount,
				nextSyncAfter: new Date(nowMs + backoffMsForFailureCount(failureCount)).toISOString(),
			});
			throw failure;
		}
		if (options.expectedUrl && canonicalUrl !== parseFeedUrl(options.expectedUrl).href) {
			throw new FeedSyncError('SOURCE_CHANGED', syncMessages.SOURCE_CHANGED, false);
		}
		if (options.force !== true && isBackoffActive(source, nowMs) && source.nextSyncAfter) {
			return {
				source,
				items: this.store.listSourceItems({sourceId: source.id, limit: feedParsingLimits.maxItems}),
				insertedCount: 0,
				updatedCount: 0,
				skipped: true,
				message: `Next sync is available after ${source.nextSyncAfter}`,
			};
		}

		const owner = `rss-${this.createLeaseOwner()}`;
		const checkedAt = new Date(nowMs).toISOString();
		const lease = this.store.acquireSyncLease(source.id, owner, new Date(nowMs + syncLeaseMs).toISOString(), checkedAt);
		if (lease === 'missing') throw new FeedSyncError('SOURCE_NOT_FOUND', syncMessages.SOURCE_NOT_FOUND, false);
		if (lease === 'busy') throw new FeedSyncError('SOURCE_SYNC_IN_PROGRESS', syncMessages.SOURCE_SYNC_IN_PROGRESS, true);

		try {
			const fetched = await this.fetcher.fetch(canonicalUrl, {
				etag: source.feedEtag,
				lastModified: source.feedLastModified,
				validatorUrl: source.feedValidatorUrl,
			}, options.signal);
			if (fetched.status === 'not_modified') {
				const completedAt = this.now().toISOString();
				const updatedSource = this.store.completeSync(source.id, owner, {
					expectedUrl: canonicalUrl,
					checkedAt,
					completedAt,
					changed: false,
					etag: fetched.etag ?? source.feedEtag,
					lastModified: fetched.lastModified ?? source.feedLastModified,
					validatorUrl: fetched.finalUrl,
					networkScope: fetched.networkScope,
				});
				if (!updatedSource) throw new FeedSyncError('SOURCE_SYNC_LEASE_LOST', syncMessages.SOURCE_SYNC_LEASE_LOST, true);
				return {
					source: updatedSource,
					items: this.store.listSourceItems({sourceId: source.id, limit: feedParsingLimits.maxItems}),
					insertedCount: 0,
					updatedCount: 0,
					notModified: true,
					message: 'Feed is unchanged',
				};
			}

			if (/<!DOCTYPE|<!ENTITY/i.test(fetched.body)) {
				throw new FeedSyncError('FEED_MALFORMED', syncMessages.FEED_MALFORMED, false);
			}
			let parsed;
			try {
				parsed = await parser.parseString(fetched.body);
			} catch {
				throw new FeedSyncError('FEED_MALFORMED', syncMessages.FEED_MALFORMED, false);
			}
			if (!Array.isArray(parsed.items)) throw new FeedSyncError('FEED_MALFORMED', syncMessages.FEED_MALFORMED, false);
			const itemsByIdentity = new Map<string, SourceItemInput>();
			for (const item of parsed.items.slice(0, feedParsingLimits.maxItems)) {
				const normalized = itemToSourceItemInput(item, checkedAt, canonicalUrl, fetched.finalUrl, fetched.networkScope);
				if (normalized.externalId) itemsByIdentity.set(normalized.externalId, normalized);
			}
			const committed = this.store.commitFetchedSync(source.id, owner, [...itemsByIdentity.values()], {
				expectedUrl: canonicalUrl,
				checkedAt,
				completedAt: this.now().toISOString(),
				changed: true,
				etag: fetched.etag,
				lastModified: fetched.lastModified,
				validatorUrl: fetched.finalUrl,
				networkScope: fetched.networkScope,
			});
			if (!committed) throw new FeedSyncError('SOURCE_SYNC_LEASE_LOST', syncMessages.SOURCE_SYNC_LEASE_LOST, true);
			return {source: committed.source, items: committed.result.items, insertedCount: committed.result.insertedCount, updatedCount: committed.result.updatedCount};
		} catch (error) {
			if (options.signal?.aborted || error instanceof DOMException && error.name === 'AbortError') {
				this.store.releaseSyncLease(source.id, owner);
				throw error;
			}
			const failure = toSyncError(error);
			const current = this.store.getSource(source.id);
			const failureCount = (current?.consecutiveSyncFailures || 0) + 1;
			this.store.recordSyncFailure(source.id, owner, {
				expectedUrl: canonicalUrl,
				checkedAt,
				completedAt: this.now().toISOString(),
				code: failure.code,
				message: failure.safeMessage,
				nextSyncAfter: new Date(nowMs + backoffMsForFailureCount(failureCount)).toISOString(),
			});
			throw failure;
		}
	}

	async syncSourceById(sourceId: string, options: SyncOptions = {force: true}): Promise<SyncResult | undefined> {
		const source = this.store.getSource(sourceId);
		return source ? this.syncSource(source, options) : undefined;
	}

	async syncActiveSources(options: SyncOptions = {force: false}): Promise<SyncAllResult> {
		const rssSources = this.store.getActiveSources().filter(source => source.type === 'rss');
		const results: SyncResult[] = [];
		const errors: SyncAllResult['errors'] = [];
		const skipped: SyncAllResult['skipped'] = [];
		for (const source of rssSources) {
			try {
				const result = await this.syncSource(source, {force: options.force === true, signal: options.signal});
				if (result.skipped) {
					skipped.push({sourceId: source.id, nextSyncAfter: source.nextSyncAfter, code: result.code, message: result.message || 'Source synchronization skipped'});
				} else {
					results.push(result);
				}
			} catch (error) {
				const failure = toSyncError(error);
				if (failure.code === 'SOURCE_SYNC_IN_PROGRESS') {
					skipped.push({sourceId: source.id, code: failure.code, message: failure.safeMessage});
				} else {
					errors.push({sourceId: source.id, code: failure.code, message: failure.safeMessage});
				}
			}
		}
		return {results, errors, skipped};
	}
}

export const rssIngestionService = new RssIngestionService();
