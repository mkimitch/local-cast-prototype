import Database from 'better-sqlite3';
import {createHash, randomUUID} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {migrationIds} from '../database/migrations';

export const LOCALCAST_BACKUP_FORMAT_VERSION = 1;
export const LOCALCAST_BACKUP_APPLICATION_VERSION = '0.0.0';
const DATABASE_ARTIFACT = 'database/localcast.sqlite';
const MANIFEST_ARTIFACT = 'manifest.json';
const VALIDATION_ARTIFACT = 'backup-validation.json';
const CHECKSUM_ARTIFACT = 'SHA256SUMS';
const CHECKSUM_ROOT_ARTIFACT = 'SHA256SUMS.sha256';
const MARKER_FILE = '.localcast-installation.json';
const MAX_MEDIA_FILES = 10_000;
const MAX_PATH_BYTES = 240;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_VALIDATION_BYTES = 2 * 1024 * 1024;
const MAX_CHECKSUM_BYTES = 4 * 1024 * 1024;
const MAX_DATABASE_BYTES = 64 * 1024 * 1024 * 1024;

export type BackupPhase =
	| 'source-validated'
	| 'database-copied'
	| 'media-copied'
	| 'artifact-published'
	| 'artifact-verified'
	| 'restore-database-copied'
	| 'restore-media-copied'
	| 'restore-published';

export class BackupRestoreError extends Error {
	constructor(readonly code: string, message: string) {
		super(message);
		this.name = 'BackupRestoreError';
	}
}

type ValidationCounts = {
	sources: number;
	sourceItems: number;
	notes: number;
	briefingRuns: number;
	generationJobs: number;
	generationAttempts: number;
	episodeEvidenceSnapshots: number;
	transcriptClaims: number;
	episodeCitations: number;
	chatTurns: number;
	chatAttempts: number;
	chatProviderCalls: number;
	chatClaims: number;
	chatCitations: number;
	publishedEpisodes: number;
};

type PublicValidation = {
	migrations: string[];
	quickCheck: 'ok';
	foreignKeys: 'ok';
	identityCardinality: 'valid';
	quiescence: 'valid';
	ftsParity: 'valid';
	relationships: 'valid';
	counts: ValidationCounts;
};

type InternalValidation = {
	public: PublicValidation;
	installationId: string;
};

type MediaManifestEntry = {
	path: string;
	bytes: number;
	sha256: string;
};

export type BackupManifest = {
	formatVersion: 1;
	createdAt: string;
	compatibility: {
		applicationVersion: string;
		schemaMigration: string;
	};
	database: {
		path: typeof DATABASE_ARTIFACT;
		bytes: number;
		sha256: string;
	};
	media: {
		files: MediaManifestEntry[];
		fileCount: number;
		totalBytes: number;
	};
	limits: {
		maximumMediaBytes: number;
		maximumMediaFiles: number;
		maximumPathBytes: number;
	};
	validation: PublicValidation;
};

export type CreateBackupOptions = {
	databasePath: string;
	mediaPath: string;
	destinationPath: string;
	maximumMediaBytes: number;
	createdAt?: string;
	onPhase?: (phase: BackupPhase) => void;
};

export type RestoreBackupOptions = {
	backupPath: string;
	dataTargetPath: string;
	mediaTargetPath: string;
	onPhase?: (phase: BackupPhase) => void;
};

type RestoreTarget = {
	path: string;
	parent: string;
	existedEmpty: boolean;
	mode: number;
};

const fail = (code: string, message: string): never => {
	throw new BackupRestoreError(code, message);
};

const requireAbsolutePath = (value: string, code: string): string => {
	if (!path.isAbsolute(value) || value.includes('\0')) fail(code, 'An absolute filesystem path is required');
	return path.normalize(value);
};

const lstatRegularFile = (filePath: string, code: string, options: {singleLink?: boolean; privateMode?: boolean} = {}): fs.Stats => {
	let stat: fs.Stats;
	try {
		stat = fs.lstatSync(filePath);
	} catch {
		return fail(code, 'A required regular file is unavailable');
	}
	if (!stat.isFile() || stat.isSymbolicLink()) fail(code, 'A required path is not a regular non-symlink file');
	if (options.singleLink && stat.nlink !== 1) fail(code, 'Hard-linked files are not accepted');
	if (options.privateMode && (stat.mode & 0o077) !== 0) fail(code, 'Backup artifacts must not be accessible to group or other users');
	return stat;
};

const lstatDirectory = (directory: string, code: string, options: {privateMode?: boolean} = {}): fs.Stats => {
	let stat: fs.Stats;
	try {
		stat = fs.lstatSync(directory);
	} catch {
		return fail(code, 'A required directory is unavailable');
	}
	if (!stat.isDirectory() || stat.isSymbolicLink()) fail(code, 'A required path is not a regular non-symlink directory');
	if (options.privateMode && (stat.mode & 0o077) !== 0) fail(code, 'Backup directories must not be accessible to group or other users');
	return stat;
};

