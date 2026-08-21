import path from 'node:path';

const allowedSmokeVariables = new Set([
	'HOME',
	'TMPDIR',
	'NODE_ENV',
	'LOCALCAST_RUNTIME_MODE',
	'LOCALCAST_PROCESS_ROLE',
	'LOCALCAST_HOST',
	'PORT',
	'DATABASE_PATH',
	'MEDIA_PATH',
	'LOCALCAST_WEB_DIST_PATH',
	'LOCALCAST_INSTALLATION_ID',
	'LOCALCAST_TRUSTED_ORIGINS',
	'PUBLIC_BASE_URL',
	'TEXT_PROVIDER',
	'SPEECH_PROVIDER',
	'LOCALCAST_ALLOW_FAKE_PROVIDERS',
	'LOCALCAST_RSS_PRIVATE_HOSTS',
	'LOCALCAST_PODCAST_TOKEN_FILE',
	'LOCALCAST_WORKER_ID',
	'LOCALCAST_FAKE_FAILURE_PHASE',
	'RSS_SYNC_ON_START',
	'RSS_SYNC_INTERVAL_MINUTES',
]);

const fixedEnvironment = {
	PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
	LANG: 'C.UTF-8',
	LC_ALL: 'C.UTF-8',
	TZ: 'UTC',
};

export const createSmokeChildEnvironment = (values) => {
	const environment = {...fixedEnvironment};
	for (const [name, value] of Object.entries(values)) {
		if (!allowedSmokeVariables.has(name)) throw new Error(`Smoke child environment variable is not allowlisted: ${name}`);
		if (value !== undefined) environment[name] = String(value);
	}
	return environment;
};

export const resolveSmokeEntry = (repoRoot, entryPoint) => {
	const root = path.resolve(repoRoot);
	const resolved = path.resolve(root, entryPoint);
	if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error('Smoke entrypoint escaped the repository');
	return resolved;
};
