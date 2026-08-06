import type Database from 'better-sqlite3';
import {randomUUID} from 'node:crypto';
import type {FeedNetworkScope, Source, SourceItem} from '../../src/types';
import {db} from '../database/index';
import {hasEmbeddedUrlCredential, parseFeedUrl} from './safeFeedFetcher';

type SourceMetadataKeys =
	| 'lastSyncedAt'
	| 'lastSyncStatus'
	| 'lastSyncError'
	| 'lastSyncErrorCode'
	| 'consecutiveSyncFailures'
	| 'nextSyncAfter'
	| 'lastCheckedAt'
	| 'lastChangedAt'
	| 'feedEtag'
	| 'feedLastModified'
	| 'feedValidatorUrl'
	| 'feedNetworkScope'
	| 'itemCount';

export interface CreateSourceInput {
	type: 'rss';
	name: string;
	url: string;
	description?: string;
	category?: string;
	isActive: boolean;
}

export type UpdateSourceInput = Partial<Pick<Source, 'name' | 'url' | 'isActive' | SourceMetadataKeys | 'status'>> & {
	description?: string | null;
	category?: string | null;
};

export interface SourceItemQueryOptions {
	sourceId?: string;
	sourceIds?: string[];
	limit?: number;
	offset?: number;
	q?: string;
	from?: string;
	to?: string;
}

export interface SourceItemInput {
	externalId?: string;
	title: string;
	content: string;
	url?: string;
	author?: string;
	publishedAt?: string;
	gatheredAt: string;
	feedSourceUrl: string;
	networkScope: FeedNetworkScope;
}

export interface SourceItemUpsertResult {
	items: SourceItem[];
	insertedCount: number;
	updatedCount: number;
}

export type SyncLeaseResult = 'acquired' | 'busy' | 'missing';

export interface SyncCompletionInput {
	expectedUrl: string;
	checkedAt: string;
	completedAt: string;
	changed: boolean;
	etag?: string;
	lastModified?: string;
	validatorUrl: string;
	networkScope: Exclude<FeedNetworkScope, 'unknown'>;
}

class SyncFenceLostError extends Error {}

type SourceRow = {
	id: string;
	type: Source['type'];
	name: string;
	url: string | null;
	description: string | null;
	category: string | null;
	is_active: number;
	status: Source['status'] | null;
	added_at: string;
	last_synced_at: string | null;
	last_sync_status: Source['lastSyncStatus'] | null;
	last_sync_error: string | null;
	last_sync_error_code: string | null;
	consecutive_sync_failures: number | null;
	next_sync_after: string | null;
	last_checked_at: string | null;
	last_changed_at: string | null;
	feed_etag: string | null;
	feed_last_modified: string | null;
	feed_validator_url: string | null;
	feed_network_scope: FeedNetworkScope | null;
	sync_lease_expires_at: string | null;
	item_count: number | null;
};

type SourceItemRow = {
	id: string;
	source_id: string;
	external_id: string | null;
	title: string;
	content: string;
	url: string | null;
	author: string | null;
	published_at: string | null;
	gathered_at: string;
	feed_source_url: string | null;
	network_scope: FeedNetworkScope | null;
};

const cloneSource = (source: Source): Source => ({...source});
const sourceSelectSql = `
	SELECT s.*,
		(SELECT COUNT(*) FROM source_items si WHERE si.source_id = s.id) AS item_count
	FROM sources s
`;

const safeStoredFeedUrl = (value: string | null): string | undefined => {
	if (!value) return undefined;
	try {
		return parseFeedUrl(value).href;
	} catch {
		return undefined;
	}
};