const requireSafeParent = (target: string, code: string): string => {
	const parent = path.dirname(target);
	lstatDirectory(parent, code);
	fs.accessSync(parent, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
	return fs.realpathSync(parent);
};

const prepareRestoreTarget = (target: string, code: string): RestoreTarget => {
	const parent = requireSafeParent(target, code);
	if (path.dirname(target) !== parent) fail('TARGET_PARENT_INVALID', 'Restore target parents must be canonical');
	if (!fs.existsSync(target)) return {path: target, parent, existedEmpty: false, mode: 0o700};
	const stat = lstatDirectory(target, code);
	if (fs.readdirSync(target).length !== 0) fail('TARGET_NOT_EMPTY', 'Restore targets must be absent or empty');
	fs.accessSync(target, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
	return {path: target, parent, existedEmpty: true, mode: stat.mode & 0o777};
};

const restoreEmptyTarget = (target: RestoreTarget): void => {
	if (!target.existedEmpty || fs.existsSync(target.path)) return;
	fs.mkdirSync(target.path, {mode: target.mode});
};

const removePublishedRestoreTarget = (target: RestoreTarget, expected: fs.Stats | undefined): void => {
	if (!expected || !fs.existsSync(target.path) || path.dirname(target.path) !== target.parent) return;
	const current = lstatDirectory(target.path, 'UNSAFE_CLEANUP_SCOPE');
	if (current.dev !== expected.dev || current.ino !== expected.ino) fail('UNSAFE_CLEANUP_SCOPE', 'Refusing to clean a replaced restore target');
	fs.rmSync(target.path, {recursive: true, force: false});
};

const safeRemoveIncomplete = (target: string, expectedParent: string): void => {
	if (!fs.existsSync(target)) return;
	if (path.dirname(target) !== expectedParent || !path.basename(target).includes('.localcast-incomplete-')) {
		throw new BackupRestoreError('UNSAFE_CLEANUP_SCOPE', 'Refusing to clean an unexpected path');
	}
	lstatDirectory(target, 'UNSAFE_CLEANUP_SCOPE');
	fs.rmSync(target, {recursive: true, force: false});
};

const sha256File = (filePath: string, maximumBytes = Number.MAX_SAFE_INTEGER): string => {
	const stat = lstatRegularFile(filePath, 'ARTIFACT_INVALID', {singleLink: true});
	if (stat.size > maximumBytes) fail('ARTIFACT_TOO_LARGE', 'An artifact exceeds its size limit');
	const hash = createHash('sha256');
	const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
	try {
		const buffer = Buffer.allocUnsafe(1024 * 1024);
		let position = 0;
		for (;;) {
			const bytes = fs.readSync(descriptor, buffer, 0, buffer.length, position);
			if (bytes === 0) break;
			hash.update(buffer.subarray(0, bytes));
			position += bytes;
		}
	} finally {
		fs.closeSync(descriptor);
	}
	return hash.digest('hex');
};

const readBoundedPrivateText = (filePath: string, maximumBytes: number, code: string): string => {
	const stat = lstatRegularFile(filePath, code, {singleLink: true, privateMode: true});
	if (stat.size <= 0 || stat.size > maximumBytes) fail(code, 'A control artifact has an invalid size');
	return fs.readFileSync(filePath, 'utf8');
};

const copyRegularFile = (source: string, destination: string, maximumBytes: number, expected?: {bytes: number; sha256: string}): {bytes: number; sha256: string} => {
	const before = lstatRegularFile(source, 'SOURCE_FILE_INVALID', {singleLink: true});
	if (before.size > maximumBytes) fail('SIZE_LIMIT_EXCEEDED', 'A source file exceeds the configured size limit');
	if (expected && (before.size !== expected.bytes || sha256File(source, maximumBytes) !== expected.sha256)) {
		fail('SOURCE_MEDIA_MISMATCH', 'Published media does not match its database record');
	}
	const input = fs.openSync(source, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
	const output = fs.openSync(destination, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
	const hash = createHash('sha256');
	let bytes = 0;
	try {
		const buffer = Buffer.allocUnsafe(1024 * 1024);
		for (;;) {
			const read = fs.readSync(input, buffer, 0, buffer.length, bytes);
			if (read === 0) break;
			bytes += read;
			if (bytes > maximumBytes) fail('SIZE_LIMIT_EXCEEDED', 'A source file exceeds the configured size limit');
			hash.update(buffer.subarray(0, read));
			let written = 0;
			while (written < read) written += fs.writeSync(output, buffer, written, read - written);
		}
		fs.fsyncSync(output);
	} finally {
		fs.closeSync(output);
		fs.closeSync(input);
	}
	const after = lstatRegularFile(source, 'SOURCE_FILE_CHANGED', {singleLink: true});
	if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
		fail('SOURCE_FILE_CHANGED', 'A source file changed during backup');
	}
	const sha256 = hash.digest('hex');
	if (expected && (bytes !== expected.bytes || sha256 !== expected.sha256)) fail('SOURCE_MEDIA_MISMATCH', 'Published media does not match its database record');
	return {bytes, sha256};
};

const canonicalValue = (value: unknown): unknown => {
	if (Array.isArray(value)) return value.map(canonicalValue);
	if (value && typeof value === 'object') {
		return Object.fromEntries(Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, entry]) => [key, canonicalValue(entry)]));
	}
	return value;
};

export const canonicalJson = (value: unknown): string => `${JSON.stringify(canonicalValue(value), null, 2)}\n`;

