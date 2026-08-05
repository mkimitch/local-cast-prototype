import dotenv from 'dotenv';
import path from 'node:path';
import {z} from 'zod';

dotenv.config();

export const providerStatuses = ['LIVE VERIFIED', 'CONTRACT TESTED ONLY', 'NOT CONFIGURED'] as const;
export type ProviderStatus = typeof providerStatuses[number];
export type RuntimeMode = 'development' | 'test' | 'production';
export type ProcessRole = 'app' | 'worker' | 'storage-init';
export type BackendTextProvider = 'not_configured' | 'fake';
export type BackendSpeechProvider = 'not_configured' | 'fake';

const nonEmptyString = z.string().trim().min(1);

const optionalBoolean = z.preprocess(value => {
	if (value === undefined || value === '') return false;
	if (typeof value === 'boolean') return value;
	if (typeof value === 'string') {
		const normalized = value.trim().toLowerCase();
		if (normalized === 'true') return true;
		if (normalized === 'false') return false;
	}
	return value;
}, z.boolean());

const optionalPort = z.preprocess(value => value === undefined || value === '' ? 8787 : Number(value), z.number().int().min(1).max(65535));

const rawEnvironmentSchema = z.object({
	LOCALCAST_RUNTIME_MODE: z.enum(['development', 'test', 'production']),
	NODE_ENV: z.enum(['development', 'test', 'production']).optional(),
	LOCALCAST_PROCESS_ROLE: z.enum(['app', 'worker', 'storage-init']).optional(),
	LOCALCAST_HOST: nonEmptyString.optional(),
	PORT: optionalPort,
	DATABASE_PATH: nonEmptyString.optional(),
	MEDIA_PATH: nonEmptyString.optional(),
	LOCALCAST_WEB_DIST_PATH: nonEmptyString.optional(),
	LOCALCAST_INSTALLATION_ID: nonEmptyString.optional(),
	LOCALCAST_TRUSTED_ORIGINS: z.string().optional(),
	CORS_ORIGIN: z.string().optional(),
	TEXT_PROVIDER: z.enum(['not_configured', 'fake']).optional(),
	SPEECH_PROVIDER: z.enum(['not_configured', 'fake']).optional(),
	LOCALCAST_ALLOW_FAKE_PROVIDERS: optionalBoolean,
	LOCALCAST_FAKE_FAILURE_PHASE: z.enum(['syncing', 'selecting', 'drafting', 'validating', 'rendering_audio']).optional(),
	LOCALCAST_FAKE_PHASE_DELAY_MS: z.preprocess(value => value === undefined || value === '' ? 0 : Number(value), z.number().int().min(0).max(10000)),
	LOCALCAST_FAKE_DELAY_PHASE: z.enum(['syncing', 'selecting', 'drafting', 'validating', 'rendering_audio']).optional(),
	LOCALCAST_FAKE_AFTER_PUBLICATION_DELAY_MS: z.preprocess(value => value === undefined || value === '' ? 0 : Number(value), z.number().int().min(0).max(10000)),
	LOCALCAST_WORKER_ID: nonEmptyString.optional(),
	LOCALCAST_WORKER_POLL_MS: z.preprocess(value => value === undefined || value === '' ? 250 : Number(value), z.number().int().min(25).max(60000)),
	LOCALCAST_LEASE_MS: z.preprocess(value => value === undefined || value === '' ? 30000 : Number(value), z.number().int().min(1000).max(300000)),
	LOCALCAST_SHUTDOWN_MS: z.preprocess(value => value === undefined || value === '' ? 10000 : Number(value), z.number().int().min(500).max(30000)),
	RSS_SYNC_ON_START: z.string().optional(),
	RSS_SYNC_INTERVAL_MINUTES: z.string().optional(),
}).passthrough();

export interface ServerConfig {
	runtimeMode: RuntimeMode;
	processRole: ProcessRole;
	host: string;
	port: number;
	databasePath: string;
	mediaPath: string;
	webDistPath: string;
	installationId?: string;
	trustedOrigins: string[];
	textProvider: BackendTextProvider;
	speechProvider: BackendSpeechProvider;
	allowFakeProviders: boolean;
	fakeFailurePhase?: 'syncing' | 'selecting' | 'drafting' | 'validating' | 'rendering_audio';
	fakePhaseDelayMs: number;
	fakeDelayPhase?: 'syncing' | 'selecting' | 'drafting' | 'validating' | 'rendering_audio';
	fakeAfterPublicationDelayMs: number;
	workerId: string;
	workerPollMs: number;
	leaseMs: number;
	shutdownMs: number;
}