const sourceFromRow = (row: SourceRow, now: string): Source => {
	const safeUrl = safeStoredFeedUrl(row.url);
	const invalidUrl = Boolean(row.url && !safeUrl);
	const leaseExpired = row.status === 'syncing' && (!row.sync_lease_expires_at || row.sync_lease_expires_at <= now);
	return {
		id: row.id,
		type: row.type,
		name: row.name,
		url: safeUrl,
		description: row.description || undefined,
		category: row.category || undefined,
		isActive: row.is_active === 1,
		status: invalidUrl ? 'error' : leaseExpired ? row.last_sync_status === 'error' ? 'error' : 'healthy' : row.status || undefined,
		addedAt: row.added_at,
		lastSyncedAt: row.last_synced_at || undefined,
		lastSyncStatus: row.last_sync_status || undefined,
		lastSyncError: invalidUrl ? 'The stored feed URL must be replaced before synchronization' : row.last_sync_error || undefined,
		lastSyncErrorCode: invalidUrl ? 'INVALID_FEED_URL' : row.last_sync_error_code || undefined,
		consecutiveSyncFailures: row.consecutive_sync_failures ?? 0,
		nextSyncAfter: row.next_sync_after || undefined,
		lastCheckedAt: row.last_checked_at || undefined,
		lastChangedAt: row.last_changed_at || undefined,
		feedEtag: row.feed_etag || undefined,
		feedLastModified: row.feed_last_modified || undefined,
		feedValidatorUrl: row.feed_validator_url || undefined,
		feedNetworkScope: row.feed_network_scope || 'unknown',
		feedUrlInvalid: invalidUrl,
		itemCount: row.item_count ?? 0,
	};
};

const safeStoredItemUrl = (value: string | null): string | undefined => {
	if (!value) return undefined;
	try {
		const url = new URL(value);
		return (url.protocol === 'http:' || url.protocol === 'https:') && !hasEmbeddedUrlCredential(url) ? url.href : undefined;
	} catch {
		return undefined;
	}
};

const sourceItemFromRow = (row: SourceItemRow): SourceItem => ({
	id: row.id,
	sourceId: row.source_id,
	title: row.title,
	content: row.content,
	url: safeStoredItemUrl(row.url),
	author: row.author || undefined,
	publishedAt: row.published_at || undefined,
	gatheredAt: row.gathered_at,
	networkScope: row.network_scope || 'unknown',
});

const clampLimit = (value: number | undefined): number => Math.min(Math.max(value || 50, 1), 200);
const clampOffset = (value: number | undefined): number => Math.max(value || 0, 0);

export class SourceStore {
	constructor(
		private readonly database: Database.Database = db,
		private readonly now: () => string = () => new Date().toISOString(),
		private readonly createId: () => string = randomUUID,
	) {}

	listSources(): Source[] {
		const rows = this.database.prepare(`${sourceSelectSql} ORDER BY datetime(s.added_at) DESC`).all() as SourceRow[];
		const timestamp = this.now();
		return rows.map(row => cloneSource(sourceFromRow(row, timestamp)));
	}

	addSource(input: CreateSourceInput): Source {
		const id = `src-${this.createId()}`;
		const addedAt = this.now();
		const url = parseFeedUrl(input.url).href;
		this.database.prepare(`
			INSERT INTO sources (id, type, name, url, description, category, is_active, status, added_at, feed_network_scope)
			VALUES (?, 'rss', ?, ?, ?, ?, ?, 'healthy', ?, 'unknown')
		`).run(id, input.name, url, input.description ?? null, input.category ?? null, input.isActive ? 1 : 0, addedAt);
		return this.getSource(id)!;
	}

