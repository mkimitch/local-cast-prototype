import Database from 'better-sqlite3';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {applyMigrations} from '../../server/database/migrations';
import {approvedChatModel} from '../../server/chat/types';
import {
	BackupRestoreError,
	canonicalJson,
	createVersionedBackup,
	restoreVersionedBackup,
	verifyBackupArtifact,
} from '../../server/operations/backupRestore';
import {insertGroundedEpisode} from '../helpers/chat';
import {insertSource, insertSourceItem, testConfig} from '../helpers/database';
import {ChatStore, enterReservedChatProviderStage} from '../../server/services/chatStore';
import {ProviderCheckStore} from '../../server/services/providerCheckStore';

const temporaryRoots: string[] = [];

const createRoot = (): string => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localcast-slice6b-test-'));
	fs.chmodSync(root, 0o700);
	temporaryRoots.push(root);
	return root;
};

const createFixture = (options: {media?: boolean; wal?: boolean} = {}): {
	root: string;
	databasePath: string;
	mediaPath: string;
	database: Database.Database;
	mediaBytes?: Buffer;
} => {
	const root = createRoot();
	const databasePath = path.join(root, 'source.sqlite');
	const mediaPath = path.join(root, 'source-media');
	fs.mkdirSync(mediaPath, {mode: 0o700});
	const database = new Database(databasePath);
	if (options.wal) database.pragma('journal_mode = WAL');
	database.pragma('foreign_keys = ON');
	applyMigrations(database);
	database.prepare("INSERT INTO localcast_metadata (key, value, updated_at) VALUES ('installation_id', ?, ?)")
		.run('00000000-0000-4000-8000-000000000008', '2026-08-21T12:00:00.000Z');
	let mediaBytes: Buffer | undefined;
	if (options.media) {
		const fixture = insertGroundedEpisode(database, {runId: 'run-backup-media'});
		mediaBytes = Buffer.from('synthetic-localcast-slice6b-media');
		const sha256 = createHash('sha256').update(mediaBytes).digest('hex');
		const filename = 'episode-run-backup-media.mp3';
		fs.writeFileSync(path.join(mediaPath, filename), mediaBytes, {mode: 0o600});
		database.prepare(`
			INSERT INTO audio_assets (
				id, run_id, url, duration_ms, format, storage_filename, mime_type,
				byte_length, sha256, validated_at, provider, model, voice, ai_generated
			) VALUES (?, ?, ?, 1000, 'mp3', ?, 'audio/mpeg', ?, ?, ?, 'fake', 'fake', 'fake', 1)
		`).run('asset-backup-media', fixture.runId, '/media/asset-backup-media', filename, mediaBytes.byteLength, sha256, '2026-08-21T12:00:00.000Z');
	}
	return {root, databasePath, mediaPath, database, mediaBytes};
};

const errorCode = (callback: () => unknown): string | undefined => {
	try {
		callback();
	} catch (error) {
		return error instanceof BackupRestoreError ? error.code : undefined;
	}
	return undefined;
};

afterEach(() => {
	while (temporaryRoots.length > 0) {
		const root = temporaryRoots.pop();
		if (!root || !path.basename(root).startsWith('localcast-slice6b-test-')) throw new Error('Unsafe test cleanup scope');
		fs.chmodSync(root, 0o700);
		fs.rmSync(root, {recursive: true, force: true});
	}
});

