import type {Source, SourceItem} from '../../src/types';
import {db} from '../database/index';

type SourceMetadataKeys = 'lastSyncedAt' | 'lastSyncStatus' | 'lastSyncError' | 'consecutiveSyncFailures' | 'nextSyncAfter' | 'itemCount';

export type CreateSourceInput = Omit<Source, 'id' | 'addedAt' | SourceMetadataKeys>;
export type UpdateSourceInput = Partial<Omit<Source, 'id' | 'addedAt' | 'itemCount'>>;

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
}

export interface SourceItemUpsertResult {
	items: SourceItem[];
	insertedCount: number;
	updatedCount: number;
}

const cloneSource = (source: Source): Source => ({...source});

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
	consecutive_sync_failures: number | null;
	next_sync_after: string | null;
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
};

const initialSources: Source[] = [
	{
		id: 'src-1',
		type: 'rss',
		name: 'TechCrunch',
		url: 'https://techcrunch.com/feed',
		category: 'Tech',
		isActive: true,
		status: 'healthy',
		addedAt: new Date(Date.now() - 86400000 * 5).toISOString(),
	},
	{
		id: 'src-2',
		type: 'manual_topic',
		name: 'AI Agents Research',
		description: 'Latest breakthroughs in autonomous AI systems',
		category: 'Tech',
		isActive: true,
		status: 'syncing',
		addedAt: new Date(Date.now() - 86400000 * 2).toISOString(),
	},
	{
		id: 'src-3',
		type: 'rss',
		name: 'The Verge',
		url: 'https://www.theverge.com/rss/index.xml',
		category: 'News',
		isActive: false,
		status: 'error',
		addedAt: new Date(Date.now() - 86400000 * 10).toISOString(),
	},
];

const createId = (prefix: string): string => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const sourceSelectSql = `
	SELECT s.*,
		(SELECT COUNT(*) FROM source_items si WHERE si.source_id = s.id) AS item_count
	FROM sources s
`;

const sourceFromRow = (row: SourceRow): Source => ({
	id: row.id,
	type: row.type,
	name: row.name,
	url: row.url || undefined,
	description: row.description || undefined,
	category: row.category || undefined,
	isActive: row.is_active === 1,
	status: row.status || undefined,
	addedAt: row.added_at,
	lastSyncedAt: row.last_synced_at || undefined,
	lastSyncStatus: row.last_sync_status || undefined,
	lastSyncError: row.last_sync_error || undefined,
	consecutiveSyncFailures: row.consecutive_sync_failures ?? 0,
	nextSyncAfter: row.next_sync_after || undefined,
	itemCount: row.item_count ?? 0,
});

const sourceItemFromRow = (row: SourceItemRow): SourceItem => ({
	id: row.id,
	sourceId: row.source_id,
	title: row.title,
	content: row.content,
	url: row.url || undefined,
	author: row.author || undefined,
	publishedAt: row.published_at || undefined,
	gatheredAt: row.gathered_at,
});

const clampLimit = (value: number | undefined): number => Math.min(Math.max(value || 50, 1), 200);

const clampOffset = (value: number | undefined): number => Math.max(value || 0, 0);

class SourceStore {
	constructor() {
		this.seedSourcesIfEmpty();
	}

	private seedSourcesIfEmpty(): void {
		const row = db.prepare('SELECT COUNT(*) AS count FROM sources').get() as {count: number};
		if (row.count > 0) return;

		const insert = db.prepare(`
			INSERT INTO sources (id, type, name, url, description, category, is_active, status, added_at)
			VALUES (@id, @type, @name, @url, @description, @category, @isActive, @status, @addedAt)
		`);

		const seed = db.transaction(() => {
			for (const source of initialSources) {
				insert.run({
					id: source.id,
					type: source.type,
					name: source.name,
					url: source.url ?? null,
					description: source.description ?? null,
					category: source.category ?? null,
					isActive: source.isActive ? 1 : 0,
					status: source.status ?? null,
					addedAt: source.addedAt,
				});
			}
		});

		seed();
	}

	listSources(): Source[] {
		const rows = db.prepare(`${sourceSelectSql} ORDER BY datetime(s.added_at) DESC`).all() as SourceRow[];
		return rows.map(row => cloneSource(sourceFromRow(row)));
	}

	addSource(input: CreateSourceInput): Source {
		const source: Source = {
			...input,
			id: createId('src'),
			status: input.status || 'healthy',
			addedAt: new Date().toISOString(),
		};

		db.prepare(`
			INSERT INTO sources (id, type, name, url, description, category, is_active, status, added_at)
			VALUES (@id, @type, @name, @url, @description, @category, @isActive, @status, @addedAt)
		`).run({
			id: source.id,
			type: source.type,
			name: source.name,
			url: source.url ?? null,
			description: source.description ?? null,
			category: source.category ?? null,
			isActive: source.isActive ? 1 : 0,
			status: source.status ?? null,
			addedAt: source.addedAt,
		});

		return cloneSource(source);
	}

	updateSource(id: string, input: UpdateSourceInput): Source | undefined {
		const current = this.getSource(id);
		if (!current) return undefined;

		const source: Source = {...current, ...input};
		db.prepare(`
			UPDATE sources
			SET type = @type,
				name = @name,
				url = @url,
				description = @description,
				category = @category,
				is_active = @isActive,
				status = @status,
				last_synced_at = @lastSyncedAt,
				last_sync_status = @lastSyncStatus,
				last_sync_error = @lastSyncError,
				consecutive_sync_failures = @consecutiveSyncFailures,
				next_sync_after = @nextSyncAfter
			WHERE id = @id
		`).run({
			id: source.id,
			type: source.type,
			name: source.name,
			url: source.url ?? null,
			description: source.description ?? null,
			category: source.category ?? null,
			isActive: source.isActive ? 1 : 0,
			status: source.status ?? null,
			lastSyncedAt: source.lastSyncedAt ?? null,
			lastSyncStatus: source.lastSyncStatus ?? null,
			lastSyncError: source.lastSyncError ?? null,
			consecutiveSyncFailures: source.consecutiveSyncFailures ?? 0,
			nextSyncAfter: source.nextSyncAfter ?? null,
		});

		return this.getSource(id);
	}

