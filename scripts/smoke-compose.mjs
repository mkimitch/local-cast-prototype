import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectName = `localcast-slice0-${process.pid}`;
const environment = {
	...process.env,
	LOCALCAST_IMAGE_TAG: 'slice0-smoke',
	LOCALCAST_INSTALLATION_ID: `localcast-compose-smoke-${process.pid}`,
	LOCALCAST_TRUSTED_ORIGINS: 'http://localcast.test',
	TEXT_PROVIDER: 'not_configured',
	SPEECH_PROVIDER: 'not_configured',
};
const baseArguments = ['compose', '-f', 'compose.yml', '--project-name', projectName];

const assert = (condition, message) => {
	if (!condition) throw new Error(message);
};

const docker = (arguments_, options = {}) => {
	const result = spawnSync('docker', [...baseArguments, ...arguments_], {
		cwd: repoRoot,
		env: environment,
		encoding: 'utf8',
		maxBuffer: 20 * 1024 * 1024,
		...options,
	});
	if (result.status !== 0) {
		throw new Error(`docker ${[...baseArguments, ...arguments_].join(' ')} exited ${result.status}:\n${result.stdout || ''}${result.stderr || ''}`);
	}
	return result.stdout || '';
};

const dockerExpectingFailure = arguments_ => {
	const result = spawnSync('docker', [...baseArguments, ...arguments_], {
		cwd: repoRoot,
		env: environment,
		encoding: 'utf8',
		maxBuffer: 20 * 1024 * 1024,
	});
	if (result.status === 0) {
		throw new Error(`docker ${[...baseArguments, ...arguments_].join(' ')} unexpectedly succeeded`);
	}
	return `${result.stdout || ''}${result.stderr || ''}`;
};

const dockerGlobal = (arguments_) => {
	const result = spawnSync('docker', arguments_, {cwd: repoRoot, env: environment, encoding: 'utf8'});
	if (result.status !== 0) throw new Error(`docker ${arguments_.join(' ')} exited ${result.status}:\n${result.stdout || ''}${result.stderr || ''}`);
	return (result.stdout || '').trim();
};