	updateSource(id: string, input: UpdateSourceInput): Source | undefined {
		const current = this.getSource(id);
		if (!current) return undefined;

		const normalizedInput = {
			...input,
			...(input.url === undefined ? {} : {url: parseFeedUrl(input.url).href}),
			...(input.description === null ? {description: undefined} : {}),
			...(input.category === null ? {category: undefined} : {}),
		};
		const urlChanged = normalizedInput.url !== undefined && normalizedInput.url !== current.url;
		const source: Source = {
			...current,
			...normalizedInput,
			...(urlChanged ? {
				feedEtag: undefined,
				feedLastModified: undefined,
				feedValidatorUrl: undefined,
				feedNetworkScope: 'unknown' as const,
				lastCheckedAt: undefined,
				lastChangedAt: undefined,
				lastSyncedAt: undefined,
				lastSyncStatus: undefined,
				lastSyncError: undefined,
				lastSyncErrorCode: undefined,
				consecutiveSyncFailures: 0,
				nextSyncAfter: undefined,
				status: 'healthy' as const,
			} : {}),
		};

		const persist = this.database.transaction(() => {
			if (urlChanged) this.database.prepare('DELETE FROM source_items WHERE source_id = ?').run(id);
			this.database.prepare(`
				UPDATE sources
				SET name = @name,
					url = @url,
					description = @description,
					category = @category,
					is_active = @isActive,
					status = @status,
					last_synced_at = @lastSyncedAt,
					last_sync_status = @lastSyncStatus,
					last_sync_error = @lastSyncError,
					last_sync_error_code = @lastSyncErrorCode,
					consecutive_sync_failures = @consecutiveSyncFailures,
					next_sync_after = @nextSyncAfter,
					last_checked_at = @lastCheckedAt,
					last_changed_at = @lastChangedAt,
					feed_etag = @feedEtag,
					feed_last_modified = @feedLastModified,
					feed_validator_url = @feedValidatorUrl,
					feed_network_scope = @feedNetworkScope,
					sync_lease_owner = CASE WHEN @urlChanged = 1 THEN NULL ELSE sync_lease_owner END,
					sync_lease_expires_at = CASE WHEN @urlChanged = 1 THEN NULL ELSE sync_lease_expires_at END
				WHERE id = @id
			`).run({
				id,
				name: source.name,
				url: source.url ?? null,
				description: source.description ?? null,
				category: source.category ?? null,
				isActive: source.isActive ? 1 : 0,
				status: source.status ?? null,
				lastSyncedAt: source.lastSyncedAt ?? null,
				lastSyncStatus: source.lastSyncStatus ?? null,
				lastSyncError: source.lastSyncError ?? null,
				lastSyncErrorCode: source.lastSyncErrorCode ?? null,
				consecutiveSyncFailures: source.consecutiveSyncFailures ?? 0,
				nextSyncAfter: source.nextSyncAfter ?? null,
				lastCheckedAt: source.lastCheckedAt ?? null,
				lastChangedAt: source.lastChangedAt ?? null,
				feedEtag: source.feedEtag ?? null,
				feedLastModified: source.feedLastModified ?? null,
				feedValidatorUrl: source.feedValidatorUrl ?? null,
				feedNetworkScope: source.feedNetworkScope ?? 'unknown',
				urlChanged: urlChanged ? 1 : 0,
			});
		});
		persist.immediate();
		return this.getSource(id);
	}

	deleteSource(id: string): boolean {
		const remove = this.database.transaction(() => {
			const timestamp = this.now();
			this.database.prepare(`
				UPDATE stations
				SET revision = revision + 1, updated_at = ?
				WHERE EXISTS (
					SELECT 1 FROM station_sources ss
					WHERE ss.station_id = stations.id AND ss.source_id = ?
				)
			`).run(timestamp, id);
			return this.database.prepare('DELETE FROM sources WHERE id = ?').run(id).changes > 0;
		});
		return remove.immediate();
	}

	getSourcesByIds(sourceIds: string[]): Source[] {
		if (sourceIds.length === 0) return [];
		const placeholders = sourceIds.map(() => '?').join(', ');
		const rows = this.database.prepare(`${sourceSelectSql} WHERE s.id IN (${placeholders})`).all(...sourceIds) as SourceRow[];
		const timestamp = this.now();
		const byId = new Map(rows.map(row => [row.id, sourceFromRow(row, timestamp)]));
		return sourceIds.flatMap(id => byId.has(id) ? [cloneSource(byId.get(id)!)] : []);
	}

	getActiveSources(): Source[] {
		const rows = this.database.prepare(`${sourceSelectSql} WHERE s.is_active = 1 ORDER BY datetime(s.added_at) DESC`).all() as SourceRow[];
		const timestamp = this.now();
		return rows.map(row => cloneSource(sourceFromRow(row, timestamp)));
	}

