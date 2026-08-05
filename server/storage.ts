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

const readMarker = (directory: string): z.infer<typeof markerSchema> => {
	const filePath = markerPath(directory);
	let value: unknown;

	try {
		value = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
	} catch {
		throw new Error(`LocalCast storage marker is missing or unreadable: ${filePath}`);
	}

	const parsed = markerSchema.safeParse(value);
	if (!parsed.success) {
		throw new Error(`LocalCast storage marker is invalid: ${filePath}`);
	}

	return parsed.data;
};

const assertWritableDirectory = (directory: string): void => {
	const stat = fs.statSync(directory);
	if (!stat.isDirectory()) throw new Error(`LocalCast storage path is not a directory: ${directory}`);
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