const splitOrigins = (value: string | undefined): string[] => {
	if (!value?.trim()) return [];

	return [...new Set(value
		.split(',')
		.map(origin => origin.trim())
		.filter(Boolean)
		.map(origin => {
			if (origin === '*') throw new Error('Invalid LocalCast environment: wildcard trusted origins are forbidden');
			const url = new URL(origin);
			if (url.protocol !== 'http:' && url.protocol !== 'https:') {
				throw new Error('Invalid LocalCast environment: trusted origins must use http or https');
			}
			return url.origin;
		}))];
};

const absolutePath = (value: string): string => path.resolve(process.cwd(), value);

export const parseServerConfig = (environment: NodeJS.ProcessEnv): ServerConfig => {
	const parsed = rawEnvironmentSchema.safeParse(environment);
	if (!parsed.success) {
		throw new Error(`Invalid LocalCast environment: ${z.prettifyError(parsed.error)}`);
	}

	const env = parsed.data;
	const runtimeMode = env.LOCALCAST_RUNTIME_MODE;
	const processRole = env.LOCALCAST_PROCESS_ROLE || 'app';
	const textProvider = env.TEXT_PROVIDER || 'not_configured';
	const speechProvider = env.SPEECH_PROVIDER || 'not_configured';
	const trustedOrigins = splitOrigins(
		env.LOCALCAST_TRUSTED_ORIGINS
		?? env.CORS_ORIGIN
		?? (runtimeMode === 'development' ? 'http://localhost:3000,http://127.0.0.1:3000' : undefined),
	);
	const databasePath = env.DATABASE_PATH || 'data/localcast.sqlite';
	const mediaPath = env.MEDIA_PATH || 'data/media';
	const resolvedDatabasePath = databasePath === ':memory:' ? databasePath : absolutePath(databasePath);
	const resolvedMediaPath = absolutePath(mediaPath);

	if (env.NODE_ENV === 'production' && runtimeMode !== 'production') {
		throw new Error('Invalid LocalCast environment: production builds require production runtime mode');
	}
	if (runtimeMode === 'production' && env.NODE_ENV && env.NODE_ENV !== 'production') {
		throw new Error('Invalid LocalCast environment: production runtime mode requires NODE_ENV=production when NODE_ENV is set');
	}

	if (env.RSS_SYNC_ON_START?.trim().toLowerCase() === 'true' || env.RSS_SYNC_INTERVAL_MINUTES?.trim()) {
		throw new Error('Invalid LocalCast environment: automatic RSS synchronization is not supported');
	}

	if (env.LOCALCAST_ALLOW_FAKE_PROVIDERS && runtimeMode !== 'test') {
		throw new Error('Invalid LocalCast environment: fake providers are allowed only in test mode');
	}

	if ((textProvider === 'fake' || speechProvider === 'fake') && (!env.LOCALCAST_ALLOW_FAKE_PROVIDERS || runtimeMode !== 'test')) {
		throw new Error('Invalid LocalCast environment: fake providers require test mode and explicit opt-in');
	}

	if (env.LOCALCAST_FAKE_FAILURE_PHASE && (!env.LOCALCAST_ALLOW_FAKE_PROVIDERS || runtimeMode !== 'test')) {
		throw new Error('Invalid LocalCast environment: fake failure injection requires test mode and explicit opt-in');
	}
	if (env.LOCALCAST_FAKE_PHASE_DELAY_MS > 0 && (!env.LOCALCAST_ALLOW_FAKE_PROVIDERS || runtimeMode !== 'test')) {
		throw new Error('Invalid LocalCast environment: fake phase delay requires test mode and explicit opt-in');
	}
	if (env.LOCALCAST_FAKE_DELAY_PHASE && (!env.LOCALCAST_ALLOW_FAKE_PROVIDERS || runtimeMode !== 'test')) {
		throw new Error('Invalid LocalCast environment: fake delay phase requires test mode and explicit opt-in');
	}
	if (env.LOCALCAST_FAKE_AFTER_PUBLICATION_DELAY_MS > 0 && (!env.LOCALCAST_ALLOW_FAKE_PROVIDERS || runtimeMode !== 'test')) {
		throw new Error('Invalid LocalCast environment: fake publication delay requires test mode and explicit opt-in');
	}

	if (runtimeMode === 'production') {
		if (!env.DATABASE_PATH || !path.isAbsolute(env.DATABASE_PATH)) {
			throw new Error('Invalid LocalCast environment: production DATABASE_PATH must be explicit and absolute');
		}
		if (!env.MEDIA_PATH || !path.isAbsolute(env.MEDIA_PATH)) {
			throw new Error('Invalid LocalCast environment: production MEDIA_PATH must be explicit and absolute');
		}
		if (
			!env.LOCALCAST_INSTALLATION_ID
			|| env.LOCALCAST_INSTALLATION_ID.length < 16
			|| env.LOCALCAST_INSTALLATION_ID === 'replace-with-a-unique-installation-id'
		) {
			throw new Error('Invalid LocalCast environment: production LOCALCAST_INSTALLATION_ID must contain at least 16 characters');
		}
		const databaseDirectory = path.dirname(resolvedDatabasePath);
		const mediaRelativeToData = path.relative(databaseDirectory, resolvedMediaPath);
		const dataRelativeToMedia = path.relative(resolvedMediaPath, databaseDirectory);
		const isNested = (relative: string): boolean => relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
		if (databaseDirectory === resolvedMediaPath || isNested(mediaRelativeToData) || isNested(dataRelativeToMedia)) {
			throw new Error('Invalid LocalCast environment: production database and media directories must be distinct');
		}
	}

	if (databasePath === ':memory:' && runtimeMode !== 'test') {
		throw new Error('Invalid LocalCast environment: in-memory SQLite is allowed only in test mode');
	}

	return {
		runtimeMode,
		processRole,
		host: env.LOCALCAST_HOST || (runtimeMode === 'production' ? '0.0.0.0' : '127.0.0.1'),
		port: env.PORT,
		databasePath: resolvedDatabasePath,
		mediaPath: resolvedMediaPath,
		webDistPath: absolutePath(env.LOCALCAST_WEB_DIST_PATH || 'dist'),
		installationId: env.LOCALCAST_INSTALLATION_ID,
		trustedOrigins,
		textProvider,
		speechProvider,
		allowFakeProviders: env.LOCALCAST_ALLOW_FAKE_PROVIDERS,
		fakeFailurePhase: env.LOCALCAST_FAKE_FAILURE_PHASE,
		fakePhaseDelayMs: env.LOCALCAST_FAKE_PHASE_DELAY_MS,
		fakeDelayPhase: env.LOCALCAST_FAKE_DELAY_PHASE,
		fakeAfterPublicationDelayMs: env.LOCALCAST_FAKE_AFTER_PUBLICATION_DELAY_MS,
		workerId: env.LOCALCAST_WORKER_ID || `${processRole}-${process.pid}`,
		workerPollMs: env.LOCALCAST_WORKER_POLL_MS,
		leaseMs: env.LOCALCAST_LEASE_MS,
		shutdownMs: env.LOCALCAST_SHUTDOWN_MS,
	};
};