const writePrivateFile = (filePath: string, value: string | Buffer): void => {
	fs.writeFileSync(filePath, value, {flag: 'wx', mode: 0o600});
	fs.chmodSync(filePath, 0o600);
};

const scalarCount = (database: Database.Database, sql: string): number => {
	const row = database.prepare(sql).get() as {value: number};
	if (!Number.isSafeInteger(row.value) || row.value < 0) fail('DATABASE_VALIDATION_FAILED', 'A database count is invalid');
	return row.value;
};

const requireZero = (database: Database.Database, sql: string, code: string): void => {
	if (scalarCount(database, sql) !== 0) fail(code, 'Database validation found an invalid or active record');
};

const validateDatabase = (databasePath: string): InternalValidation => {
	const databaseStat = lstatRegularFile(databasePath, 'DATABASE_INVALID', {singleLink: true});
	if (databaseStat.size <= 0 || databaseStat.size > MAX_DATABASE_BYTES) fail('DATABASE_INVALID', 'The database size is invalid');
	const database = new Database(databasePath, {readonly: true, fileMustExist: true});
	try {
		database.pragma('query_only = ON');
		database.pragma('foreign_keys = ON');
		const migrations = (database.prepare('SELECT id FROM schema_migrations ORDER BY rowid').all() as Array<{id: string}>).map(row => row.id);
		if (canonicalJson(migrations) !== canonicalJson(migrationIds)) fail('SCHEMA_INCOMPATIBLE', 'The migration ledger is not the supported schema');
		const quickCheck = database.pragma('quick_check') as Array<{quick_check: string}>;
		if (quickCheck.length !== 1 || quickCheck[0]?.quick_check !== 'ok') fail('INTEGRITY_CHECK_FAILED', 'SQLite quick_check failed');
		if ((database.pragma('foreign_key_check') as unknown[]).length !== 0) fail('FOREIGN_KEY_CHECK_FAILED', 'SQLite foreign_key_check failed');
		const identities = database.prepare("SELECT value FROM localcast_metadata WHERE key = 'installation_id'").all() as Array<{value: string}>;
		if (identities.length !== 1 || typeof identities[0]?.value !== 'string' || identities[0].value.length < 16) fail('IDENTITY_INVALID', 'Installation identity cardinality is invalid');
		requireZero(database, "SELECT COUNT(*) AS value FROM generation_jobs WHERE state IN ('queued', 'running')", 'ACTIVE_WORK');
		requireZero(database, "SELECT COUNT(*) AS value FROM generation_attempts WHERE outcome = 'running'", 'ACTIVE_WORK');
		requireZero(database, "SELECT COUNT(*) AS value FROM chat_turns WHERE state IN ('queued', 'running')", 'ACTIVE_WORK');
		requireZero(database, "SELECT COUNT(*) AS value FROM chat_attempts WHERE outcome = 'running'", 'ACTIVE_WORK');
		requireZero(database, "SELECT COUNT(*) AS value FROM chat_provider_calls WHERE status <> 'finalized'", 'ACTIVE_WORK');
		requireZero(database, "SELECT COUNT(*) AS value FROM sources WHERE sync_lease_owner IS NOT NULL OR sync_lease_expires_at IS NOT NULL", 'ACTIVE_WORK');
		requireZero(database, `
			WITH expected(kind, material_id, source_id, source_name, title, body, author, url, occurred_at) AS (
				SELECT 'feed', si.id, si.source_id, s.name, si.title, si.content, COALESCE(si.author, ''), COALESCE(si.url, ''), COALESCE(si.published_at, si.gathered_at)
				FROM source_items si JOIN sources s ON s.id = si.source_id
				UNION ALL
				SELECT 'note', n.id, '', 'Pasted note', n.title, n.body, COALESCE(n.author, ''), COALESCE(n.original_url, ''), n.updated_at FROM notes n
			), differences AS (
				SELECT * FROM expected EXCEPT SELECT kind, material_id, source_id, source_name, title, body, author, url, occurred_at FROM material_fts
				UNION ALL
				SELECT kind, material_id, source_id, source_name, title, body, author, url, occurred_at FROM material_fts EXCEPT SELECT * FROM expected
			) SELECT COUNT(*) AS value FROM differences
		`, 'FTS_PARITY_FAILED');
		requireZero(database, `
			SELECT COUNT(*) AS value FROM episode_citations ec
			LEFT JOIN transcript_claims tc ON tc.id = ec.claim_id
			LEFT JOIN episode_evidence_snapshots es ON es.id = ec.snapshot_id
			WHERE tc.id IS NULL OR es.id IS NULL OR tc.run_id <> es.run_id
		`, 'RELATIONSHIP_VALIDATION_FAILED');
		requireZero(database, `
			SELECT COUNT(*) AS value FROM chat_citations cc
			LEFT JOIN chat_claims cl ON cl.id = cc.claim_id
			LEFT JOIN episode_evidence_snapshots es ON es.id = cc.snapshot_id
			WHERE cl.id IS NULL OR es.id IS NULL OR cl.run_id <> es.run_id
		`, 'RELATIONSHIP_VALIDATION_FAILED');
		requireZero(database, `
			SELECT COUNT(*) AS value FROM generation_jobs gj
			WHERE gj.attempt_count <> (SELECT COUNT(*) FROM generation_attempts ga WHERE ga.job_id = gj.id)
				OR (gj.state IN ('queued', 'running') AND gj.completed_at IS NOT NULL)
				OR (gj.state IN ('complete', 'failed') AND gj.completed_at IS NULL)
		`, 'RELATIONSHIP_VALIDATION_FAILED');
		requireZero(database, `
			SELECT COUNT(*) AS value FROM chat_turns ct
			WHERE ct.attempt_count <> (SELECT COUNT(*) FROM chat_attempts ca WHERE ca.turn_id = ct.id)
				OR (ct.state = 'answered' AND NOT EXISTS (SELECT 1 FROM chat_claims cc WHERE cc.turn_id = ct.id))
				OR (ct.state = 'refused' AND EXISTS (SELECT 1 FROM chat_claims cc WHERE cc.turn_id = ct.id))
		`, 'RELATIONSHIP_VALIDATION_FAILED');
		requireZero(database, `
			SELECT COUNT(*) AS value FROM chat_claims cc
			WHERE NOT EXISTS (SELECT 1 FROM chat_citations ci WHERE ci.claim_id = cc.id)
		`, 'RELATIONSHIP_VALIDATION_FAILED');
		const count = (table: string): number => scalarCount(database, `SELECT COUNT(*) AS value FROM ${table}`);
		const publishedEpisodes = scalarCount(database, `
			SELECT COUNT(*) AS value FROM briefing_runs br JOIN audio_assets aa ON aa.run_id = br.id
			WHERE br.status = 'complete' AND br.completed_at IS NOT NULL AND br.ai_generated = 1 AND br.script_format_version = 1
				AND aa.format = 'mp3' AND aa.mime_type = 'audio/mpeg' AND aa.storage_filename IS NOT NULL
				AND aa.validated_at IS NOT NULL AND aa.ai_generated = 1 AND aa.byte_length > 0 AND aa.duration_ms > 0 AND length(aa.sha256) = 64
				AND EXISTS (SELECT 1 FROM transcript_claims tc JOIN episode_citations ec ON ec.claim_id = tc.id WHERE tc.run_id = br.id AND tc.kind = 'factual' AND tc.support_status = 'supported')
				AND NOT EXISTS (SELECT 1 FROM transcript_claims tc WHERE tc.run_id = br.id AND tc.kind = 'factual' AND (tc.support_status <> 'supported' OR NOT EXISTS (SELECT 1 FROM episode_citations ec WHERE ec.claim_id = tc.id)))
		`);
		return {
			installationId: identities[0].value,
			public: {
				migrations,
				quickCheck: 'ok', foreignKeys: 'ok', identityCardinality: 'valid', quiescence: 'valid', ftsParity: 'valid', relationships: 'valid',
				counts: {
					sources: count('sources'), sourceItems: count('source_items'), notes: count('notes'), briefingRuns: count('briefing_runs'),
					generationJobs: count('generation_jobs'), generationAttempts: count('generation_attempts'), episodeEvidenceSnapshots: count('episode_evidence_snapshots'),
					transcriptClaims: count('transcript_claims'), episodeCitations: count('episode_citations'), chatTurns: count('chat_turns'),
					chatAttempts: count('chat_attempts'), chatProviderCalls: count('chat_provider_calls'), chatClaims: count('chat_claims'), chatCitations: count('chat_citations'), publishedEpisodes,
				},
			},
		};
	} finally {
		database.close();
	}
};

