import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {afterEach, describe, expect, it} from 'vitest';
import type {ServerConfig} from '../../server/config';
import {inspectDatabaseHealth, openDatabase} from '../../server/database/connection';
import {initializeStorage, storageMarkerPaths, verifyStorage} from '../../server/storage';
import {installFrozenMigrationSnapshot} from '../fixtures/migrationSnapshots';

const temporaryRoots: string[] = [];

const makeRoot = (): string => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localcast-storage-test-'));
	temporaryRoots.push(root);
	return root;
};

const productionConfig = (root: string, installationId = 'localcast-test-installation'): ServerConfig => ({
	runtimeMode: 'production',
	processRole: 'storage-init',
	host: '127.0.0.1',
	port: 8787,
	databasePath: path.join(root, 'data', 'localcast.sqlite'),
	mediaPath: path.join(root, 'media'),
	webDistPath: path.join(root, 'dist'),
	installationId,
	trustedOrigins: ['https://localcast.example.test'],
	textProvider: 'not_configured',
	speechProvider: 'not_configured',
	allowFakeProviders: false,
	fakePhaseDelayMs: 0,
	fakeAfterPublicationDelayMs: 0,
	workerId: 'storage-test',
	workerPollMs: 250,
	leaseMs: 30_000,
	shutdownMs: 10_000,
});

afterEach(() => {
	while (temporaryRoots.length > 0) {
		fs.rmSync(temporaryRoots.pop()!, {recursive: true, force: true});
	}
});

describe('production storage contract', () => {
	it('initializes explicit empty mounts, verifies identity, and remains empty', () => {
		const config = productionConfig(makeRoot());
		initializeStorage(config);
		const database = openDatabase(config, {initializingStorage: true});

		expect(inspectDatabaseHealth(database)).toMatchObject({fts5: true, quickCheck: 'ok', foreignKeyViolations: 0});
		expect((database.prepare('SELECT COUNT(*) AS count FROM sources').get() as {count: number}).count).toBe(0);
		expect((database.prepare('SELECT COUNT(*) AS count FROM briefing_runs').get() as {count: number}).count).toBe(0);
		expect(database.pragma('foreign_keys', {simple: true})).toBe(1);
		expect(database.pragma('busy_timeout', {simple: true})).toBe(5000);
		expect(database.pragma('journal_mode', {simple: true})).toBe('wal');
		database.close();

		initializeStorage(config);
		verifyStorage(config);
		const reopened = openDatabase({...config, processRole: 'app'});
		expect((reopened.prepare("SELECT value FROM localcast_metadata WHERE key = 'installation_id'").get() as {value: string}).value).toBe(config.installationId);
		reopened.close();

		const markers = storageMarkerPaths(config);
		expect(fs.statSync(markers.data).mode & 0o777).toBe(0o600);
		expect(fs.statSync(markers.media).mode & 0o777).toBe(0o600);
	});

	it('rejects the wrong installation identity', () => {
		const root = makeRoot();
		const config = productionConfig(root);
		initializeStorage(config);
		const database = openDatabase(config, {initializingStorage: true});
		database.close();

		expect(() => verifyStorage(productionConfig(root, 'different-localcast-installation'))).toThrow(/do not match/);
	});

	it('rejects partial initialization and a missing persisted database', () => {
		const config = productionConfig(makeRoot());
		initializeStorage(config);
		const database = openDatabase(config, {initializingStorage: true});
		database.close();

		fs.unlinkSync(config.databasePath);
		expect(() => initializeStorage(config)).toThrow(/database is missing/);

		const markers = storageMarkerPaths(config);
		fs.unlinkSync(markers.media);
		expect(() => initializeStorage(config)).toThrow(/both installation markers/);
	});

	it('refuses to initialize an unexpected non-empty mount', () => {
		const config = productionConfig(makeRoot());
		fs.mkdirSync(config.mediaPath, {recursive: true});
		fs.writeFileSync(path.join(config.mediaPath, 'unrecognized-user-file'), 'preserve me');

		expect(() => initializeStorage(config)).toThrow(/Refusing to initialize non-empty/);
		expect(fs.readFileSync(path.join(config.mediaPath, 'unrecognized-user-file'), 'utf8')).toBe('preserve me');
	});

	it('rejects storage paths that resolve through symlinks to the same directory', () => {
		const root = makeRoot();
		const config = productionConfig(root);
		fs.mkdirSync(path.dirname(config.databasePath), {recursive: true});
		fs.symlinkSync(path.dirname(config.databasePath), config.mediaPath, 'dir');

		expect(() => initializeStorage(config)).toThrow(/resolve to distinct storage/);
	});

	it('checks existing database identity before applying migrations', () => {
		const config = productionConfig(makeRoot());
		fs.mkdirSync(path.dirname(config.databasePath), {recursive: true});
		fs.mkdirSync(config.mediaPath, {recursive: true});
		const legacy = new Database(config.databasePath);
		installFrozenMigrationSnapshot(legacy, '003_source_sync_metadata');
		legacy.prepare(`
			INSERT INTO app_settings (id, settings_json, updated_at)
			VALUES ('default', ?, '2026-08-05T12:00:00.000Z')
		`).run(JSON.stringify({theme: 'dark', aiConfig: {apiKey: 'must-not-be-touched'}}));
		legacy.close();
		initializeStorage(config);

		expect(() => openDatabase({...config, processRole: 'app'})).toThrow(/not initialized/);
		const unchanged = new Database(config.databasePath, {readonly: true});
		expect((unchanged.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get() as {count: number}).count).toBe(3);
		expect(unchanged.prepare("SELECT name FROM sqlite_master WHERE name = 'localcast_metadata'").get()).toBeUndefined();
		expect((unchanged.prepare("SELECT settings_json FROM app_settings WHERE id = 'default'").get() as {settings_json: string}).settings_json).toContain('must-not-be-touched');
		unchanged.close();

		const adopted = openDatabase(config, {initializingStorage: true});
		expect((adopted.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get() as {count: number}).count).toBe(4);
		expect((adopted.prepare("SELECT settings_json FROM app_settings WHERE id = 'default'").get() as {settings_json: string}).settings_json).not.toContain('must-not-be-touched');
		adopted.close();
	});

	it('rejects an unwritable initialized media mount', () => {
		const config = productionConfig(makeRoot());
		initializeStorage(config);
		const database = openDatabase(config, {initializingStorage: true});
		database.close();

		fs.chmodSync(config.mediaPath, 0o500);
		try {
			expect(() => verifyStorage(config)).toThrow();
		} finally {
			fs.chmodSync(config.mediaPath, 0o750);
		}
	});
});