	listSourceItems(options: SourceItemQueryOptions = {}): SourceItem[] {
		const conditions: string[] = [];
		const params: unknown[] = [];
		if (options.sourceId) {
			conditions.push('source_id = ?');
			params.push(options.sourceId);
		} else if (options.sourceIds?.length) {
			conditions.push(`source_id IN (${options.sourceIds.map(() => '?').join(', ')})`);
			params.push(...options.sourceIds);
		}
		if (options.q?.trim()) {
			conditions.push('(title LIKE ? OR content LIKE ? OR url LIKE ?)');
			const query = `%${options.q.trim()}%`;
			params.push(query, query, query);
		}
		if (options.from) {
			conditions.push('datetime(COALESCE(published_at, gathered_at)) >= datetime(?)');
			params.push(options.from);
		}
		if (options.to) {
			conditions.push('datetime(COALESCE(published_at, gathered_at)) <= datetime(?)');
			params.push(options.to);
		}

		params.push(clampLimit(options.limit), clampOffset(options.offset));
		const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
		const rows = this.database.prepare(`
			SELECT * FROM source_items
			${where}
			ORDER BY datetime(COALESCE(published_at, gathered_at)) DESC, datetime(gathered_at) DESC, id
			LIMIT ? OFFSET ?
		`).all(...params) as SourceItemRow[];
		return rows.map(sourceItemFromRow);
	}

	upsertRssSourceItems(sourceId: string, items: SourceItemInput[]): SourceItemUpsertResult {
		const persist = this.database.transaction(() => this.upsertRssSourceItemsWithinTransaction(sourceId, items));
		return persist.immediate();
	}

	private upsertRssSourceItemsWithinTransaction(sourceId: string, items: SourceItemInput[]): SourceItemUpsertResult {
		const selectExisting = this.database.prepare('SELECT * FROM source_items WHERE source_id = ? AND external_id = ?');
		const insert = this.database.prepare(`
			INSERT INTO source_items (id, source_id, external_id, title, content, url, author, published_at, gathered_at, feed_source_url, network_scope)
			VALUES (@id, @sourceId, @externalId, @title, @content, @url, @author, @publishedAt, @gatheredAt, @feedSourceUrl, @networkScope)
		`);
		const update = this.database.prepare(`
			UPDATE source_items
			SET title = @title, content = @content, url = @url, author = @author,
				published_at = @publishedAt, gathered_at = @gatheredAt, feed_source_url = @feedSourceUrl,
				network_scope = @networkScope
			WHERE id = @id
		`);
		const result: SourceItemUpsertResult = {items: [], insertedCount: 0, updatedCount: 0};
		for (const item of items) {
			if (!item.externalId) continue;
			const existing = selectExisting.get(sourceId, item.externalId) as SourceItemRow | undefined;
			const values = {
				title: item.title,
				content: item.content,
				url: item.url ?? null,
				author: item.author ?? null,
				publishedAt: item.publishedAt ?? null,
				gatheredAt: item.gatheredAt,
				feedSourceUrl: item.feedSourceUrl,
				networkScope: item.networkScope,
			};
			if (existing) {
				update.run({id: existing.id, ...values});
				result.updatedCount += 1;
				result.items.push(sourceItemFromRow({...existing, title: item.title, content: item.content, url: values.url, author: values.author, published_at: values.publishedAt, gathered_at: item.gatheredAt, feed_source_url: item.feedSourceUrl, network_scope: item.networkScope}));
				continue;
			}

			const id = `item-${this.createId()}`;
			insert.run({id, sourceId, externalId: item.externalId, ...values});
			result.insertedCount += 1;
			result.items.push(sourceItemFromRow({id, source_id: sourceId, external_id: item.externalId, title: item.title, content: item.content, url: values.url, author: values.author, published_at: values.publishedAt, gathered_at: item.gatheredAt, feed_source_url: item.feedSourceUrl, network_scope: item.networkScope}));
		}
		return result;
	}