const listPublishedMedia = (databasePath: string): Array<{filename: string; bytes: number; sha256: string}> => {
	const database = new Database(databasePath, {readonly: true, fileMustExist: true});
	try {
		database.pragma('query_only = ON');
		return (database.prepare(`
			SELECT aa.storage_filename AS filename, aa.byte_length AS bytes, aa.sha256
			FROM briefing_runs br JOIN audio_assets aa ON aa.run_id = br.id
			WHERE br.status = 'complete' AND br.completed_at IS NOT NULL AND br.ai_generated = 1 AND br.script_format_version = 1
				AND aa.format = 'mp3' AND aa.mime_type = 'audio/mpeg' AND aa.storage_filename IS NOT NULL
				AND aa.validated_at IS NOT NULL AND aa.ai_generated = 1 AND aa.byte_length > 0 AND aa.duration_ms > 0 AND length(aa.sha256) = 64
				AND EXISTS (SELECT 1 FROM transcript_claims tc JOIN episode_citations ec ON ec.claim_id = tc.id WHERE tc.run_id = br.id AND tc.kind = 'factual' AND tc.support_status = 'supported')
				AND NOT EXISTS (SELECT 1 FROM transcript_claims tc WHERE tc.run_id = br.id AND tc.kind = 'factual' AND (tc.support_status <> 'supported' OR NOT EXISTS (SELECT 1 FROM episode_citations ec WHERE ec.claim_id = tc.id)))
			ORDER BY aa.storage_filename
			LIMIT ${MAX_MEDIA_FILES + 1}
		`).all() as Array<{filename: string; bytes: number; sha256: string}>);
	} finally {
		database.close();
	}
};

const safeMediaFilename = (filename: string): string => {
	if (typeof filename !== 'string' || Buffer.byteLength(filename) > MAX_PATH_BYTES || filename !== path.basename(filename) || filename.startsWith('.') || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.mp3$/.test(filename)) {
		fail('UNSAFE_MEDIA_PATH', 'A published media filename is unsafe');
	}
	return filename;
};