try {
	const configuration = JSON.parse(docker(['--profile', 'init', 'config', '--format', 'json']));
	const {app, worker, 'storage-init': storageInit} = configuration.services;
	assert(app && worker && storageInit, 'Compose must declare app, worker, and storage-init services');
	assert(!app.ports && !worker.ports && !storageInit.ports, 'base Compose topology must publish no host port');
	assert(app.environment.LOCALCAST_PROCESS_ROLE === 'app', 'app role must be explicit');
	assert(worker.environment.LOCALCAST_PROCESS_ROLE === 'worker', 'worker role must be explicit');
	assert(storageInit.environment.LOCALCAST_PROCESS_ROLE === 'storage-init', 'storage initialization role must be explicit');
	assert(storageInit.profiles?.includes('init'), 'storage initialization must require an explicit Compose profile');
	assert(!app.depends_on && !worker.depends_on, 'normal app/worker startup must not initialize fresh storage');
	assert(app.environment.LOCALCAST_ALLOW_FAKE_PROVIDERS === 'false', 'production Compose must disable fake providers');
	assert(app.read_only && worker.read_only && storageInit.read_only, 'all containers must use a read-only root filesystem');
	assert(app.healthcheck && worker.healthcheck, 'app and worker health checks must be declared');
	for (const service of [app, worker, storageInit]) {
		const targets = service.volumes.map(volume => volume.target).sort();
		assert(JSON.stringify(targets) === JSON.stringify(['/var/lib/localcast/data', '/var/lib/localcast/media']), 'each role must mount the same durable data and media volumes');
	}

	docker(['build'], {stdio: 'inherit'});
	for (const role of ['app', 'worker']) {
		const uninitializedOutput = dockerExpectingFailure(['run', '--rm', '--no-deps', role]);
		assert(/database is missing|storage marker is missing/i.test(uninitializedOutput), `${role} must fail clearly on fresh uninitialized volumes`);
	}
	docker(['--profile', 'init', 'run', '--rm', 'storage-init'], {stdio: 'inherit'});
	docker(['up', '--detach', '--wait', '--wait-timeout', '90', 'app', 'worker'], {stdio: 'inherit'});

	const appId = docker(['ps', '--quiet', 'app']).trim();
	const workerId = docker(['ps', '--quiet', 'worker']).trim();
	assert(appId && workerId, 'app and worker containers must be running');
	assert(dockerGlobal(['inspect', appId, '--format', '{{.Config.User}}']) === 'node', 'runtime image must run app as the non-root node user');
	assert(dockerGlobal(['inspect', workerId, '--format', '{{.Config.User}}']) === 'node', 'runtime image must run worker as the non-root node user');
	assert(dockerGlobal(['inspect', appId, '--format', '{{.State.Health.Status}}']) === 'healthy', 'app container must become healthy');
	assert(dockerGlobal(['inspect', workerId, '--format', '{{.State.Health.Status}}']) === 'healthy', 'worker container must become healthy');
	assert(dockerGlobal(['port', appId]) === '', 'application container must have no published host socket');

	docker(['exec', '-T', 'app', 'node', '-e', `
		const fs = require('node:fs');
		(async () => {
			const health = await fetch('http://127.0.0.1:8787/api/health').then(response => response.json());
			if (!health.ok || health.providers.text.status !== 'NOT CONFIGURED') process.exit(1);
			const page = await fetch('http://127.0.0.1:8787/').then(response => response.text());
			if (!page.includes('<title>LocalCast</title>')) process.exit(1);
			const created = await fetch('http://127.0.0.1:8787/api/sources', {
				method: 'POST',
				headers: {'Content-Type': 'application/json', Origin: 'http://localcast.test'},
				body: JSON.stringify({type: 'rss', name: 'Compose persistence marker', url: 'https://example.test/feed.xml', isActive: true}),
			});
			if (created.status !== 201) process.exit(1);
			const artifacts = fs.readdirSync('/app/dist-server');
			if (artifacts.some(name => name.endsWith('.map'))) process.exit(1);
			const bundles = artifacts.filter(name => name.endsWith('.js')).map(name => fs.readFileSync('/app/dist-server/' + name, 'utf8')).join('\\n');
			if (/DeterministicFakeGenerationProcessor|MockAiProvider|secret-canary/.test(bundles)) process.exit(1);
		})().catch(error => {
			console.error(error);
			process.exit(1);
		});
	`]);

	docker(['stop', 'app', 'worker'], {stdio: 'inherit'});
	docker(['rm', '--force', 'app', 'worker'], {stdio: 'inherit'});
	docker(['up', '--detach', '--wait', '--wait-timeout', '90', 'app', 'worker'], {stdio: 'inherit'});
	docker(['exec', '-T', 'app', 'node', '-e', `
		(async () => {
			const sources = await fetch('http://127.0.0.1:8787/api/sources').then(response => response.json());
			if (!sources.some(source => source.name === 'Compose persistence marker')) process.exit(1);
		})().catch(error => {
			console.error(error);
			process.exit(1);
		});
	`]);

	const runningServices = docker(['ps', '--services', '--status', 'running']).trim().split(/\s+/).sort();
	assert(JSON.stringify(runningServices) === JSON.stringify(['app', 'worker']), 'exactly one app and one worker service must remain running');
	console.log('Compose topology and persistence smoke checks passed');
} finally {
	const cleanup = spawnSync('docker', [...baseArguments, 'down', '--volumes', '--remove-orphans', '--timeout', '10'], {
		cwd: repoRoot,
		env: environment,
		encoding: 'utf8',
		maxBuffer: 20 * 1024 * 1024,
	});
	if (cleanup.status !== 0) {
		console.error(`Compose smoke cleanup failed:\n${cleanup.stdout || ''}${cleanup.stderr || ''}`);
	}
}