describe('versioned backup and safe restore', () => {
	it('creates and restores a database-only backup with private, canonical artifacts', async () => {
		const fixture = createFixture();
		const backupPath = path.join(fixture.root, 'backup');
		fixture.database.close();
		const manifest = await createVersionedBackup({
			databasePath: fixture.databasePath,
			mediaPath: fixture.mediaPath,
			destinationPath: backupPath,
			maximumMediaBytes: 1024,
			createdAt: '2026-08-21T16:00:00.000Z',
		});

		expect(manifest.media).toMatchObject({fileCount: 0, totalBytes: 0, files: []});
		expect(fs.readFileSync(path.join(backupPath, 'manifest.json'), 'utf8')).toBe(canonicalJson(manifest));
		expect(fs.statSync(backupPath).mode & 0o777).toBe(0o700);
		for (const file of ['database/localcast.sqlite', 'manifest.json', 'backup-validation.json', 'SHA256SUMS', 'SHA256SUMS.sha256']) {
			expect(fs.statSync(path.join(backupPath, file)).mode & 0o777).toBe(0o600);
		}

		const dataTarget = path.join(fixture.root, 'restored-data');
		const mediaTarget = path.join(fixture.root, 'restored-media');
		restoreVersionedBackup({backupPath, dataTargetPath: dataTarget, mediaTargetPath: mediaTarget});
		expect(fs.existsSync(path.join(dataTarget, 'localcast.sqlite'))).toBe(true);
		expect(fs.readdirSync(mediaTarget).sort()).toEqual(['.localcast-installation.json']);
		expect(fs.readFileSync(path.join(dataTarget, '.localcast-installation.json'), 'utf8')).not.toContain('provider');
	});

	it('captures committed WAL data and only published referenced media', async () => {
		const fixture = createFixture({media: true, wal: true});
		fixture.database.prepare("INSERT INTO notes (id, title, body, created_at, updated_at) VALUES ('wal-note', 'WAL', 'committed WAL content', ?, ?)")
			.run('2026-08-21T12:00:00.000Z', '2026-08-21T12:00:00.000Z');
		const excludedCanaries = ['provider-key-canary', 'podcast-token-canary', 'raw-provider-payload-canary'];
		fs.writeFileSync(path.join(fixture.mediaPath, 'unreferenced-secret.env'), excludedCanaries[0], {mode: 0o600});
		fs.writeFileSync(path.join(fixture.mediaPath, 'podcast-token'), excludedCanaries[1], {mode: 0o600});
		fs.writeFileSync(path.join(fixture.mediaPath, 'provider-response.json'), excludedCanaries[2], {mode: 0o600});
		const backupPath = path.join(fixture.root, 'backup');
		await createVersionedBackup({databasePath: fixture.databasePath, mediaPath: fixture.mediaPath, destinationPath: backupPath, maximumMediaBytes: 1024 * 1024});
		fixture.database.close();

		const manifest = verifyBackupArtifact(backupPath).manifest;
		expect(manifest.media.fileCount).toBe(1);
		expect(manifest.media.files[0]?.path).toBe('media/episode-run-backup-media.mp3');
		expect(fs.existsSync(path.join(backupPath, 'media/unreferenced-secret.env'))).toBe(false);
		const artifactText = fs.readdirSync(backupPath, {recursive: true, encoding: 'utf8'})
			.filter(relative => fs.lstatSync(path.join(backupPath, relative)).isFile())
			.map(relative => fs.readFileSync(path.join(backupPath, relative)))
			.reduce((combined, content) => Buffer.concat([combined, content]), Buffer.alloc(0));
		for (const canary of excludedCanaries) expect(artifactText.includes(Buffer.from(canary))).toBe(false);
		const copied = new Database(path.join(backupPath, 'database/localcast.sqlite'), {readonly: true});
		expect(copied.prepare("SELECT COUNT(*) AS count FROM notes WHERE id = 'wal-note'").get()).toEqual({count: 1});
		copied.close();
	});

	it('preserves feed, FTS, job, evidence, chat, citation, and provider-default parity', async () => {
		const fixture = createFixture({media: true, wal: true});
		const sourceId = insertSource(fixture.database, 'source-backup');
		insertSourceItem(fixture.database, sourceId, 'item-backup');
		fixture.database.prepare(`
			INSERT INTO generation_jobs (
				id, run_id, idempotency_key, payload_version, payload_json, state, phase,
				attempt_count, retryable, created_at, updated_at, started_at, completed_at
			) VALUES ('job-backup', 'run-backup-media', 'job-backup-key', 1, '{}', 'complete', 'complete', 1, 0, ?, ?, ?, ?)
		`).run(...Array(4).fill('2026-08-21T12:00:00.000Z'));
		fixture.database.prepare(`
			INSERT INTO generation_attempts (id, job_id, attempt_number, worker_id, started_at, finished_at, outcome)
			VALUES ('attempt-backup', 'job-backup', 1, 'worker-backup', ?, ?, 'complete')
		`).run('2026-08-21T12:00:00.000Z', '2026-08-21T12:00:00.000Z');
		const ids = ['turn-backup', 'attempt-id-backup', 'draft-call-backup', 'support-call-backup'];
		const chats = new ChatStore(fixture.database, () => '2026-08-21T12:00:00.000Z', () => ids.shift() || 'unused-id');
		const turn = chats.enqueue('run-backup-media', 'What does the synthetic evidence say?', 'chat-backup-key').turn;
		chats.claimNext('worker-backup', 60_000);
		for (const [stage, outcome] of [['draft', 'draft_answer_validated'], ['support', 'support_validated']] as const) {
			const reservation = chats.reserveProviderCall(turn.id, 'worker-backup', stage, approvedChatModel);
			const lifecycle = enterReservedChatProviderStage(reservation, {
				runId: 'run-backup-media', turnId: turn.id, attemptNumber: 1, workerId: 'worker-backup',
			}, stage, approvedChatModel);
			lifecycle.record({kind: 'response', audit: {stage, model: approvedChatModel}});
			lifecycle.record({kind: 'finalize', stage, outcome});
		}
		chats.completeAnswer(turn.id, 'worker-backup', [{
			id: 'ignored',
			text: "Synthetic LocalCast evidence states that durable chat history remains in SQLite across process and browser restarts.",
			citations: [{
				snapshotId: 'snapshot-run-backup-media',
				excerpt: "Synthetic LocalCast evidence states that durable chat history remains in SQLite across process and browser restarts.",
			}],
			supportStatus: 'supported',
		}]);
		const backupPath = path.join(fixture.root, 'backup-parity');
		await createVersionedBackup({databasePath: fixture.databasePath, mediaPath: fixture.mediaPath, destinationPath: backupPath, maximumMediaBytes: 1024 * 1024});
		fixture.database.close();
		const dataTarget = path.join(fixture.root, 'restored-data');
		const mediaTarget = path.join(fixture.root, 'restored-media');
		const manifest = restoreVersionedBackup({backupPath, dataTargetPath: dataTarget, mediaTargetPath: mediaTarget});
		expect(manifest.validation.counts).toMatchObject({
			sources: 1, sourceItems: 1, generationJobs: 1, generationAttempts: 1,
			episodeEvidenceSnapshots: 1, episodeCitations: 1, chatTurns: 1,
			chatAttempts: 1, chatProviderCalls: 2, chatClaims: 1, chatCitations: 1,
		});
		const restored = new Database(path.join(dataTarget, 'localcast.sqlite'), {readonly: true});
		const status = new ProviderCheckStore(restored).summary(testConfig({textProvider: 'not_configured', speechProvider: 'not_configured'}));
		expect(status).toMatchObject({
			text: {status: 'NOT CONFIGURED'}, speech: {status: 'NOT CONFIGURED'}, generationEnabled: false,
		});
		expect(restored.prepare("SELECT COUNT(*) AS count FROM material_fts WHERE material_id = 'item-backup'").get()).toEqual({count: 1});
		restored.close();
		expect(fs.readFileSync(path.join(mediaTarget, 'episode-run-backup-media.mp3'))).toEqual(fixture.mediaBytes);
	});

	it('produces deterministic canonical manifests for identical input and timestamp', async () => {
		const fixture = createFixture({media: true});
		fixture.database.close();
		const first = path.join(fixture.root, 'backup-a');
		const second = path.join(fixture.root, 'backup-b');
		for (const destinationPath of [first, second]) {
			await createVersionedBackup({databasePath: fixture.databasePath, mediaPath: fixture.mediaPath, destinationPath, maximumMediaBytes: 1024 * 1024, createdAt: '2026-08-21T16:00:00.000Z'});
		}
		expect(fs.readFileSync(path.join(first, 'manifest.json'))).toEqual(fs.readFileSync(path.join(second, 'manifest.json')));
	});

	it('rejects checksum corruption and missing, extra, malformed, oversized, or unsupported artifacts', async () => {
		for (const mutation of ['corrupt', 'missing', 'extra', 'malformed', 'oversized', 'version', 'schema', 'application'] as const) {
			const fixture = createFixture();
			fixture.database.close();
			const backupPath = path.join(fixture.root, `backup-${mutation}`);
			await createVersionedBackup({databasePath: fixture.databasePath, mediaPath: fixture.mediaPath, destinationPath: backupPath, maximumMediaBytes: 1024});
			if (mutation === 'corrupt') fs.appendFileSync(path.join(backupPath, 'database/localcast.sqlite'), Buffer.from([0]));
			if (mutation === 'missing') fs.unlinkSync(path.join(backupPath, 'backup-validation.json'));
			if (mutation === 'extra') fs.writeFileSync(path.join(backupPath, 'extra'), 'extra', {mode: 0o600});
			if (mutation === 'malformed') fs.writeFileSync(path.join(backupPath, 'manifest.json'), '{', {mode: 0o600});
			if (mutation === 'oversized') fs.writeFileSync(path.join(backupPath, 'manifest.json'), Buffer.alloc(4 * 1024 * 1024 + 1), {mode: 0o600});
			if (mutation === 'version' || mutation === 'schema' || mutation === 'application') {
				const manifest = JSON.parse(fs.readFileSync(path.join(backupPath, 'manifest.json'), 'utf8')) as {
					formatVersion: number;
					compatibility: {schemaMigration: string; applicationVersion: string};
				};
				if (mutation === 'version') manifest.formatVersion = 99;
				if (mutation === 'schema') manifest.compatibility.schemaMigration = '999_unknown';
				if (mutation === 'application') manifest.compatibility.applicationVersion = '999.0.0';
				fs.writeFileSync(path.join(backupPath, 'manifest.json'), canonicalJson(manifest), {mode: 0o600});
			}
			expect(() => verifyBackupArtifact(backupPath)).toThrow(BackupRestoreError);
		}
	});

	it('rejects non-absent restore targets before creating output', async () => {
		const fixture = createFixture();
		fixture.database.close();
		const backupPath = path.join(fixture.root, 'backup');
		await createVersionedBackup({databasePath: fixture.databasePath, mediaPath: fixture.mediaPath, destinationPath: backupPath, maximumMediaBytes: 1024});
		const dataTarget = path.join(fixture.root, 'data');
		fs.mkdirSync(dataTarget, {mode: 0o700});
		fs.writeFileSync(path.join(dataTarget, 'existing-content'), 'occupied', {mode: 0o600});
		expect(errorCode(() => restoreVersionedBackup({backupPath, dataTargetPath: dataTarget, mediaTargetPath: path.join(fixture.root, 'media-target')}))).toBe('TARGET_NOT_EMPTY');
	});

	it('atomically restores into explicitly empty target directories', async () => {
		const fixture = createFixture({media: true});
		fixture.database.close();
		const backupPath = path.join(fixture.root, 'backup');
		await createVersionedBackup({databasePath: fixture.databasePath, mediaPath: fixture.mediaPath, destinationPath: backupPath, maximumMediaBytes: 1024 * 1024});
		const dataTarget = path.join(fixture.root, 'empty-data');
		const mediaTarget = path.join(fixture.root, 'empty-media');
		fs.mkdirSync(dataTarget, {mode: 0o700});
		fs.mkdirSync(mediaTarget, {mode: 0o700});
		restoreVersionedBackup({backupPath, dataTargetPath: dataTarget, mediaTargetPath: mediaTarget});
		expect(fs.existsSync(path.join(dataTarget, 'localcast.sqlite'))).toBe(true);
		expect(fs.existsSync(path.join(mediaTarget, 'episode-run-backup-media.mp3'))).toBe(true);
	});

	it('enforces the explicit media limit without publishing a partial backup', async () => {
		const fixture = createFixture({media: true});
		fixture.database.close();
		const backupPath = path.join(fixture.root, 'backup');
		const originalUmask = process.umask();
		await expect(createVersionedBackup({databasePath: fixture.databasePath, mediaPath: fixture.mediaPath, destinationPath: backupPath, maximumMediaBytes: 1})).rejects.toMatchObject({code: 'MEDIA_LIMIT_EXCEEDED'});
		expect(process.umask()).toBe(originalUmask);
		expect(fs.existsSync(backupPath)).toBe(false);
		expect(fs.readdirSync(fixture.root).some(name => name.includes('.localcast-incomplete-'))).toBe(false);
	});

	it('rejects symlink, hard-link, and traversal media sources', async () => {
		for (const kind of ['symlink', 'hardlink', 'traversal'] as const) {
			const fixture = createFixture({media: true});
			const source = path.join(fixture.mediaPath, 'episode-run-backup-media.mp3');
			if (kind === 'symlink') {
				fs.renameSync(source, `${source}.real`);
				fs.symlinkSync(`${source}.real`, source);
			} else if (kind === 'hardlink') {
				fs.linkSync(source, `${source}.link`);
			} else {
				fixture.database.prepare("UPDATE audio_assets SET storage_filename = '../escape.mp3' WHERE id = 'asset-backup-media'").run();
			}
			fixture.database.close();
			await expect(createVersionedBackup({databasePath: fixture.databasePath, mediaPath: fixture.mediaPath, destinationPath: path.join(fixture.root, `backup-${kind}`), maximumMediaBytes: 1024 * 1024})).rejects.toBeInstanceOf(BackupRestoreError);
		}
	});

	it('rejects missing, altered, special, and duplicate published media', async () => {
		for (const kind of ['missing', 'altered', 'nonregular', 'duplicate'] as const) {
			const fixture = createFixture({media: true});
			const source = path.join(fixture.mediaPath, 'episode-run-backup-media.mp3');
			if (kind === 'missing') fs.unlinkSync(source);
			if (kind === 'altered') fs.writeFileSync(source, Buffer.alloc(fixture.mediaBytes!.byteLength, 1), {mode: 0o600});
			if (kind === 'nonregular') {
				fs.unlinkSync(source);
				fs.mkdirSync(source, {mode: 0o700});
			} else if (kind === 'duplicate') {
				const second = insertGroundedEpisode(fixture.database, {runId: 'run-backup-duplicate'});
				fixture.database.prepare(`
					INSERT INTO audio_assets (
						id, run_id, url, duration_ms, format, storage_filename, mime_type,
						byte_length, sha256, validated_at, provider, model, voice, ai_generated
					) SELECT 'asset-backup-duplicate', ?, '/media/duplicate', duration_ms, format,
						storage_filename, mime_type, byte_length, sha256, validated_at, provider, model, voice, ai_generated
					FROM audio_assets WHERE id = 'asset-backup-media'
				`).run(second.runId);
			}
			fixture.database.close();
			await expect(createVersionedBackup({databasePath: fixture.databasePath, mediaPath: fixture.mediaPath, destinationPath: path.join(fixture.root, `backup-${kind}`), maximumMediaBytes: 1024 * 1024})).rejects.toBeInstanceOf(BackupRestoreError);
		}
	});

	it('rejects a source database change during backup', async () => {
		const fixture = createFixture();
		const backupPath = path.join(fixture.root, 'backup');
		await expect(createVersionedBackup({
			databasePath: fixture.databasePath,
			mediaPath: fixture.mediaPath,
			destinationPath: backupPath,
			maximumMediaBytes: 1024,
			onPhase: phase => {
				if (phase === 'database-copied') {
					fixture.database.prepare("INSERT INTO notes (id, title, body, created_at, updated_at) VALUES ('changed', 'Changed', 'Changed', ?, ?)")
						.run('2026-08-21T12:00:00.000Z', '2026-08-21T12:00:00.000Z');
				}
			},
		})).rejects.toBeInstanceOf(BackupRestoreError);
		fixture.database.close();
		expect(fs.existsSync(backupPath)).toBe(false);
	});

	it('rejects a read-only restore parent without leaving targets', async () => {
		const fixture = createFixture();
		fixture.database.close();
		const backupPath = path.join(fixture.root, 'backup');
		await createVersionedBackup({databasePath: fixture.databasePath, mediaPath: fixture.mediaPath, destinationPath: backupPath, maximumMediaBytes: 1024});
		const readOnlyParent = path.join(fixture.root, 'read-only');
		fs.mkdirSync(readOnlyParent, {mode: 0o500});
		try {
			expect(() => restoreVersionedBackup({
				backupPath,
				dataTargetPath: path.join(readOnlyParent, 'data'),
				mediaTargetPath: path.join(readOnlyParent, 'media'),
			})).toThrow();
			expect(fs.readdirSync(readOnlyParent)).toEqual([]);
		} finally {
			fs.chmodSync(readOnlyParent, 0o700);
		}
	});

	it('cleans only incomplete resources after interrupted backup and restore', async () => {
		const fixture = createFixture({media: true});
		fixture.database.close();
		const interruptedBackup = path.join(fixture.root, 'interrupted-backup');
		await expect(createVersionedBackup({
			databasePath: fixture.databasePath, mediaPath: fixture.mediaPath, destinationPath: interruptedBackup, maximumMediaBytes: 1024 * 1024,
			onPhase: phase => { if (phase === 'media-copied') throw new Error('injected interruption'); },
		})).rejects.toThrow('injected interruption');
		expect(fs.existsSync(interruptedBackup)).toBe(false);

		const backupPath = path.join(fixture.root, 'backup');
		await createVersionedBackup({databasePath: fixture.databasePath, mediaPath: fixture.mediaPath, destinationPath: backupPath, maximumMediaBytes: 1024 * 1024});
		const dataTarget = path.join(fixture.root, 'data-target');
		const mediaTarget = path.join(fixture.root, 'media-target');
		expect(() => restoreVersionedBackup({
			backupPath, dataTargetPath: dataTarget, mediaTargetPath: mediaTarget,
			onPhase: phase => { if (phase === 'restore-media-copied') throw new Error('injected interruption'); },
		})).toThrow('injected interruption');
		expect(fs.existsSync(dataTarget)).toBe(false);
		expect(fs.existsSync(mediaTarget)).toBe(false);
		expect(fs.readdirSync(fixture.root).some(name => name.includes('.localcast-incomplete-'))).toBe(false);
	});
});
