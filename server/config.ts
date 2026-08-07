import path from 'node:path';
import {z} from 'zod';

export const providerStatuses = ['LIVE VERIFIED', 'CONTRACT TESTED ONLY', 'NOT CONFIGURED'] as const;
export type ProviderStatus = typeof providerStatuses[number];
export type RuntimeMode = 'development' | 'test' | 'production';
export type ProcessRole = 'app' | 'worker' | 'storage-init';
export type BackendTextProvider = 'not_configured' | 'fake' | 'openai';
export type BackendSpeechProvider = 'not_configured' | 'fake' | 'openai';

const nonEmptyString = z.string().trim().min(1);
const optionalCredential = z.preprocess(value => typeof value === 'string' && value.trim() === '' ? undefined : value, nonEmptyString.optional());

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
	PUBLIC_BASE_URL: nonEmptyString.optional(),
	LOCALCAST_PODCAST_TOKEN_FILE: nonEmptyString.optional(),
	CORS_ORIGIN: z.string().optional(),
	TEXT_PROVIDER: z.enum(['not_configured', 'fake', 'openai']).optional(),
	SPEECH_PROVIDER: z.enum(['not_configured', 'fake', 'openai']).optional(),
	OPENAI_API_KEY: optionalCredential,
	OPENAI_TEXT_MODEL: nonEmptyString.optional(),
	OPENAI_REASONING_EFFORT: z.enum(['low']).optional(),
	OPENAI_SPEECH_MODEL: nonEmptyString.optional(),
	OPENAI_SPEECH_VOICE: nonEmptyString.optional(),
	OPENAI_SPEECH_FORMAT: z.literal('mp3').optional(),
	FFPROBE_PATH: nonEmptyString.optional(),
	FFMPEG_PATH: nonEmptyString.optional(),
	LOCALCAST_ALLOW_FAKE_PROVIDERS: optionalBoolean,
	LOCALCAST_FAKE_FAILURE_PHASE: z.enum(['syncing', 'selecting', 'drafting', 'validating', 'rendering_audio']).optional(),
	LOCALCAST_FAKE_FAILURE_ATTEMPT: z.preprocess(value => value === undefined || value === '' ? undefined : Number(value), z.number().int().min(1).max(20).optional()),
	LOCALCAST_FAKE_PHASE_DELAY_MS: z.preprocess(value => value === undefined || value === '' ? 0 : Number(value), z.number().int().min(0).max(10000)),
	LOCALCAST_FAKE_DELAY_PHASE: z.enum(['syncing', 'selecting', 'drafting', 'validating', 'rendering_audio']).optional(),
	LOCALCAST_FAKE_AFTER_PUBLICATION_DELAY_MS: z.preprocess(value => value === undefined || value === '' ? 0 : Number(value), z.number().int().min(0).max(10000)),
	LOCALCAST_WORKER_ID: nonEmptyString.optional(),
	LOCALCAST_WORKER_POLL_MS: z.preprocess(value => value === undefined || value === '' ? 250 : Number(value), z.number().int().min(25).max(60000)),
	LOCALCAST_LEASE_MS: z.preprocess(value => value === undefined || value === '' ? 30000 : Number(value), z.number().int().min(1000).max(300000)),
	LOCALCAST_SHUTDOWN_MS: z.preprocess(value => value === undefined || value === '' ? 10000 : Number(value), z.number().int().min(500).max(30000)),
	LOCALCAST_RSS_PRIVATE_HOSTS: z.string().optional(),
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
	publicBaseUrl?: string;
	podcastTokenFile?: string;
	textProvider: BackendTextProvider;
	speechProvider: BackendSpeechProvider;
	openAiApiKey?: string;
	openAiTextModel: string;
	openAiReasoningEffort: 'low';
	openAiSpeechModel: string;
	openAiSpeechVoice: string;
	openAiSpeechFormat: 'mp3';
	ffprobePath: string;
	ffmpegPath: string;
	allowFakeProviders: boolean;
	fakeFailurePhase?: 'syncing' | 'selecting' | 'drafting' | 'validating' | 'rendering_audio';
	fakeFailureAttempt?: number;
	fakePhaseDelayMs: number;
	fakeDelayPhase?: 'syncing' | 'selecting' | 'drafting' | 'validating' | 'rendering_audio';
	fakeAfterPublicationDelayMs: number;
	workerId: string;
	workerPollMs: number;
	leaseMs: number;
	shutdownMs: number;
	rssPrivateHosts: string[];
}

