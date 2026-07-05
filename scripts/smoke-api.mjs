import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = process.env.SMOKE_API_PORT || '8899';
const baseUrl = `http://127.0.0.1:${port}/api`;
const allowedOrigin = 'http://localhost:3000';
const blockedOrigin = 'http://example.invalid';
const databasePath = path.join(os.tmpdir(), `localcast-smoke-${process.pid}.sqlite`);

let serverOutput = '';
let server;

const startServer = () => {
	serverOutput = '';
	server = spawn(path.join(repoRoot, 'node_modules/.bin/tsx'), ['server/index.ts'], {
		cwd: repoRoot,
		env: {
			...process.env,
			PORT: port,
			DATABASE_PATH: databasePath,
			AI_PROVIDER: 'mock',
			AI_MODEL: 'mock-localcast',
			CORS_ORIGIN: allowedOrigin,
		},
		stdio: ['ignore', 'pipe', 'pipe'],
	});

	server.stdout.on('data', chunk => {
		serverOutput += chunk.toString();
	});
	server.stderr.on('data', chunk => {
		serverOutput += chunk.toString();
	});
};

const stopServer = async () => {
	if (!server || server.exitCode !== null) return;

	await new Promise(resolve => {
		server.once('exit', resolve);
		server.kill('SIGTERM');
		setTimeout(resolve, 2000);
	});
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const request = async (pathName, init = {}) => {
  const response = await fetch(`${baseUrl}${pathName}`, init);
  const text = await response.text();
  const body = text ? JSON.parse(text) : undefined;
  return {response, body};
};

const waitForServer = async () => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 10000) {
    if (server.exitCode !== null) {
      throw new Error(`API server exited early.\n${serverOutput}`);
    }

    try {
      const {response, body} = await request('/health', {headers: {Origin: allowedOrigin}});
      if (response.ok && body?.ok === true) return;
    } catch {
      // Server is not listening yet.
    }

    await new Promise(resolve => setTimeout(resolve, 200));
  }

  throw new Error(`Timed out waiting for API server.\n${serverOutput}`);
};

const pollRun = async runId => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 10000) {
    const {response, body} = await request(`/briefing-runs/${encodeURIComponent(runId)}`);
    assert(response.ok, 'briefing run lookup should succeed');

    if (body.status === 'complete' || body.status === 'failed') return body;
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  throw new Error('briefing run did not complete before timeout');
};

try {
	startServer();
	await waitForServer();

  const health = await request('/health', {headers: {Origin: allowedOrigin}});
  assert(health.response.headers.get('access-control-allow-origin') === allowedOrigin, 'allowed CORS origin should be reflected');

  const blockedPreflight = await fetch(`${baseUrl}/health`, {
    method: 'OPTIONS',
    headers: {
      Origin: blockedOrigin,
      'Access-Control-Request-Method': 'GET',
    },
  });
  assert(blockedPreflight.status === 403, 'blocked CORS preflight should return 403');

  const invalidSource = await request('/sources', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({type: 'rss'}),
  });
  assert(invalidSource.response.status === 400, 'invalid source create should return 400');

  const createdSource = await request('/sources', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      type: 'manual_topic',
      name: 'Smoke Topic',
      description: 'Smoke test topic instructions',
      isActive: true,
    }),
  });
  assert(createdSource.response.status === 201, 'valid source create should return 201');
  assert(typeof createdSource.body?.id === 'string', 'created source should include an id');

  const settings = await request('/settings', {
    method: 'PUT',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      aiProvider: 'mock',
      aiConfig: {apiKey: 'do-not-return', model: 'mock-localcast'},
      ttsProvider: 'local',
      ttsConfig: {apiKey: 'do-not-return'},
      theme: 'system',
      contrastMode: 'normal',
      colorVisionMode: 'default',
      textSize: 'normal',
      density: 'normal',
    }),
  });
  assert(settings.response.ok, 'settings update should succeed');
  assert(!('apiKey' in settings.body.aiConfig), 'settings response should not include aiConfig.apiKey');
  assert(!('apiKey' in settings.body.ttsConfig), 'settings response should not include ttsConfig.apiKey');

  const runCreate = await request('/briefing-runs', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({sourceIds: [createdSource.body.id]}),
  });
  assert(runCreate.response.status === 201, 'briefing run create should return 201');
  assert(runCreate.body.status === 'queued', 'created run should start queued');

  const completedRun = await pollRun(runCreate.body.id);
  assert(completedRun.status === 'complete', 'mock briefing run should complete');
  assert(Array.isArray(completedRun.sections) && completedRun.sections.length > 0, 'completed run should include sections');

  const followUp = await request('/follow-up', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({question: 'What changed?', runId: completedRun.id}),
  });
	assert(followUp.response.ok, 'follow-up should succeed');
	assert(typeof followUp.body.answer === 'string' && followUp.body.answer.length > 0, 'follow-up should include an answer');

	await stopServer();
	startServer();
	await waitForServer();

	const persistedSources = await request('/sources');
	assert(
		persistedSources.body.some(source => source.id === createdSource.body.id),
		'created source should persist across API restart',
	);

	const persistedRun = await request(`/briefing-runs/${encodeURIComponent(completedRun.id)}`);
	assert(persistedRun.response.ok, 'created briefing run should persist across API restart');
	assert(persistedRun.body.status === 'complete', 'persisted briefing run should keep completed status');
	assert(Array.isArray(persistedRun.body.sections) && persistedRun.body.sections.length > 0, 'persisted run should include sections');

	console.log('API smoke checks passed');
} finally {
	await stopServer();
	for (const suffix of ['', '-wal', '-shm']) {
		try {
			fs.unlinkSync(`${databasePath}${suffix}`);
		} catch {
			// Temporary database file may not exist if startup failed early.
		}
	}
}