	deleteSource(id: string): boolean {
		const result = db.prepare('DELETE FROM sources WHERE id = ?').run(id);
		return result.changes > 0;
	}

	getSourcesByIds(sourceIds: string[]): Source[] {
		if (sourceIds.length === 0) return [];

		const placeholders = sourceIds.map(() => '?').join(', ');
		const rows = db.prepare(`${sourceSelectSql} WHERE s.id IN (${placeholders}) ORDER BY datetime(s.added_at) DESC`).all(...sourceIds) as SourceRow[];
		return rows.map(row => cloneSource(sourceFromRow(row)));
	}

	getActiveSources(): Source[] {
		const rows = db.prepare(`${sourceSelectSql} WHERE s.is_active = 1 ORDER BY datetime(s.added_at) DESC`).all() as SourceRow[];
		return rows.map(row => cloneSource(sourceFromRow(row)));
	}

	listSourceItems(options: SourceItemQueryOptions = {}): SourceItem[] {
		const conditions: string[] = [];
		const params: unknown[] = [];
		const limit = clampLimit(options.limit);
		const offset = clampOffset(options.offset);

		if (options.sourceId) {
			conditions.push('source_id = ?');
			params.push(options.sourceId);
		} else if (options.sourceIds && options.sourceIds.length > 0) {
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

		params.push(limit, offset);
		const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
		const rows = db.prepare(`
			SELECT * FROM source_items
			${whereClause}
			ORDER BY datetime(COALESCE(published_at, gathered_at)) DESC, datetime(gathered_at) DESC
			LIMIT ?
			OFFSET ?
		`).all(...params) as SourceItemRow[];

		return rows.map(sourceItemFromRow);
	}

	upsertRssSourceItems(sourceId: string, items: SourceItemInput[]): SourceItemUpsertResult {
		const selectExisting = db.prepare('SELECT * FROM source_items WHERE source_id = ? AND external_id = ?');
		const insert = db.prepare(`
			INSERT INTO source_items (id, source_id, external_id, title, content, url, author, published_at, gathered_at)
			VALUES (@id, @sourceId, @externalId, @title, @content, @url, @author, @publishedAt, @gatheredAt)
		`);
		const update = db.prepare(`
			UPDATE source_items
			SET title = @title,
				content = @content,
				url = @url,
				author = @author,
				published_at = @publishedAt,
				gathered_at = @gatheredAt
			WHERE id = @id
		`);

		const result: SourceItemUpsertResult = {items: [], insertedCount: 0, updatedCount: 0};
		const persist = db.transaction(() => {
			for (const item of items) {
				if (!item.externalId) continue;

				const existing = selectExisting.get(sourceId, item.externalId) as SourceItemRow | undefined;
				if (existing) {
					update.run({
						id: existing.id,
						title: item.title,
						content: item.content,
						url: item.url ?? null,
						author: item.author ?? null,
						publishedAt: item.publishedAt ?? null,
						gatheredAt: item.gatheredAt,
					});
					result.updatedCount += 1;
					result.items.push(sourceItemFromRow({
						...existing,
						title: item.title,
						content: item.content,
						url: item.url ?? null,
						author: item.author ?? null,
						published_at: item.publishedAt ?? null,
						gathered_at: item.gatheredAt,
					}));
					continue;
				}

				const id = createId('item');
				insert.run({
					id,
					sourceId,
					externalId: item.externalId,
					title: item.title,
					content: item.content,
					url: item.url ?? null,
					author: item.author ?? null,
					publishedAt: item.publishedAt ?? null,
					gatheredAt: item.gatheredAt,
				});

				result.insertedCount += 1;
				result.items.push(sourceItemFromRow({
					id,
					source_id: sourceId,
					external_id: item.externalId,
					title: item.title,
					content: item.content,
					url: item.url ?? null,
					author: item.author ?? null,
					published_at: item.publishedAt ?? null,
					gathered_at: item.gatheredAt,
				}));
			}
		});

		persist();
		return result;
	}

	createManualSourceItem(source: Source): SourceItem {
		const now = new Date().toISOString();
		const item: SourceItem = {
			id: createId(`item-${source.id}`),
			sourceId: source.id,
			title: source.name,
			content: source.description || `Manual topic source: ${source.name}`,
			url: source.url,
			publishedAt: now,
			gatheredAt: now,
		};

		db.prepare(`
			INSERT INTO source_items (id, source_id, external_id, title, content, url, author, published_at, gathered_at)
			VALUES (@id, @sourceId, NULL, @title, @content, @url, NULL, @publishedAt, @gatheredAt)
		`).run({
			id: item.id,
			sourceId: item.sourceId,
			title: item.title,
			content: item.content,
			url: item.url ?? null,
			publishedAt: item.publishedAt ?? null,
			gatheredAt: item.gatheredAt,
		});

		return item;
	}

	getSource(id: string): Source | undefined {
		const row = db.prepare(`${sourceSelectSql} WHERE s.id = ?`).get(id) as SourceRow | undefined;
		return row ? sourceFromRow(row) : undefined;
	}
}

export const sourceStore = new SourceStore();
