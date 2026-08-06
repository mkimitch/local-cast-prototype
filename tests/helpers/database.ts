import Database from 'better-sqlite3';
import type {ServerConfig} from '../../server/config';
import {applyMigrations} from '../../server/database/migrations';

export const createTestDatabase = (): Database.Database => {
	const database = new Database(':memory:');
	database.pragma('foreign_keys = ON');
	database.pragma('busy_timeout = 5000');
	applyMigrations(database);
	return database;
};

export const insertSource = (database: Database.Database, id = 'source-1'): string => {
	database.prepare(`
		INSERT INTO sources (id, type, name, url, is_active, status, added_at)
		VALUES (?, 'rss', ?, 'https://example.test/feed.xml', 1, 'healthy', ?)
	`).run(id, `Source ${id}`, '2026-08-05T12:00:00.000Z');
	return id;
};

export const insertSourceItem = (database: Database.Database, sourceId: string, id = 'item-1'): string => {
	database.prepare(`
		INSERT INTO source_items (id, source_id, external_id, title, content, gathered_at)
		VALUES (?, ?, ?, ?, ?, ?)
	`).run(id, sourceId, `external-${id}`, `Title ${id}`, `Evidence ${id}`, '2026-08-05T12:00:00.000Z');
	return id;
};

export const testConfig = (overrides: Partial<ServerConfig> = {}): ServerConfig => ({
	runtimeMode: 'test',
	processRole: 'worker',
	host: '127.0.0.1',
	port: 8787,
	databasePath: ':memory:',
	mediaPath: '/tmp/localcast-test-media',
	webDistPath: '/tmp/localcast-test-dist',
	trustedOrigins: [],
	textProvider: 'fake',
	speechProvider: 'fake',
	openAiTextModel: 'gpt-5.4-mini',
	openAiReasoningEffort: 'low',
	openAiSpeechModel: 'gpt-4o-mini-tts',
	openAiSpeechVoice: 'marin',
	openAiSpeechFormat: 'mp3',
	ffprobePath: 'ffprobe',
	allowFakeProviders: true,
	fakePhaseDelayMs: 0,
	fakeAfterPublicationDelayMs: 0,
	workerId: 'test-worker',
	workerPollMs: 25,
	leaseMs: 1_000,
	shutdownMs: 1_000,
	...overrides,
});
