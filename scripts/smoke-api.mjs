import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localcast-api-smoke-'));
const databasePath = path.join(temporaryRoot, 'data', 'localcast.sqlite');
const mediaPath = path.join(temporaryRoot, 'media');
const allowedOrigin = 'http://localcast.test';
const blockedOrigin = 'http://unexpected.test';
const children = new Set();
const output = [];

let apiPort;
let baseUrl;
let rssServer;
let feedRequestCount = 0;

const assert = (condition, message) => {
	if (!condition) throw new Error(message);
};

const reservePort = async () => {
	const server = createServer();
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('Could not reserve a local smoke-test port');
	await new Promise(resolve => server.close(resolve));
	return address.port;
};

const fixtureFeed = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0"><channel>
	<title>LocalCast fixture</title><link>http://127.0.0.1/</link><description>Fixture feed</description>
	<item><guid>fixture-1</guid><title>Durable LocalCast Story</title><link>http://127.0.0.1/story</link><pubDate>Wed, 05 Aug 2026 12:00:00 GMT</pubDate><description>Supplied factual evidence for a deterministic briefing.</description></item>
</channel></rss>`;

const startFeed = async () => {
	rssServer = createServer((request, response) => {
		if (request.url === '/feed.xml') {
			feedRequestCount += 1;
			response.writeHead(200, {'Content-Type': 'application/rss+xml; charset=utf-8'});
			response.end(fixtureFeed);
			return;
		}
		response.writeHead(404, {'Content-Type': 'text/plain'});
		response.end('Not found');
	});
	await new Promise((resolve, reject) => {
		rssServer.once('error', reject);
		rssServer.listen(0, '127.0.0.1', resolve);
	});
	const address = rssServer.address();
	if (!address || typeof address === 'string') throw new Error('RSS fixture failed to bind');
	return `http://127.0.0.1:${address.port}/feed.xml`;
};

const childEnvironment = (role, extra = {}) => ({
	...process.env,
	NODE_ENV: 'test',
	LOCALCAST_RUNTIME_MODE: 'test',
	LOCALCAST_PROCESS_ROLE: role,
	LOCALCAST_HOST: '127.0.0.1',
	PORT: String(apiPort),
	DATABASE_PATH: databasePath,
	MEDIA_PATH: mediaPath,
	LOCALCAST_WEB_DIST_PATH: path.join(repoRoot, 'dist'),
	LOCALCAST_TRUSTED_ORIGINS: allowedOrigin,
	TEXT_PROVIDER: 'fake',
	SPEECH_PROVIDER: 'fake',
	LOCALCAST_ALLOW_FAKE_PROVIDERS: 'true',
	RSS_SYNC_ON_START: '',
	RSS_SYNC_INTERVAL_MINUTES: '',
	...extra,
});