export interface ProviderSummary {
	adapter: string;
	status: ProviderStatus;
	reason: string;
}

export const providerSummaryForConfig = (config: ServerConfig): {text: ProviderSummary; speech: ProviderSummary; generationEnabled: boolean} => {
	const fakeEnabled = config.runtimeMode === 'test' && config.allowFakeProviders;
	const text: ProviderSummary = config.textProvider === 'fake' && fakeEnabled
		? {adapter: 'Deterministic test text', status: 'CONTRACT TESTED ONLY', reason: 'Enabled only for isolated tests'}
		: {adapter: 'Text provider', status: 'NOT CONFIGURED', reason: 'Configure a supported server-side text provider'};
	const speech: ProviderSummary = config.speechProvider === 'fake' && fakeEnabled
		? {adapter: 'Deterministic test speech', status: 'CONTRACT TESTED ONLY', reason: 'Enabled only for isolated tests'}
		: {adapter: 'Speech provider', status: 'NOT CONFIGURED', reason: 'Configure a supported server-side speech provider'};

	return {
		text,
		speech,
		generationEnabled: text.status === 'CONTRACT TESTED ONLY' && speech.status === 'CONTRACT TESTED ONLY' && fakeEnabled,
	};
};

export const serverConfig = parseServerConfig(process.env);