const equalValidation = (left: InternalValidation, right: InternalValidation): boolean => (
	left.installationId === right.installationId && canonicalJson(left.public) === canonicalJson(right.public)
);

const normalizeStandaloneDatabase = (databasePath: string): void => {
	const database = new Database(databasePath, {fileMustExist: true});
	try {
		const mode = database.pragma('journal_mode = DELETE', {simple: true});
		if (String(mode).toLowerCase() !== 'delete') fail('DATABASE_PUBLICATION_FAILED', 'The standalone backup journal mode could not be normalized');
	} finally {
		database.close();
	}
};

const checksumLine = (sha256: string, artifactPath: string): string => `${sha256}  ${artifactPath}\n`;

const collectFiles = (root: string): string[] => {
	const output: string[] = [];
	let directoryCount = 0;
	const visit = (relative: string, depth = 0): void => {
		if (depth > 3 || directoryCount > MAX_MEDIA_FILES + 10) fail('ARTIFACT_TOO_COMPLEX', 'The backup directory structure exceeds its bounds');
		directoryCount += 1;
		lstatDirectory(path.join(root, relative), 'ARTIFACT_INVALID', {privateMode: true});
		for (const entry of fs.readdirSync(path.join(root, relative), {withFileTypes: true})) {
			const child = relative ? `${relative}/${entry.name}` : entry.name;
			if (Buffer.byteLength(child) > MAX_PATH_BYTES + 32) fail('ARTIFACT_TOO_COMPLEX', 'An artifact path exceeds its bound');
			if (entry.isSymbolicLink()) fail('ARTIFACT_INVALID', 'Symlinks are not permitted in a backup');
			if (entry.isDirectory()) visit(child, depth + 1);
			else if (entry.isFile()) {
				output.push(child);
				if (output.length > MAX_MEDIA_FILES + 10) fail('ARTIFACT_TOO_COMPLEX', 'The backup contains too many artifacts');
			}
			else fail('ARTIFACT_INVALID', 'Special files are not permitted in a backup');
		}
	};
	visit('');
	return output.sort();
};

const parseManifest = (backupRoot: string): BackupManifest => {
	const manifestPath = path.join(backupRoot, MANIFEST_ARTIFACT);
	const stat = lstatRegularFile(manifestPath, 'MANIFEST_INVALID', {singleLink: true, privateMode: true});
	if (stat.size <= 0 || stat.size > MAX_MANIFEST_BYTES) fail('MANIFEST_INVALID', 'The manifest size is invalid');
	const source = fs.readFileSync(manifestPath, 'utf8');
	let value: unknown;
	try { value = JSON.parse(source) as unknown; } catch { return fail('MANIFEST_INVALID', 'The manifest is not valid JSON'); }
	if (canonicalJson(value) !== source) fail('MANIFEST_NOT_CANONICAL', 'The manifest is not canonical');
	const manifest = value as BackupManifest;
	if (manifest.formatVersion !== LOCALCAST_BACKUP_FORMAT_VERSION || manifest.compatibility?.applicationVersion !== LOCALCAST_BACKUP_APPLICATION_VERSION || manifest.compatibility?.schemaMigration !== migrationIds.at(-1)) {
		fail('BACKUP_INCOMPATIBLE', 'The backup format, application, or schema is unsupported');
	}
	if (
		manifest.database?.path !== DATABASE_ARTIFACT
		|| !Number.isSafeInteger(manifest.database.bytes) || manifest.database.bytes <= 0 || manifest.database.bytes > MAX_DATABASE_BYTES
		|| !/^[a-f0-9]{64}$/.test(manifest.database.sha256)
		|| typeof manifest.createdAt !== 'string' || !Number.isFinite(Date.parse(manifest.createdAt))
		|| !Array.isArray(manifest.media?.files)
		|| !Number.isSafeInteger(manifest.media.fileCount) || manifest.media.fileCount < 0
		|| !Number.isSafeInteger(manifest.media.totalBytes) || manifest.media.totalBytes < 0
		|| !Number.isSafeInteger(manifest.limits?.maximumMediaBytes) || manifest.limits.maximumMediaBytes <= 0
		|| !Number.isSafeInteger(manifest.limits?.maximumMediaFiles)
		|| !Number.isSafeInteger(manifest.limits?.maximumPathBytes)
		|| !manifest.validation || typeof manifest.validation !== 'object'
	) fail('MANIFEST_INVALID', 'The manifest structure is invalid');
	for (const entry of manifest.media.files) {
		if (!entry || typeof entry.path !== 'string' || !Number.isSafeInteger(entry.bytes) || entry.bytes <= 0 || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
			fail('MANIFEST_INVALID', 'A media manifest entry is invalid');
		}
	}
	return manifest;
};