const isLoopbackHostname = (hostname: string): boolean => (
	hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'
);

const normalizeHttpOrigin = (value: string, label: string, requireSecureNonLoopback: boolean): string => {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error(`Invalid LocalCast environment: ${label} must be an absolute HTTP(S) origin`);
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error(`Invalid LocalCast environment: ${label} must use http or https`);
	}
	if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
		throw new Error(`Invalid LocalCast environment: ${label} must contain only an origin with no credentials, path, query, or fragment`);
	}
	if (requireSecureNonLoopback && url.protocol !== 'https:' && !isLoopbackHostname(url.hostname)) {
		throw new Error(`Invalid LocalCast environment: ${label} must use HTTPS except for an explicit loopback test origin`);
	}
	return url.origin;
};

const splitOrigins = (value: string | undefined): string[] => {
	if (!value?.trim()) return [];

	return [...new Set(value
		.split(',')
		.map(origin => origin.trim())
		.filter(Boolean)
		.map(origin => {
			if (origin === '*') throw new Error('Invalid LocalCast environment: wildcard trusted origins are forbidden');
			return normalizeHttpOrigin(origin, 'trusted origins', false);
		}))];
};

const absolutePath = (value: string): string => path.resolve(process.cwd(), value);

const normalizeConfiguredHostname = (value: string): string => {
	const entry = value.trim();
	if (!entry || entry.includes('/') || entry.includes('@') || entry.includes('*') || /\s/.test(entry)) {
		throw new Error('Invalid LocalCast environment: RSS private hosts must be exact hostnames or IP addresses');
	}

	let parsed: URL;
	try {
		parsed = new URL(`http://${entry}`);
	} catch {
		throw new Error('Invalid LocalCast environment: RSS private hosts must be exact hostnames or IP addresses');
	}
	if (!parsed.hostname || parsed.port || parsed.username || parsed.password) {
		throw new Error('Invalid LocalCast environment: RSS private hosts must not include ports or credentials');
	}

	return parsed.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
};

