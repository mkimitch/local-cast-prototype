import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localcast-e2e-generation-'));
const appPort = process.env.E2E_GENERATION_PORT || '43180';
const feedPort = process.env.E2E_FEED_PORT || '43181';
const databasePath = path.join(root, 'localcast.sqlite');
const mediaPath = path.join(root, 'media');
const environment = {
	...process.env,
	NODE_ENV: 'test',
	LOCALCAST_RUNTIME_MODE: 'test',
	LOCALCAST_HOST: '127.0.0.1',
	PORT: appPort,
	DATABASE_PATH: databasePath,
	MEDIA_PATH: mediaPath,
	LOCALCAST_WEB_DIST_PATH: path.resolve('dist'),
	LOCALCAST_TRUSTED_ORIGINS: `http://127.0.0.1:${appPort}`,
	TEXT_PROVIDER: 'fake',
	SPEECH_PROVIDER: 'fake',
	LOCALCAST_ALLOW_FAKE_PROVIDERS: 'true',
	LOCALCAST_FAKE_PHASE_DELAY_MS: '2000',
	LOCALCAST_LEASE_MS: '5000',
	LOCALCAST_WORKER_POLL_MS: '25',
	LOCALCAST_SHUTDOWN_MS: '2000',
};

const feedXml = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0"><channel><title>Browser fixture</title><link>http://127.0.0.1/</link><description>Fixture</description>
<item><guid>browser-item-1</guid><title>Browser Phase Evidence</title><description>Supplied evidence for the browser phase test.</description></item>
</channel></rss>`;

let feedRequestCount = 0;
const feedServer = createServer((request, response) => {
	if (request.url === '/feed.xml') {
		feedRequestCount += 1;
		response.writeHead(200, {'Content-Type': 'application/rss+xml; charset=utf-8'});
		response.end(feedXml);
		return;
	}
	if (request.url === '/request-count') {
		response.writeHead(200, {'Content-Type': 'application/json'});
		response.end(JSON.stringify({count: feedRequestCount}));
		return;
	}
	response.writeHead(404, {'Content-Type': 'text/plain'});
	response.end('Not found');
});

await new Promise((resolve, reject) => {
	feedServer.once('error', reject);
	feedServer.listen(Number(feedPort), '127.0.0.1', resolve);
});

const application = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
	env: {...environment, LOCALCAST_PROCESS_ROLE: 'app'},
	stdio: 'inherit',
});
let worker;
let workerStartTimer;
const jobMonitor = setInterval(() => {
	if (worker || workerStartTimer || !fs.existsSync(databasePath)) return;
	try {
		const database = new Database(databasePath, {readonly: true});
		const table = database.prepare("SELECT name FROM sqlite_master WHERE name = 'generation_jobs'").get();
		const count = table ? (database.prepare('SELECT COUNT(*) AS count FROM generation_jobs').get()).count : 0;
		database.close();
		if (count > 0) {
			workerStartTimer = setTimeout(() => {
				worker = spawn(process.execPath, ['--import', 'tsx', 'server/testing/worker.ts'], {
					env: {...environment, LOCALCAST_PROCESS_ROLE: 'worker', LOCALCAST_WORKER_ID: 'browser-phase-worker'},
					stdio: 'inherit',
				});
			}, 1_000);
		}
	} catch {
		// App startup or a concurrent transaction is still in progress.
	}
}, 100);

let stopping = false;
let finish;
const finished = new Promise(resolve => { finish = resolve; });

const stop = async signal => {
	if (stopping) return;
	stopping = true;
	clearInterval(jobMonitor);
	if (workerStartTimer) clearTimeout(workerStartTimer);
	for (const child of [worker, application]) {
		if (child && child.exitCode === null) child.kill(signal);
	}
	await Promise.all([worker, application].filter(Boolean).map(child => new Promise(resolve => {
		if (child.exitCode !== null) resolve();
		else child.once('exit', resolve);
	})));
	await new Promise(resolve => feedServer.close(resolve));
	fs.rmSync(root, {recursive: true, force: true});
	finish();
};

process.once('SIGTERM', () => void stop('SIGTERM'));
process.once('SIGINT', () => void stop('SIGINT'));
application.once('exit', code => {
	if (!stopping) {
		console.error(`Generation E2E application exited unexpectedly with ${code}`);
		process.exitCode = code || 1;
		void stop('SIGTERM');
	}
});

await finished;