export const verifyBackupArtifact = (backupPathValue: string): {manifest: BackupManifest; validation: InternalValidation} => {
	const backupPath = requireAbsolutePath(backupPathValue, 'BACKUP_PATH_INVALID');
	lstatDirectory(backupPath, 'BACKUP_INVALID', {privateMode: true});
	const files = collectFiles(backupPath);
	const manifest = parseManifest(backupPath);
	if (manifest.media.fileCount !== manifest.media.files.length || manifest.media.fileCount > MAX_MEDIA_FILES || manifest.media.totalBytes > manifest.limits.maximumMediaBytes || manifest.limits.maximumMediaFiles !== MAX_MEDIA_FILES || manifest.limits.maximumPathBytes !== MAX_PATH_BYTES) {
		fail('MANIFEST_INVALID', 'The manifest limits or media totals are invalid');
	}
	const expectedDataFiles = [DATABASE_ARTIFACT, MANIFEST_ARTIFACT, VALIDATION_ARTIFACT, ...manifest.media.files.map(entry => entry.path)].sort();
	const expectedAllFiles = [...expectedDataFiles, CHECKSUM_ARTIFACT, CHECKSUM_ROOT_ARTIFACT].sort();
	if (canonicalJson(files) !== canonicalJson(expectedAllFiles)) fail('ARTIFACT_SET_MISMATCH', 'The backup contains missing or extra artifacts');
	const checksumSource = readBoundedPrivateText(path.join(backupPath, CHECKSUM_ARTIFACT), MAX_CHECKSUM_BYTES, 'CHECKSUM_INVALID');
	const checksumRoot = readBoundedPrivateText(path.join(backupPath, CHECKSUM_ROOT_ARTIFACT), 256, 'CHECKSUM_INVALID');
	const expectedRoot = checksumLine(createHash('sha256').update(checksumSource).digest('hex'), CHECKSUM_ARTIFACT);
	if (checksumRoot !== expectedRoot) fail('CHECKSUM_MISMATCH', 'The checksum root is invalid');
	const expectedChecksumSource = expectedDataFiles.map(relative => checksumLine(sha256File(path.join(backupPath, relative)), relative)).join('');
	if (checksumSource !== expectedChecksumSource) fail('CHECKSUM_MISMATCH', 'An artifact checksum is invalid');
	const databasePath = path.join(backupPath, DATABASE_ARTIFACT);
	const databaseStat = lstatRegularFile(databasePath, 'DATABASE_INVALID', {singleLink: true, privateMode: true});
	if (databaseStat.size !== manifest.database.bytes || sha256File(databasePath, MAX_DATABASE_BYTES) !== manifest.database.sha256) fail('CHECKSUM_MISMATCH', 'The database artifact does not match its manifest');
	let mediaBytes = 0;
	const names = new Set<string>();
	for (const entry of manifest.media.files) {
		if (entry.path !== `media/${safeMediaFilename(path.basename(entry.path))}` || names.has(entry.path)) fail('MANIFEST_INVALID', 'A media manifest path is invalid or duplicated');
		names.add(entry.path);
		const stat = lstatRegularFile(path.join(backupPath, entry.path), 'MEDIA_ARTIFACT_INVALID', {singleLink: true, privateMode: true});
		if (stat.size !== entry.bytes || sha256File(path.join(backupPath, entry.path), manifest.limits.maximumMediaBytes) !== entry.sha256) fail('CHECKSUM_MISMATCH', 'A media artifact does not match its manifest');
		mediaBytes += entry.bytes;
	}
	if (mediaBytes !== manifest.media.totalBytes) fail('MANIFEST_INVALID', 'The media byte total is invalid');
	const validationSource = readBoundedPrivateText(path.join(backupPath, VALIDATION_ARTIFACT), MAX_VALIDATION_BYTES, 'VALIDATION_INVALID');
	if (validationSource !== canonicalJson(manifest.validation)) fail('VALIDATION_MISMATCH', 'The validation record does not match the manifest');
	const validation = validateDatabase(databasePath);
	if (canonicalJson(validation.public) !== canonicalJson(manifest.validation)) fail('VALIDATION_MISMATCH', 'The database no longer matches its validation record');
	const databaseMedia = listPublishedMedia(databasePath).map(entry => ({path: `media/${safeMediaFilename(entry.filename)}`, bytes: entry.bytes, sha256: entry.sha256}));
	if (canonicalJson(databaseMedia) !== canonicalJson(manifest.media.files)) fail('MEDIA_DATABASE_MISMATCH', 'The media manifest does not match the database publication records');
	return {manifest, validation};
};