const splitPrivateHosts = (value: string | undefined): string[] => {
	if (!value?.trim()) return [];
	return [...new Set(value.split(',').map(normalizeConfiguredHostname))];
};

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
	const publicBaseUrl = env.PUBLIC_BASE_URL
		? normalizeHttpOrigin(env.PUBLIC_BASE_URL, 'PUBLIC_BASE_URL', runtimeMode === 'production')
		: undefined;

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

	if (processRole !== 'worker' && env.OPENAI_API_KEY) {
		throw new Error('Invalid LocalCast environment: OPENAI_API_KEY is allowed only in the worker process');
	}
	if (processRole !== 'app' && (env.PUBLIC_BASE_URL || env.LOCALCAST_PODCAST_TOKEN_FILE)) {
		throw new Error('Invalid LocalCast environment: podcast origin and token file are allowed only in the app process');
	}

	if (textProvider === 'openai' && speechProvider !== 'openai' || textProvider !== 'openai' && speechProvider === 'openai') {
		throw new Error('Invalid LocalCast environment: the Slice 1 OpenAI text and speech providers must be selected together');
	}

	if (env.LOCALCAST_FAKE_FAILURE_PHASE && (!env.LOCALCAST_ALLOW_FAKE_PROVIDERS || runtimeMode !== 'test')) {
		throw new Error('Invalid LocalCast environment: fake failure injection requires test mode and explicit opt-in');
	}
	if (env.LOCALCAST_FAKE_FAILURE_ATTEMPT && (!env.LOCALCAST_FAKE_FAILURE_PHASE || !env.LOCALCAST_ALLOW_FAKE_PROVIDERS || runtimeMode !== 'test')) {
		throw new Error('Invalid LocalCast environment: fake failure attempt requires test-only failure injection');
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
		if (processRole === 'app') {
			if (!publicBaseUrl) {
				throw new Error('Invalid LocalCast environment: production app requires an explicit PUBLIC_BASE_URL');
			}
			if (trustedOrigins.length !== 1 || trustedOrigins[0] !== publicBaseUrl) {
				throw new Error('Invalid LocalCast environment: production app trusted origin must exactly match PUBLIC_BASE_URL');
			}
			if (!env.LOCALCAST_PODCAST_TOKEN_FILE || !path.isAbsolute(env.LOCALCAST_PODCAST_TOKEN_FILE)) {
				throw new Error('Invalid LocalCast environment: production app requires an absolute LOCALCAST_PODCAST_TOKEN_FILE');
			}
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
		publicBaseUrl,
		podcastTokenFile: env.LOCALCAST_PODCAST_TOKEN_FILE ? absolutePath(env.LOCALCAST_PODCAST_TOKEN_FILE) : undefined,
		textProvider,
		speechProvider,
		openAiApiKey: env.OPENAI_API_KEY,
		openAiTextModel: env.OPENAI_TEXT_MODEL || 'gpt-5.4-mini',
		openAiReasoningEffort: env.OPENAI_REASONING_EFFORT || 'low',
		openAiSpeechModel: env.OPENAI_SPEECH_MODEL || 'gpt-4o-mini-tts',
		openAiSpeechVoice: env.OPENAI_SPEECH_VOICE || 'marin',
		openAiSpeechFormat: env.OPENAI_SPEECH_FORMAT || 'mp3',
		ffprobePath: env.FFPROBE_PATH || 'ffprobe',
		ffmpegPath: env.FFMPEG_PATH || 'ffmpeg',
		allowFakeProviders: env.LOCALCAST_ALLOW_FAKE_PROVIDERS,
		fakeFailurePhase: env.LOCALCAST_FAKE_FAILURE_PHASE,
		fakeFailureAttempt: env.LOCALCAST_FAKE_FAILURE_ATTEMPT,
		fakePhaseDelayMs: env.LOCALCAST_FAKE_PHASE_DELAY_MS,
		fakeDelayPhase: env.LOCALCAST_FAKE_DELAY_PHASE,
		fakeAfterPublicationDelayMs: env.LOCALCAST_FAKE_AFTER_PUBLICATION_DELAY_MS,
		workerId: env.LOCALCAST_WORKER_ID || `${processRole}-${process.pid}`,
		workerPollMs: env.LOCALCAST_WORKER_POLL_MS,
		leaseMs: env.LOCALCAST_LEASE_MS,
		shutdownMs: env.LOCALCAST_SHUTDOWN_MS,
		rssPrivateHosts: splitPrivateHosts(env.LOCALCAST_RSS_PRIVATE_HOSTS),
	};
};

export interface ProviderSummary {
	adapter: string;
	status: ProviderStatus;
	reason: string;
	model?: string;
	voice?: string;
	verifiedAt?: string;
}

export const providerSummaryForConfig = (config: ServerConfig): {text: ProviderSummary; speech: ProviderSummary; generationEnabled: boolean} => {
	const fakeEnabled = config.runtimeMode === 'test' && config.allowFakeProviders;
	const text: ProviderSummary = config.textProvider === 'openai'
		? {adapter: 'OpenAI', model: config.openAiTextModel, status: 'CONTRACT TESTED ONLY', reason: 'Configured; live verification is pending'}
		: config.textProvider === 'fake' && fakeEnabled
			? {adapter: 'Deterministic test text', status: 'CONTRACT TESTED ONLY', reason: 'Enabled only for isolated tests'}
			: {adapter: 'Text provider', status: 'NOT CONFIGURED', reason: 'Configure a supported server-side text provider'};
	const speech: ProviderSummary = config.speechProvider === 'openai'
		? {adapter: 'OpenAI', model: config.openAiSpeechModel, voice: config.openAiSpeechVoice, status: 'CONTRACT TESTED ONLY', reason: 'Configured; live verification is pending'}
		: config.speechProvider === 'fake' && fakeEnabled
			? {adapter: 'Deterministic test speech', status: 'CONTRACT TESTED ONLY', reason: 'Enabled only for isolated tests'}
			: {adapter: 'Speech provider', status: 'NOT CONFIGURED', reason: 'Configure a supported server-side speech provider'};

	return {
		text,
		speech,
		generationEnabled: (
			config.textProvider === 'openai' && config.speechProvider === 'openai'
		) || (
			text.status === 'CONTRACT TESTED ONLY' && speech.status === 'CONTRACT TESTED ONLY' && fakeEnabled
		),
	};
};

export const serverConfig = parseServerConfig(process.env);