const startProcess = (entryPoint, role, extra = {}) => {
	const child = spawn(process.execPath, ['--import', 'tsx', entryPoint], {
		cwd: repoRoot,
		env: childEnvironment(role, extra),
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	children.add(child);
	for (const stream of [child.stdout, child.stderr]) {
		stream.on('data', chunk => output.push(chunk.toString()));
	}
	child.once('exit', () => children.delete(child));
	return child;
};

const stopProcess = async child => {
	if (!child || child.exitCode !== null) return;
	child.kill('SIGTERM');
	const result = await Promise.race([
		new Promise(resolve => child.once('exit', () => resolve('exit'))),
		new Promise(resolve => setTimeout(() => resolve('timeout'), 3_000)),
	]);
	if (result === 'timeout' && child.exitCode === null) {
		child.kill('SIGKILL');
		throw new Error(`Child process did not stop cleanly:\n${output.join('')}`);
	}
	if (child.exitCode !== 0) throw new Error(`Child process exited ${child.exitCode} during graceful shutdown:\n${output.join('')}`);
};

const request = async (pathname, init = {}) => {
	const response = await fetch(`${baseUrl}${pathname}`, init);
	const text = await response.text();
	let body;
	try {
		body = text ? JSON.parse(text) : undefined;
	} catch {
		body = text;
	}
	return {response, body};
};

const waitForApi = async child => {
	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) throw new Error(`API exited before readiness:\n${output.join('')}`);
		try {
			const health = await request('/health', {headers: {Origin: allowedOrigin}});
			if (health.response.ok && health.body?.ok === true) return;
		} catch {
			// The socket is not listening yet.
		}
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	throw new Error(`API readiness timed out:\n${output.join('')}`);
};

const waitForRun = async (runId, terminal) => {
	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		const result = await request(`/briefing-runs/${encodeURIComponent(runId)}`);
		assert(result.response.ok, 'briefing lookup should succeed while polling');
		if (result.body.status === terminal) return result.body;
		if (result.body.status === 'complete' || result.body.status === 'failed') {
			throw new Error(`Run reached unexpected terminal state ${result.body.status}`);
		}
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	throw new Error(`Run did not reach ${terminal} before timeout`);
};

let app;
let worker;

try {
	apiPort = await reservePort();
	baseUrl = `http://127.0.0.1:${apiPort}/api`;
	const feedUrl = await startFeed();
	app = startProcess('server/index.ts', 'app');
	await waitForApi(app);

	const health = await request('/health', {headers: {Origin: allowedOrigin}});
	assert(health.response.headers.get('access-control-allow-origin') === allowedOrigin, 'trusted Origin should be reflected');
	assert(health.body.providers.text.status === 'CONTRACT TESTED ONLY', 'test text provider should report contract-only status');
	assert(health.body.providers.speech.status === 'CONTRACT TESTED ONLY', 'test speech provider should report contract-only status');

	const blocked = await request('/health', {headers: {Origin: blockedOrigin}});
	assert(blocked.response.status === 403 && blocked.body.code === 'ORIGIN_NOT_ALLOWED', 'unexpected Origin should fail closed');

	const initialSources = await request('/sources');
	const initialRuns = await request('/briefing-runs');
	assert(initialSources.body.length === 0 && initialRuns.body.length === 0, 'fresh runtime must not seed demo data');

	const settings = await request('/settings');
	assert(settings.body.generationEnabled === true, 'explicit test fakes should enable generation');
	assert(!JSON.stringify(settings.body).match(/apiKey|secret|token/i), 'settings API must not expose secret fields');
	const rejectedLegacySettings = await request('/settings', {
		method: 'PUT',
		headers: {'Content-Type': 'application/json'},
		body: JSON.stringify({
			theme: 'system', contrastMode: 'normal', colorVisionMode: 'default', textSize: 'normal', density: 'normal',
			aiConfig: {apiKey: 'secret-canary'},
		}),
	});
	assert(rejectedLegacySettings.response.status === 400, 'browser-facing settings must reject provider key fields');

	const rejectedTopic = await request('/sources', {
		method: 'POST', headers: {'Content-Type': 'application/json'},
		body: JSON.stringify({type: 'manual_topic', name: 'Direction', description: 'Focus on changes only', isActive: true}),
	});
	assert(rejectedTopic.response.status === 400, 'legacy topic-as-source creation must be rejected');

	const feed = await request('/sources', {
		method: 'POST', headers: {'Content-Type': 'application/json'},
		body: JSON.stringify({type: 'rss', name: 'Fixture RSS', url: feedUrl, isActive: true}),
	});
	assert(feed.response.status === 201, 'RSS source should persist');
	await new Promise(resolve => setTimeout(resolve, 350));
	const beforeExplicitSync = await request(`/sources/${encodeURIComponent(feed.body.id)}/items`);
	const runsBeforeExplicitAction = await request('/briefing-runs');
	assert(feedRequestCount === 0, 'elapsed time after startup must not trigger an automatic feed fetch');
	assert(beforeExplicitSync.body.length === 0 && runsBeforeExplicitAction.body.length === 0, 'elapsed time after startup must not create items or generation jobs');
	const synced = await request(`/sources/${encodeURIComponent(feed.body.id)}/sync`, {method: 'POST'});
	assert(synced.response.ok && synced.body.insertedCount === 1, 'explicit RSS sync should store fixture evidence');
	assert(feedRequestCount === 1, 'explicit feed sync should perform exactly one fixture fetch');

	const enqueue = await request('/briefing-runs', {
		method: 'POST',
		headers: {'Content-Type': 'application/json', 'Idempotency-Key': 'smoke-idempotency-0001'},
		body: JSON.stringify({sourceIds: [feed.body.id]}),
	});
	assert(enqueue.response.status === 201 && enqueue.body.status === 'queued', 'explicit action should durably enqueue work');
	const replay = await request('/briefing-runs', {
		method: 'POST',
		headers: {'Content-Type': 'application/json', 'Idempotency-Key': 'smoke-idempotency-0001'},
		body: JSON.stringify({sourceIds: [feed.body.id]}),
	});
	assert(replay.response.status === 200 && replay.body.job.id === enqueue.body.job.id, 'enqueue replay must be idempotent');

	await new Promise(resolve => setTimeout(resolve, 350));
	const beforeWorker = await request(`/briefing-runs/${encodeURIComponent(enqueue.body.id)}`);
	assert(beforeWorker.body.status === 'queued' && beforeWorker.body.job.attemptCount === 0, 'API process must not execute detached work');

	worker = startProcess('server/testing/worker.ts', 'worker', {LOCALCAST_WORKER_ID: 'smoke-worker-success'});
	const completed = await waitForRun(enqueue.body.id, 'complete');
	assert(completed.sections.length > 0, 'worker should persist deterministic transcript sections');
	assert(completed.sections.some(section => section.sourceItemIds.length > 0), 'deterministic output should contain a source citation');
	assert(completed.audioAsset?.format === 'mp3', 'worker should persist an MP3 asset record');
	const audioFile = path.join(mediaPath, path.basename(completed.audioAsset.url));
	assert(fs.statSync(audioFile).size === 417, 'test speech adapter should publish deterministic fixture bytes');
	await stopProcess(worker);
	worker = undefined;

	const repeatEnqueue = await request('/briefing-runs', {
		method: 'POST',
		headers: {'Content-Type': 'application/json', 'Idempotency-Key': 'smoke-idempotency-repeat-0001'},
		body: JSON.stringify({sourceIds: [feed.body.id]}),
	});
	worker = startProcess('server/testing/worker.ts', 'worker', {LOCALCAST_WORKER_ID: 'smoke-worker-repeat'});
	const repeated = await waitForRun(repeatEnqueue.body.id, 'complete');
	const normalizedSections = run => run.sections.map(({title, type, spokenText, sourceItemIds, importanceScore, followUpPrompts}) => ({
		title, type, spokenText, sourceItemIds, importanceScore, followUpPrompts,
	}));
	assert(JSON.stringify(normalizedSections(repeated)) === JSON.stringify(normalizedSections(completed)), 'equivalent fake inputs must produce repeatable transcript content');
	const repeatedAudioFile = path.join(mediaPath, path.basename(repeated.audioAsset.url));
	assert(Buffer.compare(fs.readFileSync(audioFile), fs.readFileSync(repeatedAudioFile)) === 0, 'equivalent fake inputs must produce byte-identical MP3 fixtures');
	await stopProcess(worker);
	worker = undefined;

	const failingEnqueue = await request('/briefing-runs', {
		method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({sourceIds: [feed.body.id]}),
	});
	worker = startProcess('server/testing/worker.ts', 'worker', {
		LOCALCAST_WORKER_ID: 'smoke-worker-failure',
		LOCALCAST_FAKE_FAILURE_PHASE: 'drafting',
	});
	const failed = await waitForRun(failingEnqueue.body.id, 'failed');
	assert(failed.job.errorCode === 'GENERATION_FAILED' && failed.job.retryable === true, 'injected failure should be safely retryable');
	assert(!JSON.stringify(failed).match(/secret-canary|source-canary|provider-body-canary|private\/path-canary/), 'browser-facing failure must redact raw details');
	await stopProcess(worker);
	worker = undefined;

	await stopProcess(app);
	app = startProcess('server/index.ts', 'app');
	await waitForApi(app);
	const persisted = await request(`/briefing-runs/${encodeURIComponent(enqueue.body.id)}`);
	assert(persisted.body.status === 'complete' && persisted.body.sections.length > 0, 'completed work must survive API restart');

	const sqlite = new Database(databasePath, {readonly: true});
	try {
		const events = sqlite.prepare('SELECT phase FROM generation_job_events WHERE job_id = ? ORDER BY id').all(enqueue.body.job.id).map(row => row.phase);
		assert(JSON.stringify(events) === JSON.stringify(['queued', 'syncing', 'selecting', 'drafting', 'validating', 'rendering_audio', 'complete']), 'persisted phases must be complete and ordered');
		assert(sqlite.prepare('SELECT COUNT(*) AS count FROM generation_jobs').get().count === 3, 'only explicit requests should create jobs');
		assert(sqlite.prepare("SELECT COUNT(*) AS count FROM generation_jobs WHERE state = 'running'").get().count === 0, 'no active lease should remain after workers stop');
	} finally {
		sqlite.close();
	}

	assert(!output.join('').match(/secret-canary|source-canary|provider-body-canary|private\/path-canary/), 'process logs must redact injected raw details');
	console.log('API and worker smoke checks passed');
} finally {
	for (const child of [...children]) {
		try {
			await stopProcess(child);
		} catch {
			// Preserve the primary smoke failure while still cleaning up owned children.
		}
	}
	if (rssServer) await new Promise(resolve => rssServer.close(resolve));
	fs.rmSync(temporaryRoot, {recursive: true, force: true});
}
