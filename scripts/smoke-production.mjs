import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {createServer, request as httpRequest} from 'node:http';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createSmokeChildEnvironment, resolveSmokeEntry} from './smoke-environment.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localcast-production-smoke-'));
const databasePath = path.join(temporaryRoot, 'data', 'localcast.sqlite');
const mediaPath = path.join(temporaryRoot, 'media');
const installationId = `localcast-production-smoke-${process.pid}`;
const podcastTokenFile = path.join(temporaryRoot, 'podcast-token');
fs.writeFileSync(podcastTokenFile, randomBytes(32).toString('base64url'), {mode: 0o600});
let application;
let output = '';

const assert = (condition, message) => {
	if (!condition) throw new Error(message);
};

const statusWithExactHeaders = (url, headers) => new Promise((resolve, reject) => {
	const request = httpRequest(url, {headers}, response => {
		response.resume();
		response.once('end', () => resolve(response.statusCode));
	});
	request.once('error', reject);
	request.end();
});

const reservePort = async () => {
	const server = createServer();
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('Could not reserve a production smoke port');
	await new Promise(resolve => server.close(resolve));
	return address.port;
};

const runEnvironment = (role, port, extra = {}) => createSmokeChildEnvironment({
	HOME: temporaryRoot,
	TMPDIR: temporaryRoot,
	NODE_ENV: 'production',
	LOCALCAST_RUNTIME_MODE: 'production',
	LOCALCAST_PROCESS_ROLE: role,
	DATABASE_PATH: databasePath,
	MEDIA_PATH: mediaPath,
	LOCALCAST_INSTALLATION_ID: installationId,
	TEXT_PROVIDER: 'not_configured',
	SPEECH_PROVIDER: 'not_configured',
	LOCALCAST_ALLOW_FAKE_PROVIDERS: 'false',
	RSS_SYNC_ON_START: '',
	RSS_SYNC_INTERVAL_MINUTES: '',
	...(role === 'app' ? {
		LOCALCAST_HOST: '127.0.0.1',
		PORT: String(port),
		LOCALCAST_WEB_DIST_PATH: path.join(repoRoot, 'dist'),
		LOCALCAST_TRUSTED_ORIGINS: `http://127.0.0.1:${port}`,
		PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
		LOCALCAST_PODCAST_TOKEN_FILE: podcastTokenFile,
	} : {}),
	...extra,
});

const runToCompletion = (entryPoint, role, port, extra = {}) => new Promise((resolve, reject) => {
	const absoluteEntry = resolveSmokeEntry(repoRoot, entryPoint);
	const child = spawn(process.execPath, [absoluteEntry], {cwd: temporaryRoot, env: runEnvironment(role, port, extra), stdio: ['ignore', 'pipe', 'pipe']});
	let childOutput = '';
	child.stdout.on('data', chunk => { childOutput += chunk.toString(); });
	child.stderr.on('data', chunk => { childOutput += chunk.toString(); });
	child.once('error', reject);
	child.once('exit', code => code === 0 ? resolve(childOutput) : reject(new Error(`${entryPoint} exited ${code}:\n${childOutput}`)));
});

const runExpectingFailure = (entryPoint, role, port, extra) => new Promise((resolve, reject) => {
	const absoluteEntry = resolveSmokeEntry(repoRoot, entryPoint);
	const child = spawn(process.execPath, [absoluteEntry], {cwd: temporaryRoot, env: runEnvironment(role, port, extra), stdio: ['ignore', 'pipe', 'pipe']});
	let childOutput = '';
	child.stdout.on('data', chunk => { childOutput += chunk.toString(); });
	child.stderr.on('data', chunk => { childOutput += chunk.toString(); });
	child.once('error', reject);
	child.once('exit', code => code && code !== 0 ? resolve(childOutput) : reject(new Error(`${entryPoint} unexpectedly accepted production fake/test configuration`)));
});