export const createVersionedBackup = async (options: CreateBackupOptions): Promise<BackupManifest> => {
	const databasePath = requireAbsolutePath(options.databasePath, 'DATABASE_PATH_INVALID');
	const mediaPath = requireAbsolutePath(options.mediaPath, 'MEDIA_PATH_INVALID');
	const destinationPath = requireAbsolutePath(options.destinationPath, 'DESTINATION_PATH_INVALID');
	if (!Number.isSafeInteger(options.maximumMediaBytes) || options.maximumMediaBytes <= 0) fail('MEDIA_LIMIT_INVALID', 'A positive explicit media-byte limit is required');
	if (fs.existsSync(destinationPath)) fail('DESTINATION_EXISTS', 'The backup destination must not exist');
	const destinationParent = requireSafeParent(destinationPath, 'DESTINATION_PARENT_INVALID');
	if (path.dirname(destinationPath) !== destinationParent) fail('DESTINATION_PARENT_INVALID', 'The destination parent must be canonical');
	if (path.resolve(databasePath).startsWith(`${destinationPath}${path.sep}`) || path.resolve(mediaPath).startsWith(`${destinationPath}${path.sep}`)) fail('PATH_OVERLAP', 'Backup source and destination paths overlap');
	lstatDirectory(mediaPath, 'MEDIA_PATH_INVALID');
	const stagingPath = path.join(destinationParent, `.${path.basename(destinationPath)}.localcast-incomplete-${randomUUID()}`);
	const previousUmask = process.umask(0o077);
	try {
		fs.mkdirSync(stagingPath, {mode: 0o700});
		fs.mkdirSync(path.join(stagingPath, 'database'), {mode: 0o700});
		fs.mkdirSync(path.join(stagingPath, 'media'), {mode: 0o700});
		const sourceValidation = validateDatabase(databasePath);
		options.onPhase?.('source-validated');
		const sourceDatabase = new Database(databasePath, {readonly: true, fileMustExist: true});
		try {
			sourceDatabase.pragma('query_only = ON');
			const dataVersion = Number(sourceDatabase.pragma('data_version', {simple: true}));
			await sourceDatabase.backup(path.join(stagingPath, DATABASE_ARTIFACT));
			normalizeStandaloneDatabase(path.join(stagingPath, DATABASE_ARTIFACT));
			fs.chmodSync(path.join(stagingPath, DATABASE_ARTIFACT), 0o600);
			options.onPhase?.('database-copied');
			const mediaRecords = listPublishedMedia(databasePath);
			if (mediaRecords.length !== sourceValidation.public.counts.publishedEpisodes || mediaRecords.length > MAX_MEDIA_FILES) fail('MEDIA_COUNT_INVALID', 'The published media count is invalid');
			const seen = new Set<string>();
			const mediaEntries: MediaManifestEntry[] = [];
			let mediaTotalBytes = 0;
			for (const record of mediaRecords) {
				const filename = safeMediaFilename(record.filename);
				if (seen.has(filename)) fail('DUPLICATE_MEDIA_PATH', 'Published media filenames must be unique');
				seen.add(filename);
				if (!Number.isSafeInteger(record.bytes) || record.bytes <= 0 || !/^[a-f0-9]{64}$/.test(record.sha256)) fail('MEDIA_RECORD_INVALID', 'A published media record is invalid');
				if (mediaTotalBytes + record.bytes > options.maximumMediaBytes) fail('MEDIA_LIMIT_EXCEEDED', 'Published media exceeds the operator limit');
				const copied = copyRegularFile(path.join(mediaPath, filename), path.join(stagingPath, 'media', filename), options.maximumMediaBytes - mediaTotalBytes, {bytes: record.bytes, sha256: record.sha256});
				mediaTotalBytes += copied.bytes;
				mediaEntries.push({path: `media/${filename}`, bytes: copied.bytes, sha256: copied.sha256});
			}
			options.onPhase?.('media-copied');
			const copiedValidation = validateDatabase(path.join(stagingPath, DATABASE_ARTIFACT));
			if (!equalValidation(sourceValidation, copiedValidation)) fail('SOURCE_COPY_MISMATCH', 'The copied database does not match its source validation');
			if (Number(sourceDatabase.pragma('data_version', {simple: true})) !== dataVersion) fail('SOURCE_CHANGED', 'The source database changed during backup');
			const databaseStat = fs.statSync(path.join(stagingPath, DATABASE_ARTIFACT));
			const manifest: BackupManifest = {
				formatVersion: 1,
				createdAt: options.createdAt ?? new Date().toISOString(),
				compatibility: {applicationVersion: LOCALCAST_BACKUP_APPLICATION_VERSION, schemaMigration: migrationIds.at(-1) || ''},
				database: {path: DATABASE_ARTIFACT, bytes: databaseStat.size, sha256: sha256File(path.join(stagingPath, DATABASE_ARTIFACT), MAX_DATABASE_BYTES)},
				media: {files: mediaEntries, fileCount: mediaEntries.length, totalBytes: mediaTotalBytes},
				limits: {maximumMediaBytes: options.maximumMediaBytes, maximumMediaFiles: MAX_MEDIA_FILES, maximumPathBytes: MAX_PATH_BYTES},
				validation: copiedValidation.public,
			};
			writePrivateFile(path.join(stagingPath, MANIFEST_ARTIFACT), canonicalJson(manifest));
			writePrivateFile(path.join(stagingPath, VALIDATION_ARTIFACT), canonicalJson(manifest.validation));
			const dataFiles = [DATABASE_ARTIFACT, MANIFEST_ARTIFACT, VALIDATION_ARTIFACT, ...mediaEntries.map(entry => entry.path)].sort();
			const sums = dataFiles.map(relative => checksumLine(sha256File(path.join(stagingPath, relative)), relative)).join('');
			writePrivateFile(path.join(stagingPath, CHECKSUM_ARTIFACT), sums);
			writePrivateFile(path.join(stagingPath, CHECKSUM_ROOT_ARTIFACT), checksumLine(createHash('sha256').update(sums).digest('hex'), CHECKSUM_ARTIFACT));
			verifyBackupArtifact(stagingPath);
			options.onPhase?.('artifact-verified');
			fs.renameSync(stagingPath, destinationPath);
			options.onPhase?.('artifact-published');
			return manifest;
		} finally {
			sourceDatabase.close();
		}
	} catch (error) {
		safeRemoveIncomplete(stagingPath, destinationParent);
		throw error;
	} finally {
		process.umask(previousUmask);
	}
};

