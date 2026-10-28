import type Database from 'better-sqlite3';
import type {MaterialSearchResult} from '../../src/types';
import {db} from '../database/index';
import {hasEmbeddedUrlCredential} from './safeFeedFetcher';

type MaterialRow = {
	kind: MaterialSearchResult['kind'];
	material_id: string;
	source_id: string;
	source_name: string;
	title: string;
	body: string;
	author: string;
	url: string;
	occurred_at: string;
	rank: number;
};

const searchTokens = (value: string): string[] => {
	const normalized = value.normalize('NFKC').slice(0, 200);
	const tokens = normalized.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) || [];
	return [...new Set(tokens.map(token => token.toLocaleLowerCase()))].slice(0, 12);
};

const matchExpression = (value: string): string | undefined => {
	const tokens = searchTokens(value);
	return tokens.length ? tokens.map(token => `"${token.replace(/"/g, '""')}"`).join(' AND ') : undefined;
};

const excerpt = (body: string, query: string): string => {
	const normalized = body.replace(/\s+/g, ' ').trim();
	if (normalized.length <= 320) return normalized;
	const token = searchTokens(query)[0];
	const index = token ? normalized.toLocaleLowerCase().indexOf(token) : -1;
	const start = index > 120 ? Math.max(0, index - 100) : 0;
	const clipped = normalized.slice(start, start + 320).trim();
	return `${start > 0 ? '…' : ''}${clipped}${start + 320 < normalized.length ? '…' : ''}`;
};

const safeHttpUrl = (value: string): string | undefined => {
	if (!value || /[\u0000-\u001f\u007f]/.test(value)) return undefined;
	try {
		const url = new URL(value);
		if ((url.protocol !== 'http:' && url.protocol !== 'https:') || hasEmbeddedUrlCredential(url)) return undefined;
		return url.toString();
	} catch {
		return undefined;
	}
};

export class MaterialSearchStore {
	constructor(private readonly database: Database.Database = db) {}

	search(query: string, limit = 30): MaterialSearchResult[] {
		const expression = matchExpression(query);
		if (!expression) return [];
		const boundedLimit = Math.min(Math.max(Math.trunc(limit) || 30, 1), 100);
		const rows = this.database.prepare(`
			SELECT kind, material_id, source_id, source_name, title, body, author, url, occurred_at,
				bm25(material_fts, 0, 0, 0, 2, 10, 1, 1, 0, 0) AS rank
			FROM material_fts
			WHERE material_fts MATCH ?
			ORDER BY rank ASC, lower(title) ASC, material_id ASC
			LIMIT ?
		`).all(expression, boundedLimit) as MaterialRow[];

		return rows.map(row => ({
			kind: row.kind,
			id: row.material_id,
			sourceId: row.source_id || undefined,
			sourceName: row.source_name || undefined,
			title: row.title,
			excerpt: excerpt(row.body, query),
			author: row.author || undefined,
			url: safeHttpUrl(row.url),
			...(row.kind === 'feed' ? {publishedAt: row.occurred_at} : {updatedAt: row.occurred_at}),
			rank: row.rank,
		}));
	}

	rebuild(): void {
		const rebuild = this.database.transaction(() => {
			this.database.prepare('DELETE FROM material_fts').run();
			this.database.prepare(`
				INSERT INTO material_fts(kind, material_id, source_id, source_name, title, body, author, url, occurred_at)
				SELECT 'feed', si.id, si.source_id, s.name, si.title, si.content, COALESCE(si.author, ''), COALESCE(si.url, ''), COALESCE(si.published_at, si.gathered_at)
				FROM source_items si JOIN sources s ON s.id = si.source_id
			`).run();
			this.database.prepare(`
				INSERT INTO material_fts(kind, material_id, source_id, source_name, title, body, author, url, occurred_at)
				SELECT 'note', n.id, '', 'Pasted note', n.title, n.body, COALESCE(n.author, ''), COALESCE(n.original_url, ''), n.updated_at
				FROM notes n
			`).run();
		});
		rebuild.immediate();
	}

	listDocumentKeys(): string[] {
		return (this.database.prepare(`
			SELECT kind || ':' || material_id AS key FROM material_fts ORDER BY key
		`).all() as Array<{key: string}>).map(row => row.key);
	}
}

export const materialSearchStore = new MaterialSearchStore();