	commitFetchedSync(sourceId: string, owner: string, items: SourceItemInput[], input: SyncCompletionInput): {source: Source; result: SourceItemUpsertResult} | undefined {
		const commit = this.database.transaction(() => {
			const fence = this.database.prepare(`
				SELECT id FROM sources
				WHERE id = ? AND url = ? AND sync_lease_owner = ? AND sync_lease_expires_at > ?
			`).get(sourceId, input.expectedUrl, owner, input.completedAt);
			if (!fence) throw new SyncFenceLostError();
			const result = this.upsertRssSourceItemsWithinTransaction(sourceId, items);
			const source = this.completeSync(sourceId, owner, input);
			if (!source) throw new SyncFenceLostError();
			return {source, result};
		});
		try {
			return commit.immediate();
		} catch (error) {
			if (error instanceof SyncFenceLostError) return undefined;
			throw error;
		}
	}

	acquireSyncLease(sourceId: string, owner: string, expiresAt: string, now: string): SyncLeaseResult {
		const result = this.database.prepare(`
			UPDATE sources
			SET sync_lease_owner = ?, sync_lease_expires_at = ?, status = 'syncing'
			WHERE id = ? AND (
				sync_lease_owner IS NULL OR sync_lease_expires_at IS NULL OR sync_lease_expires_at <= ?
			)
		`).run(owner, expiresAt, sourceId, now);
		if (result.changes === 1) return 'acquired';
		return this.getSource(sourceId) ? 'busy' : 'missing';
	}

	completeSync(sourceId: string, owner: string, input: SyncCompletionInput): Source | undefined {
		const result = this.database.prepare(`
			UPDATE sources
			SET status = 'healthy', last_synced_at = ?, last_sync_status = 'success',
				last_sync_error = NULL, last_sync_error_code = NULL,
				consecutive_sync_failures = 0, next_sync_after = NULL,
				last_checked_at = ?, last_changed_at = CASE WHEN ? = 1 THEN ? ELSE last_changed_at END,
				feed_etag = ?, feed_last_modified = ?, feed_validator_url = ?, feed_network_scope = ?,
				sync_lease_owner = NULL, sync_lease_expires_at = NULL
			WHERE id = ? AND url = ? AND sync_lease_owner = ? AND sync_lease_expires_at > ?
		`).run(input.checkedAt, input.checkedAt, input.changed ? 1 : 0, input.checkedAt, input.etag ?? null, input.lastModified ?? null, input.validatorUrl, input.networkScope, sourceId, input.expectedUrl, owner, input.completedAt);
		return result.changes === 1 ? this.getSource(sourceId) : undefined;
	}

	recordSyncFailure(sourceId: string, owner: string, input: {expectedUrl: string; checkedAt: string; completedAt: string; code: string; message: string; nextSyncAfter: string}): Source | undefined {
		const result = this.database.prepare(`
			UPDATE sources
			SET status = 'error', last_sync_status = 'error', last_sync_error = ?, last_sync_error_code = ?,
				consecutive_sync_failures = consecutive_sync_failures + 1, next_sync_after = ?, last_checked_at = ?,
				sync_lease_owner = NULL, sync_lease_expires_at = NULL
			WHERE id = ? AND url = ? AND sync_lease_owner = ? AND sync_lease_expires_at > ?
		`).run(input.message, input.code, input.nextSyncAfter, input.checkedAt, sourceId, input.expectedUrl, owner, input.completedAt);
		return result.changes === 1 ? this.getSource(sourceId) : undefined;
	}

	releaseSyncLease(sourceId: string, owner: string): void {
		this.database.prepare(`
			UPDATE sources
			SET sync_lease_owner = NULL, sync_lease_expires_at = NULL,
				status = CASE WHEN last_sync_status = 'error' THEN 'error' ELSE 'healthy' END
			WHERE id = ? AND sync_lease_owner = ?
		`).run(sourceId, owner);
	}

	getSource(id: string): Source | undefined {
		const row = this.database.prepare(`${sourceSelectSql} WHERE s.id = ?`).get(id) as SourceRow | undefined;
		return row ? sourceFromRow(row, this.now()) : undefined;
	}
}

export const sourceStore = new SourceStore();
