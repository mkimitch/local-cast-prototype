import type {Source, SourceItem} from '../../src/types';
import {db} from '../database';

export type CreateSourceInput = Omit<Source, 'id' | 'addedAt'>;
export type UpdateSourceInput = Partial<Omit<Source, 'id' | 'addedAt'>>;

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
};

type SourceItemRow = {
	id: string;
	source_id: string;
	title: string;
	content: string;
	url: string | null;
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
});

const sourceItemFromRow = (row: SourceItemRow): SourceItem => ({
	id: row.id,
	sourceId: row.source_id,
	title: row.title,
	content: row.content,
	url: row.url || undefined,
	publishedAt: row.published_at || undefined,
	gatheredAt: row.gathered_at,
});

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
		const rows = db.prepare('SELECT * FROM sources ORDER BY datetime(added_at) DESC').all() as SourceRow[];
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
				status = @status
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
		});

		return cloneSource(source);
	}

	deleteSource(id: string): boolean {
		const result = db.prepare('DELETE FROM sources WHERE id = ?').run(id);
		return result.changes > 0;
	}

	getSourcesByIds(sourceIds: string[]): Source[] {
		if (sourceIds.length === 0) return [];

		const placeholders = sourceIds.map(() => '?').join(', ');
		const rows = db.prepare(`SELECT * FROM sources WHERE id IN (${placeholders}) ORDER BY datetime(added_at) DESC`).all(...sourceIds) as SourceRow[];
		return rows.map(row => cloneSource(sourceFromRow(row)));
	}

	getActiveSources(): Source[] {
		const rows = db.prepare('SELECT * FROM sources WHERE is_active = 1 ORDER BY datetime(added_at) DESC').all() as SourceRow[];
		return rows.map(row => cloneSource(sourceFromRow(row)));
	}

	buildSourceItems(sourceIds: string[]): SourceItem[] {
		const selectedSources = sourceIds.length > 0 ? this.getSourcesByIds(sourceIds) : this.getActiveSources();
		const now = new Date().toISOString();

		const items = selectedSources.map((source, index): SourceItem => ({
			id: createId(`item-${source.id}-${index + 1}`),
			sourceId: source.id,
			title: source.type === 'rss' ? `${source.name} latest update` : source.name,
			content: source.description || source.url || `Mock gathered item from ${source.name}`,
			url: source.url,
			publishedAt: now,
			gatheredAt: now,
		}));

		const insert = db.prepare(`
			INSERT INTO source_items (id, source_id, title, content, url, published_at, gathered_at)
			VALUES (@id, @sourceId, @title, @content, @url, @publishedAt, @gatheredAt)
		`);

		const persist = db.transaction(() => {
			for (const item of items) {
				insert.run({
					id: item.id,
					sourceId: item.sourceId,
					title: item.title,
					content: item.content,
					url: item.url ?? null,
					publishedAt: item.publishedAt ?? null,
					gatheredAt: item.gatheredAt,
				});
			}
		});

		persist();
		return items.map(item => sourceItemFromRow({
			id: item.id,
			source_id: item.sourceId,
			title: item.title,
			content: item.content,
			url: item.url ?? null,
			published_at: item.publishedAt ?? null,
			gathered_at: item.gatheredAt,
		}));
	}

	private getSource(id: string): Source | undefined {
		const row = db.prepare('SELECT * FROM sources WHERE id = ?').get(id) as SourceRow | undefined;
		return row ? sourceFromRow(row) : undefined;
	}
}

export const sourceStore = new SourceStore();