const writeStorageMarker = (directory: string, installationId: string): void => {
	writePrivateFile(path.join(directory, MARKER_FILE), canonicalJson({format: 1, installationId}));
};

export const restoreVersionedBackup = (options: RestoreBackupOptions): BackupManifest => {
	const backupPath = requireAbsolutePath(options.backupPath, 'BACKUP_PATH_INVALID');
	const dataTargetPath = requireAbsolutePath(options.dataTargetPath, 'DATA_TARGET_INVALID');
	const mediaTargetPath = requireAbsolutePath(options.mediaTargetPath, 'MEDIA_TARGET_INVALID');
	if (dataTargetPath === mediaTargetPath || dataTargetPath.startsWith(`${mediaTargetPath}${path.sep}`) || mediaTargetPath.startsWith(`${dataTargetPath}${path.sep}`)) fail('TARGET_OVERLAP', 'Restore targets must be distinct');
	if (dataTargetPath.startsWith(`${backupPath}${path.sep}`) || mediaTargetPath.startsWith(`${backupPath}${path.sep}`) || backupPath.startsWith(`${dataTargetPath}${path.sep}`) || backupPath.startsWith(`${mediaTargetPath}${path.sep}`)) fail('PATH_OVERLAP', 'Backup and restore target paths must be distinct');
	const dataTarget = prepareRestoreTarget(dataTargetPath, 'DATA_TARGET_INVALID');
	const mediaTarget = prepareRestoreTarget(mediaTargetPath, 'MEDIA_TARGET_INVALID');
	const dataParent = dataTarget.parent;
	const mediaParent = mediaTarget.parent;
	const verified = verifyBackupArtifact(backupPath);
	options.onPhase?.('artifact-verified');
	const dataStage = path.join(dataParent, `.${path.basename(dataTargetPath)}.localcast-incomplete-${randomUUID()}`);
	const mediaStage = path.join(mediaParent, `.${path.basename(mediaTargetPath)}.localcast-incomplete-${randomUUID()}`);
	const previousUmask = process.umask(0o077);
	let dataPublished = false;
	let mediaPublished = false;
	let dataPublishedStat: fs.Stats | undefined;
	let mediaPublishedStat: fs.Stats | undefined;
	try {
		fs.mkdirSync(dataStage, {mode: 0o700});
		fs.mkdirSync(mediaStage, {mode: 0o700});
		copyRegularFile(path.join(backupPath, DATABASE_ARTIFACT), path.join(dataStage, 'localcast.sqlite'), MAX_DATABASE_BYTES, {bytes: verified.manifest.database.bytes, sha256: verified.manifest.database.sha256});
		options.onPhase?.('restore-database-copied');
		let restoredBytes = 0;
		for (const entry of verified.manifest.media.files) {
			const filename = safeMediaFilename(path.basename(entry.path));
			copyRegularFile(path.join(backupPath, entry.path), path.join(mediaStage, filename), verified.manifest.limits.maximumMediaBytes - restoredBytes, {bytes: entry.bytes, sha256: entry.sha256});
			restoredBytes += entry.bytes;
		}
		options.onPhase?.('restore-media-copied');
		const restoredValidation = validateDatabase(path.join(dataStage, 'localcast.sqlite'));
		if (!equalValidation(verified.validation, restoredValidation)) fail('RESTORE_VALIDATION_FAILED', 'The restored database does not match the validated backup');
		writeStorageMarker(dataStage, restoredValidation.installationId);
		writeStorageMarker(mediaStage, restoredValidation.installationId);
		if (dataTarget.existedEmpty) {
			if (fs.readdirSync(dataTargetPath).length !== 0) fail('TARGET_CHANGED', 'A restore target changed before publication');
			fs.rmdirSync(dataTargetPath);
		}
		fs.renameSync(dataStage, dataTargetPath);
		dataPublished = true;
		dataPublishedStat = lstatDirectory(dataTargetPath, 'RESTORE_PUBLICATION_FAILED');
		if (mediaTarget.existedEmpty) {
			if (fs.readdirSync(mediaTargetPath).length !== 0) fail('TARGET_CHANGED', 'A restore target changed before publication');
			fs.rmdirSync(mediaTargetPath);
		}
		fs.renameSync(mediaStage, mediaTargetPath);
		mediaPublished = true;
		mediaPublishedStat = lstatDirectory(mediaTargetPath, 'RESTORE_PUBLICATION_FAILED');
		options.onPhase?.('restore-published');
		return verified.manifest;
	} catch (error) {
		if (dataPublished) removePublishedRestoreTarget(dataTarget, dataPublishedStat);
		if (mediaPublished) removePublishedRestoreTarget(mediaTarget, mediaPublishedStat);
		safeRemoveIncomplete(dataStage, dataParent);
		safeRemoveIncomplete(mediaStage, mediaParent);
		restoreEmptyTarget(dataTarget);
		restoreEmptyTarget(mediaTarget);
		throw error;
	} finally {
		process.umask(previousUmask);
	}
};
