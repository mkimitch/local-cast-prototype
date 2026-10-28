import fs from 'node:fs';
import path from 'node:path';
import {z} from 'zod';
import type {ServerConfig} from './config';

const markerFileName = '.localcast-installation.json';
const markerSchema = z.object({
	format: z.literal(1),
	installationId: z.string().min(16),
});

const databaseDirectory = (config: ServerConfig): string => path.dirname(config.databasePath);
const markerPath = (directory: string): string => path.join(directory, markerFileName);

const lstatRegularSingleLinkFile = (filePath: string, label: string, options: {privateMode?: boolean} = {}): fs.Stats => {
	let stat: fs.Stats;
	try {
		stat = fs.lstatSync(filePath);
	} catch {
		throw new Error(`LocalCast ${label} is missing or unreadable: ${filePath}`);
	}
	if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
		throw new Error(`LocalCast ${label} must be a regular non-symlink single-link file: ${filePath}`);
	}
	if (options.privateMode && (stat.mode & 0o077) !== 0) {
		throw new Error(`LocalCast ${label} must not be accessible to group or other users: ${filePath}`);
	}
	return stat;
};

const readMarker = (directory: string): z.infer<typeof markerSchema> => {
	const filePath = markerPath(directory);
	let value: unknown;
	const stat = lstatRegularSingleLinkFile(filePath, 'storage marker', {privateMode: true});
	if (stat.size <= 0 || stat.size > 4_096) throw new Error(`LocalCast storage marker has an invalid size: ${filePath}`);
	let descriptor: number;
	try {
		descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
	} catch {
		throw new Error(`LocalCast storage marker is missing or unreadable: ${filePath}`);
	}

	try {
		const opened = fs.fstatSync(descriptor);
		if (opened.dev !== stat.dev || opened.ino !== stat.ino || opened.nlink !== 1) {
			throw new Error('Storage marker changed while opening');
		}
		value = JSON.parse(fs.readFileSync(descriptor, 'utf8')) as unknown;
	} catch {
		throw new Error(`LocalCast storage marker is missing or unreadable: ${filePath}`);
	} finally {
		fs.closeSync(descriptor);
	}

	const parsed = markerSchema.safeParse(value);
	if (!parsed.success) {
		throw new Error(`LocalCast storage marker is invalid: ${filePath}`);
	}

	return parsed.data;
};

const assertWritableDirectory = (directory: string): void => {
	const stat = fs.lstatSync(directory);
	if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`LocalCast storage path is not a non-symlink directory: ${directory}`);
	fs.accessSync(directory, fs.constants.R_OK | fs.constants.W_OK);
};

const assertDistinctStorageDirectories = (dataDirectory: string, mediaDirectory: string): void => {
	if (fs.realpathSync(dataDirectory) === fs.realpathSync(mediaDirectory)) {
		throw new Error('LocalCast database and media directories must resolve to distinct storage');
	}
};

const writeMarkerAtomically = (directory: string, installationId: string): void => {
	const target = markerPath(directory);
	const temporary = `${target}.${process.pid}.tmp`;
	fs.writeFileSync(temporary, `${JSON.stringify({format: 1, installationId})}\n`, {encoding: 'utf8', flag: 'wx', mode: 0o600});
	fs.renameSync(temporary, target);
};

const assertSafeToInitialize = (directory: string, allowedExistingNames: string[]): void => {
	if (!fs.existsSync(directory)) return;
	assertWritableDirectory(directory);

	const unexpected = fs.readdirSync(directory).filter(name => !allowedExistingNames.includes(name));
	if (unexpected.length > 0) {
		throw new Error(`Refusing to initialize non-empty LocalCast storage directory: ${directory}`);
	}
};

export const initializeStorage = (config: ServerConfig): void => {
	if (config.runtimeMode !== 'production' || !config.installationId) {
		throw new Error('Storage initialization requires production mode and LOCALCAST_INSTALLATION_ID');
	}

	const dataDirectory = databaseDirectory(config);
	const mediaDirectory = config.mediaPath;
	const databaseName = path.basename(config.databasePath);
	const dataMarkerExists = fs.existsSync(markerPath(dataDirectory));
	const mediaMarkerExists = fs.existsSync(markerPath(mediaDirectory));

	if (dataMarkerExists || mediaMarkerExists) {
		if (!dataMarkerExists || !mediaMarkerExists) {
			throw new Error('LocalCast storage initialization is incomplete; both installation markers are required');
		}
		verifyStorage(config);
		return;
	}

	assertSafeToInitialize(dataDirectory, [databaseName, `${databaseName}-wal`, `${databaseName}-shm`]);
	assertSafeToInitialize(mediaDirectory, []);
	for (const candidate of [config.databasePath, `${config.databasePath}-wal`, `${config.databasePath}-shm`]) {
		if (fs.existsSync(candidate)) lstatRegularSingleLinkFile(candidate, 'database storage file');
	}
	fs.mkdirSync(dataDirectory, {recursive: true, mode: 0o750});
	fs.mkdirSync(mediaDirectory, {recursive: true, mode: 0o750});
	assertWritableDirectory(dataDirectory);
	assertWritableDirectory(mediaDirectory);
	assertDistinctStorageDirectories(dataDirectory, mediaDirectory);

	writeMarkerAtomically(dataDirectory, config.installationId);
	try {
		writeMarkerAtomically(mediaDirectory, config.installationId);
	} catch (error) {
		fs.unlinkSync(markerPath(dataDirectory));
		throw error;
	}
};

export const verifyStorage = (config: ServerConfig, options: {allowMissingDatabase?: boolean} = {}): void => {
	if (config.databasePath === ':memory:') return;

	const dataDirectory = databaseDirectory(config);
	const mediaDirectory = config.mediaPath;

	if (config.runtimeMode !== 'production') {
		fs.mkdirSync(dataDirectory, {recursive: true});
		fs.mkdirSync(mediaDirectory, {recursive: true});
		assertWritableDirectory(dataDirectory);
		assertWritableDirectory(mediaDirectory);
		return;
	}

	if (!config.installationId) throw new Error('Production storage verification requires an installation ID');
	if (!options.allowMissingDatabase && !fs.existsSync(config.databasePath)) {
		throw new Error(`Initialized LocalCast database is missing: ${config.databasePath}`);
	}
	if (fs.existsSync(config.databasePath)) lstatRegularSingleLinkFile(config.databasePath, 'database file');

	assertWritableDirectory(dataDirectory);
	assertWritableDirectory(mediaDirectory);
	assertDistinctStorageDirectories(dataDirectory, mediaDirectory);
	const dataMarker = readMarker(dataDirectory);
	const mediaMarker = readMarker(mediaDirectory);

	if (dataMarker.installationId !== config.installationId || mediaMarker.installationId !== config.installationId) {
		throw new Error('LocalCast storage installation markers do not match this deployment');
	}
};

export const storageMarkerPaths = (config: ServerConfig): {data: string; media: string} => ({
	data: markerPath(databaseDirectory(config)),
	media: markerPath(config.mediaPath),
});
