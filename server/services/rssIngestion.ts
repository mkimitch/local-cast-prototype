import {createHash} from 'node:crypto';
import Parser from 'rss-parser';
import type {Source, SourceItem} from '../../src/types';
import {sourceStore, type SourceItemInput} from './sourceStore';

interface SyncResult {
	source: Source;
	items: SourceItem[];
	insertedCount: number;
	updatedCount: number;
	skipped?: boolean;
	message?: string;
}

interface SyncAllResult {
	results: SyncResult[];
	errors: Array<{sourceId: string; message: string}>;
	skipped: Array<{sourceId: string; nextSyncAfter: string; message: string}>;
}

interface SyncOptions {
	force?: boolean;
}

type ParsedItem = Parser.Item & {
	author?: string;
	id?: string;
};

const parser = new Parser<Record<string, unknown>, ParsedItem>();
const fetchTimeoutMs = 15000;
const maxItemsPerFeed = 25;
const minuteMs = 60 * 1000;

const decodeBasicEntities = (value: string): string => value
	.replace(/&nbsp;/gi, ' ')
	.replace(/&amp;/gi, '&')
	.replace(/&lt;/gi, '<')
	.replace(/&gt;/gi, '>')
	.replace(/&quot;/gi, '"')
	.replace(/&#39;/gi, "'");

const cleanText = (value: string | undefined): string => {
	if (!value) return '';

	return decodeBasicEntities(value)
		.replace(/<script[\s\S]*?<\/script>/gi, ' ')
		.replace(/<style[\s\S]*?<\/style>/gi, ' ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
};

const normalizeDate = (value: string | undefined): string | undefined => {
	if (!value) return undefined;

	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

const hashIdentity = (value: string): string => createHash('sha256').update(value).digest('hex');

const backoffMsForFailureCount = (failureCount: number): number => {
	if (failureCount <= 1) return 15 * minuteMs;
	if (failureCount === 2) return 60 * minuteMs;
	return 6 * 60 * minuteMs;
};

const futureDateFromNow = (ms: number): string => new Date(Date.now() + ms).toISOString();

const isBackoffActive = (source: Source): boolean => {
	if (!source.nextSyncAfter) return false;

	const nextSyncAfter = new Date(source.nextSyncAfter).getTime();
	return Number.isFinite(nextSyncAfter) && nextSyncAfter > Date.now();
};

const assertFetchableUrl = (value: string): URL => {
	const url = new URL(value);
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error('RSS source URL must use http or https');
	}

	return url;
};

const fetchFeedXml = async (feedUrl: string): Promise<string> => {
	const url = assertFetchableUrl(feedUrl);
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs);

	try {
		const response = await fetch(url, {
			headers: {
				Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5',
				'User-Agent': 'LocalCastPrototype/0.1 (+https://github.com/mkimitch/local-cast-prototype)',
			},
			signal: controller.signal,
		});

		if (!response.ok) {
			throw new Error(`RSS fetch failed with HTTP ${response.status}`);
		}

		return response.text();
	} finally {
		clearTimeout(timeout);
	}
};

const itemToSourceItemInput = (item: ParsedItem, gatheredAt: string): SourceItemInput => {
	const title = cleanText(item.title) || cleanText(item.link) || 'Untitled RSS item';
	const content = cleanText(item.contentSnippet) || cleanText(item.summary) || cleanText(item.content) || title;
	const publishedAt = normalizeDate(item.isoDate || item.pubDate);
	const url = item.link?.trim() || undefined;
	const rawIdentity = item.guid || item.id || url || `${title}|${publishedAt || ''}|${content.slice(0, 500)}`;

	return {
		externalId: hashIdentity(rawIdentity),
		title,
		content,
		url,
		author: cleanText(item.creator || item.author) || undefined,
		publishedAt,
		gatheredAt,
	};
};

class RssIngestionService {
	async syncSource(source: Source, options: SyncOptions = {force: true}): Promise<SyncResult> {
		if (source.type !== 'rss') {
			throw new Error('Only RSS sources can be synced');
		}

		if (options.force !== true && isBackoffActive(source) && source.nextSyncAfter) {
			return {
				source,
				items: sourceStore.listSourceItems({sourceId: source.id, limit: 25}),
				insertedCount: 0,
				updatedCount: 0,
				skipped: true,
				message: `Next sync is available after ${source.nextSyncAfter}`,
			};
		}

		if (!source.url) {
			this.recordFailure(source, 'RSS source is missing a URL');
			throw new Error('RSS source is missing a URL');
		}

		sourceStore.updateSource(source.id, {status: 'syncing'});

		try {
			const xml = await fetchFeedXml(source.url);
			const feed = await parser.parseString(xml);
			const gatheredAt = new Date().toISOString();
			const items = feed.items.slice(0, maxItemsPerFeed).map(item => itemToSourceItemInput(item, gatheredAt));
			const result = sourceStore.upsertRssSourceItems(source.id, items);
			const updatedSource = sourceStore.updateSource(source.id, {
				status: 'healthy',
				lastSyncedAt: gatheredAt,
				lastSyncStatus: 'success',
				lastSyncError: undefined,
				consecutiveSyncFailures: 0,
				nextSyncAfter: undefined,
			}) || source;

			return {
				source: updatedSource,
				items: result.items,
				insertedCount: result.insertedCount,
				updatedCount: result.updatedCount,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown RSS sync error';
			this.recordFailure(source, message);
			throw new Error(message);
		}
	}

	async syncSourceById(sourceId: string): Promise<SyncResult | undefined> {
		const source = sourceStore.getSource(sourceId);
		if (!source) return undefined;

		return this.syncSource(source);
	}

	async syncActiveSources(options: SyncOptions = {force: false}): Promise<SyncAllResult> {
		const rssSources = sourceStore.getActiveSources().filter(source => source.type === 'rss');
		const results: SyncResult[] = [];
		const errors: Array<{sourceId: string; message: string}> = [];
		const skipped: Array<{sourceId: string; nextSyncAfter: string; message: string}> = [];

		for (const source of rssSources) {
			try {
				const result = await this.syncSource(source, {force: options.force === true});
				if (result.skipped && source.nextSyncAfter) {
					skipped.push({
						sourceId: source.id,
						nextSyncAfter: source.nextSyncAfter,
						message: result.message || `Next sync is available after ${source.nextSyncAfter}`,
					});
					continue;
				}

				results.push(result);
			} catch (error) {
				errors.push({
					sourceId: source.id,
					message: error instanceof Error ? error.message : 'Unknown RSS sync error',
				});
			}
		}

		return {results, errors, skipped};
	}

	private recordFailure(source: Source, message: string): Source {
		const consecutiveSyncFailures = (source.consecutiveSyncFailures || 0) + 1;
		return sourceStore.updateSource(source.id, {
			status: 'error',
			lastSyncStatus: 'error',
			lastSyncError: message,
			consecutiveSyncFailures,
			nextSyncAfter: futureDateFromNow(backoffMsForFailureCount(consecutiveSyncFailures)),
		}) || source;
	}
}

export const rssIngestionService = new RssIngestionService();
