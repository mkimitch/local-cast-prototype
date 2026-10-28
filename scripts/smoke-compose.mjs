import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectName = `localcast-slice1-${process.pid}`;
const proxyNetwork = `localcast-slice4-proxy-${process.pid}`;
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localcast-compose-smoke-'));
fs.chmodSync(temporaryRoot, 0o700);
const dataPath = path.join(temporaryRoot, 'data');
const mediaPath = path.join(temporaryRoot, 'media');
fs.mkdirSync(dataPath, {mode: 0o750});
fs.mkdirSync(mediaPath, {mode: 0o750});
const podcastTokenPath = path.join(temporaryRoot, 'podcast-token');
fs.writeFileSync(podcastTokenPath, randomBytes(32).toString('base64url'), {mode: 0o600});
const environment = {
	...process.env,
	LOCALCAST_IMAGE_TAG: 'slice0-smoke',
	LOCALCAST_INSTALLATION_ID: `localcast-compose-smoke-${process.pid}`,
	LOCALCAST_TRUSTED_ORIGINS: 'http://127.0.0.1:8787',
	PUBLIC_BASE_URL: 'http://127.0.0.1:8787',
	LOCALCAST_PODCAST_TOKEN_SOURCE: podcastTokenPath,
	LOCALCAST_CADDY_NETWORK: proxyNetwork,
	LOCALCAST_SMOKE_DATA_PATH: dataPath,
	LOCALCAST_SMOKE_MEDIA_PATH: mediaPath,
	TEXT_PROVIDER: 'not_configured',
	SPEECH_PROVIDER: 'not_configured',
	OPENAI_API_KEY: '',
};
const baseArguments = ['compose', '-f', 'compose.yml', '-f', 'compose.caddy.yml', '-f', 'compose.smoke.yml', '--project-name', projectName];

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
	dockerGlobal(['network', 'create', '--driver', 'bridge', proxyNetwork]);
	const configuration = JSON.parse(docker(['--profile', 'init', 'config', '--format', 'json']));
	const credentialConfiguration = JSON.parse(docker(['--profile', 'init', 'config', '--format', 'json'], {
		env: {...environment, OPENAI_API_KEY: 'compose-contract-canary'},
	}));
	const {app, worker, 'storage-init': storageInit} = configuration.services;
	assert(app && worker && storageInit, 'Compose must declare app, worker, and storage-init services');
	assert(!app.ports && !worker.ports && !storageInit.ports, 'base Compose topology must publish no host port');
	assert(app.environment.LOCALCAST_PROCESS_ROLE === 'app', 'app role must be explicit');
	assert(worker.environment.LOCALCAST_PROCESS_ROLE === 'worker', 'worker role must be explicit');
	assert(storageInit.environment.LOCALCAST_PROCESS_ROLE === 'storage-init', 'storage initialization role must be explicit');
	assert(storageInit.profiles?.includes('init'), 'storage initialization must require an explicit Compose profile');
	assert(!app.depends_on && !worker.depends_on, 'normal app/worker startup must not initialize fresh storage');
	assert(app.environment.LOCALCAST_ALLOW_FAKE_PROVIDERS === 'false', 'production Compose must disable fake providers');
	assert(!Object.hasOwn(app.environment, 'OPENAI_API_KEY'), 'app must not receive the OpenAI credential');
	assert(!Object.hasOwn(storageInit.environment, 'OPENAI_API_KEY'), 'storage initializer must not receive the OpenAI credential');
	assert(worker.environment.OPENAI_API_KEY === '', 'worker must support an explicit empty credential and report NOT CONFIGURED');
	assert(credentialConfiguration.services.worker.environment.OPENAI_API_KEY === 'compose-contract-canary', 'configured credential must reach the worker');
	assert(!Object.hasOwn(credentialConfiguration.services.app.environment, 'OPENAI_API_KEY'), 'configured credential must not reach the app');
	assert(!Object.hasOwn(credentialConfiguration.services['storage-init'].environment, 'OPENAI_API_KEY'), 'configured credential must not reach storage initialization');
	assert(app.environment.PUBLIC_BASE_URL === 'http://127.0.0.1:8787', 'app must receive the explicit canonical origin');
	assert(app.environment.LOCALCAST_PODCAST_TOKEN_FILE === '/run/secrets/localcast-podcast-token', 'app must receive only the podcast token file path');
	assert(!Object.hasOwn(worker.environment, 'PUBLIC_BASE_URL') && !Object.hasOwn(worker.environment, 'LOCALCAST_PODCAST_TOKEN_FILE'), 'worker must not receive podcast origin or token-file configuration');
	assert(!Object.hasOwn(storageInit.environment, 'PUBLIC_BASE_URL') && !Object.hasOwn(storageInit.environment, 'LOCALCAST_PODCAST_TOKEN_FILE'), 'storage initializer must not receive podcast origin or token-file configuration');
	assert(app.secrets?.length === 1 && app.secrets[0].target === 'localcast-podcast-token', 'app alone must mount the protected podcast token secret at the runtime secret path');
	assert(!worker.secrets && !storageInit.secrets, 'worker and storage initializer must not mount the podcast token');
	assert(app.networks?.caddy?.aliases?.includes('localcast-app'), 'app must have the approved Caddy network alias');
	assert(!Object.hasOwn(worker.networks || {}, 'caddy') && !Object.hasOwn(storageInit.networks || {}, 'caddy'), 'worker and storage initializer must remain off the Caddy network');
	assert(app.read_only && worker.read_only && storageInit.read_only, 'all containers must use a read-only root filesystem');
	assert(app.healthcheck && worker.healthcheck, 'app and worker health checks must be declared');
	for (const service of [app, worker, storageInit]) {
		const targets = service.volumes.map(volume => volume.target).sort();
		assert(JSON.stringify(targets) === JSON.stringify(['/var/lib/localcast/data', '/var/lib/localcast/media']), 'each role must mount the same durable data and media volumes');
		assert(service.volumes.every(volume => volume.type === 'bind'), 'smoke roles must use only disposable bind storage');
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
	assert(dockerGlobal(['inspect', appId, '--format', `{{if index .NetworkSettings.Networks "${proxyNetwork}"}}attached{{end}}`]) === 'attached', 'app must join the disposable proxy network');
	assert(dockerGlobal(['inspect', workerId, '--format', `{{if index .NetworkSettings.Networks "${proxyNetwork}"}}attached{{end}}`]) === '', 'worker must remain off the proxy network');
	dockerGlobal(['run', '--rm', '--network', proxyNetwork, 'localcast:slice0-smoke', 'node', '-e', `const http=require('node:http');const req=http.request({host:'localcast-app',port:8787,path:'/api/health',headers:{Host:'127.0.0.1:8787'}},res=>{res.resume();if(res.statusCode!==200)process.exitCode=1});req.on('error',()=>process.exit(1));req.end()`]);

	docker(['exec', '-T', 'app', 'node', '-e', `
		const fs = require('node:fs');
		(async () => {
			if (process.env.OPENAI_API_KEY) process.exit(1);
			const health = await fetch('http://127.0.0.1:8787/api/health').then(response => response.json());
			if (!health.ok || health.providers.text.status !== 'NOT CONFIGURED') process.exit(1);
			const page = await fetch('http://127.0.0.1:8787/').then(response => response.text());
			if (!page.includes('<title>LocalCast</title>')) process.exit(1);
			const created = await fetch('http://127.0.0.1:8787/api/sources', {
				method: 'POST',
				headers: {'Content-Type': 'application/json', Origin: 'http://127.0.0.1:8787'},
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
	docker(['exec', '-T', 'worker', 'node', '-e', `
		const fs = require('node:fs');
		const {spawnSync} = require('node:child_process');
		if (process.env.OPENAI_API_KEY) process.exit(1);
		if (spawnSync('/usr/bin/ffprobe', ['-version'], {stdio: 'ignore'}).status !== 0) process.exit(1);
		if (spawnSync('/usr/bin/ffmpeg', ['-version'], {stdio: 'ignore'}).status !== 0) process.exit(1);
		const prefix = '/var/lib/localcast/media/.compose-assembly-' + process.pid;
		const inputs = [prefix + '-a.mp3', prefix + '-b.mp3'];
		const output = prefix + '-output.mp3';
		try {
			for (const input of inputs) {
				const generated = spawnSync('/usr/bin/ffmpeg', [
					'-v', 'error', '-nostdin', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono',
					'-t', '0.35', '-codec:a', 'libmp3lame', '-q:a', '7', '-f', 'mp3', input,
				], {stdio: 'ignore'});
				if (generated.status !== 0) process.exit(1);
			}
			const assembled = spawnSync('/usr/bin/ffmpeg', [
				'-v', 'error', '-nostdin', '-i', inputs[0], '-i', inputs[1],
				'-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1[out]', '-map', '[out]',
				'-codec:a', 'libmp3lame', '-q:a', '3', '-f', 'mp3', output,
			], {stdio: 'ignore'});
			if (assembled.status !== 0 || fs.statSync(output).size < 1000) process.exit(1);
			const probe = spawnSync('/usr/bin/ffprobe', [
				'-v', 'error', '-show_entries', 'format=format_name,duration', '-of', 'json', output,
			], {encoding: 'utf8'});
			const format = JSON.parse(probe.stdout || '{}').format || {};
			if (probe.status !== 0 || !String(format.format_name).split(',').includes('mp3') || Number(format.duration) < 0.6) process.exit(1);
		} finally {
			for (const file of [...inputs, output]) {
				try { fs.unlinkSync(file); } catch {}
			}
		}
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
	const cleanup = spawnSync('docker', [...baseArguments, 'down', '--remove-orphans', '--timeout', '10'], {
		cwd: repoRoot,
		env: environment,
		encoding: 'utf8',
		maxBuffer: 20 * 1024 * 1024,
	});
	if (cleanup.status !== 0) {
		console.error(`Compose smoke cleanup failed:\n${cleanup.stdout || ''}${cleanup.stderr || ''}`);
	}
	spawnSync('docker', ['network', 'rm', proxyNetwork], {cwd: repoRoot, env: environment, encoding: 'utf8'});
	fs.rmSync(temporaryRoot, {recursive: true, force: true});
}