const startApplication = (port) => {
	const child = spawn(process.execPath, [resolveSmokeEntry(repoRoot, 'dist-server/index.js')], {
		cwd: temporaryRoot,
		env: runEnvironment('app', port),
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	child.stdout.on('data', chunk => { output += chunk.toString(); });
	child.stderr.on('data', chunk => { output += chunk.toString(); });
	return child;
};

const stopApplication = async child => {
	if (!child || child.exitCode !== null) return;
	child.kill('SIGTERM');
	const stopped = await Promise.race([
		new Promise(resolve => child.once('exit', () => resolve(true))),
		new Promise(resolve => setTimeout(() => resolve(false), 3_000)),
	]);
	if (!stopped && child.exitCode === null) {
		child.kill('SIGKILL');
		throw new Error('Production application did not stop cleanly');
	}
};

try {
	assert(fs.existsSync(path.join(repoRoot, 'dist', 'index.html')), 'production frontend build is required');
	assert(fs.existsSync(path.join(repoRoot, 'dist-server', 'index.js')), 'production server build is required');
	const port = await reservePort();
	const origin = `http://127.0.0.1:${port}`;

	await runToCompletion('dist-server/storageInit.js', 'storage-init', port);
	await runToCompletion('dist-server/storageInit.js', 'storage-init', port);
	const rejectedFakeImageRuntime = await runExpectingFailure('dist-server/worker.js', 'worker', port, {
		LOCALCAST_RUNTIME_MODE: 'test',
		TEXT_PROVIDER: 'fake',
		SPEECH_PROVIDER: 'fake',
		LOCALCAST_ALLOW_FAKE_PROVIDERS: 'true',
	});
	assert(rejectedFakeImageRuntime.includes('production builds require production runtime mode'), 'production server artifact must reject test/fake runtime flags');
	application = startApplication(port);

	const deadline = Date.now() + 10_000;
	let health;
	while (Date.now() < deadline) {
		if (application.exitCode !== null) throw new Error(`Production app exited early:\n${output}`);
		try {
			const response = await fetch(`${origin}/api/health`);
			if (response.ok) {
				health = await response.json();
				break;
			}
		} catch {
			// Wait for the socket.
		}
		await new Promise(resolve => setTimeout(resolve, 100));
	}

	assert(health?.ok === true, `production health did not become ready:\n${output}`);
	assert(health.providers.text.status === 'NOT CONFIGURED', 'production text provider must not fall back');
	assert(health.providers.speech.status === 'NOT CONFIGURED', 'production speech provider must not fall back');
	assert(health.providers.generationEnabled === false, 'production generation must be disabled without providers');

	const pageResponse = await fetch(origin);
	const page = await pageResponse.text();
	assert(pageResponse.ok && page.includes('<title>LocalCast</title>'), 'Express should serve the built LocalCast UI');
	const assetPath = page.match(/(?:src|href)="(\/assets\/[^"]+)"/)?.[1];
	assert(assetPath && (await fetch(`${origin}${assetPath}`)).ok, 'built UI asset should share the application origin');

	const sources = await (await fetch(`${origin}/api/sources`)).json();
	const runs = await (await fetch(`${origin}/api/briefing-runs`)).json();
	assert(sources.length === 0 && runs.length === 0, 'production startup must not seed demo rows');
	const podcastStatusResponse = await fetch(`${origin}/api/podcast/status`);
	const podcastStatus = await podcastStatusResponse.json();
	assert(podcastStatusResponse.ok && podcastStatus.configured === true && podcastStatus.publicBaseUrl === origin, 'production podcast status must expose only safe configured metadata');
	assert(!JSON.stringify(podcastStatus).includes('/feed.xml'), 'routine podcast status must not expose the subscription URL');
	assert((await fetch(`${origin}/api/podcast/subscription-url`, {method: 'POST'})).status === 403, 'subscription copy must require an exact same-origin browser action');
	const copiedResponse = await fetch(`${origin}/api/podcast/subscription-url`, {method: 'POST', headers: {Origin: origin}});
	const copied = await copiedResponse.json();
	assert(copiedResponse.ok && typeof copied.subscriptionUrl === 'string' && copied.subscriptionUrl.startsWith(`${origin}/podcast/`) && copied.subscriptionUrl.endsWith('/feed.xml'), 'explicit same-origin copy must return one private feed URL');
	copied.subscriptionUrl = '';
	assert(await statusWithExactHeaders(`${origin}/api/health`, {Host: 'unexpected.test'}) === 421, 'unexpected Host must fail closed');
	assert(await statusWithExactHeaders(`${origin}/api/health`, {Forwarded: 'host=unexpected.test;proto=https'}) === 421, 'untrusted Forwarded metadata must fail closed');

	const generation = await fetch(`${origin}/api/briefing-runs`, {
		method: 'POST',
		headers: {'Content-Type': 'application/json', Origin: origin},
		body: JSON.stringify({sourceIds: ['missing']}),
	});
	assert(generation.status === 503 && (await generation.json()).code === 'PROVIDER_NOT_CONFIGURED', 'unconfigured production must fail without fake output');
	const missingChat = await fetch(`${origin}/api/briefing-runs/missing/chat-turns`, {
		method: 'POST',
		headers: {'Content-Type': 'application/json', Origin: origin, 'Idempotency-Key': 'production-chat-missing'},
		body: JSON.stringify({question: 'Synthetic production-boundary question?'}),
	});
	assert(missingChat.status === 404 && (await missingChat.json()).code === 'EPISODE_NOT_FOUND', 'production chat must require an existing episode before provider use');

	const blocked = await fetch(`${origin}/api/settings`, {headers: {Origin: 'http://unexpected.test'}});
	assert(blocked.status === 403, 'unexpected browser Origin must be rejected in production');

	const frontendFiles = fs.readdirSync(path.join(repoRoot, 'dist', 'assets')).filter(name => name.endsWith('.js') || name.endsWith('.css'));
	const frontendBundle = frontendFiles.map(name => fs.readFileSync(path.join(repoRoot, 'dist', 'assets', name), 'utf8')).join('\n');
	assert(!/MockBriefingService|MockProviderService|VITE_SERVICE_MODE.?mock|Google AI Studio|fonts\.googleapis\.com/i.test(frontendBundle), 'production browser bundle must contain no mock fallback or third-party font scaffold');
	assert(!/apiKey|ttsConfig|aiConfig/.test(frontendBundle), 'production browser bundle must contain no provider-key fields');
	const serverFiles = fs.readdirSync(path.join(repoRoot, 'dist-server'));
	assert(!serverFiles.some(name => name.endsWith('.map')), 'production server artifact must not ship source maps');
	const serverBundle = serverFiles.filter(name => name.endsWith('.js')).map(name => fs.readFileSync(path.join(repoRoot, 'dist-server', name), 'utf8')).join('\n');
	assert(!/DeterministicFakeGenerationProcessor|DeterministicFakeChatProcessor|MockAiProvider|deterministicFakeMp3Bytes|secret-canary/.test(serverBundle), 'production server artifact must exclude deterministic fake implementations');

	await stopApplication(application);
	application = startApplication(port);
	const restartDeadline = Date.now() + 10_000;
	while (Date.now() < restartDeadline) {
		try {
			if ((await fetch(`${origin}/api/health`)).ok) break;
		} catch {
			// Wait for restart.
		}
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	assert((await (await fetch(`${origin}/api/sources`)).json()).length === 0, 'initialized storage should remain readable after process restart');

	console.log('Production same-origin smoke checks passed');
} finally {
	try {
		await stopApplication(application);
	} finally {
		fs.rmSync(temporaryRoot, {recursive: true, force: true});
	}
}
