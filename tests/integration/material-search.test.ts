import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {applyMigrations} from '../../server/database/migrations';
import {MaterialSearchStore} from '../../server/services/materialSearchStore';
import {SourceStore} from '../../server/services/sourceStore';
import {StationStore} from '../../server/services/stationStore';
import {installFrozenMigrationSnapshot} from '../fixtures/migrationSnapshots';

const databases: Database.Database[] = [];
const roots: string[] = [];
const open = (filename = ':memory:'): Database.Database => {
	const database = new Database(filename);
	database.pragma('foreign_keys = ON');
	databases.push(database);
	return database;
};

afterEach(() => {
	while (databases.length) databases.pop()!.close();
	while (roots.length) fs.rmSync(roots.pop()!, {recursive: true, force: true});
});

describe('unified supplied-material FTS5 index', () => {
	it('backfills a frozen migration-005 database with feed and note provenance', () => {
		const database = open();
		installFrozenMigrationSnapshot(database, '005_real_provider_walking_skeleton');
		database.prepare(`INSERT INTO sources (id, type, name, url, is_active, status, added_at) VALUES ('source-old', 'rss', 'Old feed', 'https://example.test/feed', 1, 'healthy', '2026-08-06T12:00:00.000Z')`).run();
		database.prepare(`INSERT INTO source_items (id, source_id, external_id, title, content, url, author, gathered_at) VALUES ('item-old', 'source-old', 'external-old', 'Migration lighthouse', 'A preserved feed body about durable migrations.', 'https://example.test/item', 'Feed author', '2026-08-06T12:00:00.000Z')`).run();
		database.prepare(`INSERT INTO notes (id, revision, title, body, author, created_at, updated_at) VALUES ('note-old', 1, 'Pasted lighthouse', 'A preserved pasted note about migrations.', 'Note author', '2026-08-06T12:00:00.000Z', '2026-08-06T12:00:00.000Z')`).run();

		applyMigrations(database);
		const results = new MaterialSearchStore(database).search('lighthouse');
		expect(results).toEqual(expect.arrayContaining([
			expect.objectContaining({kind: 'feed', id: 'item-old', sourceId: 'source-old', sourceName: 'Old feed'}),
			expect.objectContaining({kind: 'note', id: 'note-old', sourceName: 'Pasted note'}),
		]));
	});

	it('tracks feed and note insert/update/delete, ranks title matches, and quotes hostile punctuation', () => {
		const database = open();
		applyMigrations(database);
		let id = 0;
		const sources = new SourceStore(database, () => '2026-08-06T12:00:00.000Z', () => `id-${++id}`);
		const stations = new StationStore(database, () => '2026-08-06T12:00:00.000Z', () => `id-${++id}`);
		const search = new MaterialSearchStore(database);
		const source = sources.addSource({type: 'rss', name: 'Architecture feed', url: 'https://example.test/feed', isActive: true});
		sources.upsertRssSourceItems(source.id, [{
			externalId: 'feed-title', title: 'SQLite lighthouse', content: 'Body with durable search details.',
			url: 'https://example.test/title', gatheredAt: '2026-08-06T12:00:00.000Z', feedSourceUrl: 'https://example.test/feed', networkScope: 'public',
		}, {
			externalId: 'feed-body', title: 'Other title', content: 'The body mentions SQLite lighthouse.',
			url: 'https://example.test/item?auth_token=secret-canary', gatheredAt: '2026-08-06T12:00:00.000Z', feedSourceUrl: 'https://example.test/feed', networkScope: 'public',
		}]);
		const note = stations.createNote({title: 'Café résumé', body: "O'Reilly-style punctuation (safe): SQLite * OR NOT."});

		const ranked = search.search('SQLite lighthouse');
		expect(ranked[0]).toMatchObject({title: 'SQLite lighthouse'});
		expect(ranked[0]!.rank).toBeLessThanOrEqual(ranked[1]!.rank);
		expect(ranked.find(result => result.title === 'Other title')?.url).toBeUndefined();
		expect(JSON.stringify(ranked)).not.toContain('secret-canary');
		expect(() => search.search(`" OR * - ( ) : '; DROP TABLE notes; --`)).not.toThrow();
		expect(search.search('')).toEqual([]);
		expect(search.search('***')).toEqual([]);
		expect(search.search('cafe resume')).toEqual([expect.objectContaining({id: note.id, kind: 'note'})]);

		stations.updateNote(note.id, {title: 'Updated note', body: 'New unique aurora phrase.'});
		expect(search.search('résumé')).toEqual([]);
		expect(search.search('aurora')).toEqual([expect.objectContaining({id: note.id})]);
		stations.deleteNote(note.id);
		expect(search.search('aurora')).toEqual([]);

		sources.updateSource(source.id, {name: 'Renamed architecture feed'});
		expect(search.search('lighthouse')[0]).toMatchObject({sourceName: 'Renamed architecture feed'});
		sources.deleteSource(source.id);
		expect(search.search('lighthouse')).toEqual([]);
		expect(search.listDocumentKeys()).toEqual([]);
	});

	it('rebuilds exact canonical parity and survives SQLite backup and restart', async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localcast-fts-backup-'));
		roots.push(root);
		const primaryPath = path.join(root, 'primary.sqlite');
		const backupPath = path.join(root, 'backup.sqlite');
		const primary = open(primaryPath);
		applyMigrations(primary);
		const sources = new SourceStore(primary, () => '2026-08-06T12:00:00.000Z', () => 'source');
		const source = sources.addSource({type: 'rss', name: 'Backup feed', url: 'https://example.test/feed', isActive: true});
		sources.upsertRssSourceItems(source.id, [{externalId: 'one', title: 'Backup beacon', content: 'Canonical body', gatheredAt: '2026-08-06T12:00:00.000Z', feedSourceUrl: 'https://example.test/feed', networkScope: 'public'}]);
		const search = new MaterialSearchStore(primary);
		const expected = search.search('backup beacon');
		primary.prepare("DELETE FROM material_fts WHERE kind = 'feed'").run();
		expect(search.search('backup beacon')).toEqual([]);
		search.rebuild();
		expect(search.search('backup beacon')).toEqual(expected);
		expect(search.listDocumentKeys()).toEqual(['feed:item-source']);

		await primary.backup(backupPath);
		const restored = open(backupPath);
		applyMigrations(restored);
		expect(new MaterialSearchStore(restored).search('backup beacon')).toEqual(expected);
		expect(restored.pragma('quick_check', {simple: true})).toBe('ok');
	});
});
