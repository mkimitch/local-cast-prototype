import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import {createServer} from 'node:http';
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
let rssServer;
let rssFeedUrl;

const rssFixture = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
  <channel>
    <title>LocalCast Smoke Feed</title>
    <link>http://127.0.0.1/</link>
    <description>Smoke test RSS feed</description>
    <item>
      <guid>smoke-item-1</guid>
      <title>Smoke RSS Story One</title>
      <link>http://127.0.0.1/stories/one</link>
      <author>smoke@example.test</author>
      <pubDate>Mon, 06 Jul 2026 12:00:00 GMT</pubDate>
      <description>First real RSS item for the LocalCast smoke test.</description>
    </item>
    <item>
      <guid>smoke-item-2</guid>
      <title>Smoke RSS Story Two</title>
      <link>http://127.0.0.1/stories/two</link>
      <pubDate>Mon, 06 Jul 2026 12:05:00 GMT</pubDate>
      <description>Second real RSS item for duplicate prevention checks.</description>
    </item>
  </channel>
</rss>`;

const startRssFixture = async () => {
  rssServer = createServer((req, res) => {
    if (req.url === '/feed.xml') {
      res.writeHead(200, {'Content-Type': 'application/rss+xml; charset=utf-8'});
      res.end(rssFixture);
      return;
    }

    res.writeHead(404, {'Content-Type': 'text/plain'});
    res.end('Not found');
  });

  await new Promise(resolve => rssServer.listen(0, '127.0.0.1', resolve));
  const address = rssServer.address();
  if (!address || typeof address === 'string') throw new Error('RSS fixture did not bind to a TCP port');
  rssFeedUrl = `http://127.0.0.1:${address.port}/feed.xml`;
};

const stopRssFixture = async () => {
  if (!rssServer) return;
  await new Promise(resolve => rssServer.close(resolve));
};

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
	await startRssFixture();
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

  await request('/sources/src-1', {
    method: 'PATCH',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({isActive: false}),
  });

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

  const createdRssSource = await request('/sources', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      type: 'rss',
      name: 'Smoke RSS',
      url: rssFeedUrl,
      isActive: true,
    }),
  });
  assert(createdRssSource.response.status === 201, 'valid RSS source create should return 201');

  const syncedRssSource = await request(`/sources/${encodeURIComponent(createdRssSource.body.id)}/sync`, {method: 'POST'});
  assert(syncedRssSource.response.ok, 'RSS source sync should succeed');
  assert(syncedRssSource.body.insertedCount === 2, 'initial RSS sync should insert fixture items');

  const sourcesAfterSuccessfulSync = await request('/sources');
  const successfulRssSource = sourcesAfterSuccessfulSync.body.find(source => source.id === createdRssSource.body.id);
  assert(successfulRssSource.status === 'healthy', 'successful RSS sync should mark source healthy');
  assert(successfulRssSource.lastSyncStatus === 'success', 'successful RSS sync should record success status');
  assert(typeof successfulRssSource.lastSyncedAt === 'string', 'successful RSS sync should record lastSyncedAt');
  assert(successfulRssSource.consecutiveSyncFailures === 0, 'successful RSS sync should reset failure count');
  assert(successfulRssSource.itemCount === 2, 'successful RSS sync should expose itemCount');
  assert(!successfulRssSource.lastSyncError, 'successful RSS sync should clear lastSyncError');
  assert(!successfulRssSource.nextSyncAfter, 'successful RSS sync should clear nextSyncAfter');

  const syncedItems = await request(`/sources/${encodeURIComponent(createdRssSource.body.id)}/items`);
  assert(syncedItems.response.ok, 'source item lookup should succeed');
  assert(syncedItems.body.length === 2, 'RSS source should expose two stored source items');
  assert(syncedItems.body.some(item => item.title === 'Smoke RSS Story One'), 'stored RSS items should include real feed titles');

  const searchedItems = await request(`/source-items?sourceId=${encodeURIComponent(createdRssSource.body.id)}&q=${encodeURIComponent('Story One')}&limit=1&offset=0`);
  assert(searchedItems.response.ok, 'source item search should succeed');
  assert(searchedItems.body.length === 1 && searchedItems.body[0].title === 'Smoke RSS Story One', 'source item q filter should narrow results');

  const rangedItems = await request(`/sources/${encodeURIComponent(createdRssSource.body.id)}/items?from=${encodeURIComponent('2026-07-06T12:03:00.000Z')}&to=${encodeURIComponent('2026-07-06T12:10:00.000Z')}`);
  assert(rangedItems.response.ok, 'source item date range should succeed');
  assert(rangedItems.body.length === 1 && rangedItems.body[0].title === 'Smoke RSS Story Two', 'source item date range should narrow results');

  const syncedAgain = await request(`/sources/${encodeURIComponent(createdRssSource.body.id)}/sync`, {method: 'POST'});
  assert(syncedAgain.response.ok, 'second RSS source sync should succeed');
  assert(syncedAgain.body.insertedCount === 0, 'second RSS sync should not duplicate fixture items');

  const syncedItemsAgain = await request(`/sources/${encodeURIComponent(createdRssSource.body.id)}/items`);
  assert(syncedItemsAgain.body.length === 2, 'RSS source item count should remain stable after duplicate sync');

  const failedRssSource = await request('/sources', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      type: 'rss',
      name: 'Broken Smoke RSS',
      url: rssFeedUrl.replace('/feed.xml', '/missing.xml'),
      isActive: true,
    }),
  });
  assert(failedRssSource.response.status === 201, 'broken RSS source create should return 201');

  const failedSync = await request(`/sources/${encodeURIComponent(failedRssSource.body.id)}/sync`, {method: 'POST'});
  assert(failedSync.response.status === 502, 'broken RSS source sync should return 502');

  const sourcesAfterFailedSync = await request('/sources');
  const failedSourceAfterSync = sourcesAfterFailedSync.body.find(source => source.id === failedRssSource.body.id);
  assert(failedSourceAfterSync.status === 'error', 'failed RSS sync should mark source error');
  assert(failedSourceAfterSync.lastSyncStatus === 'error', 'failed RSS sync should record error status');
  assert(failedSourceAfterSync.lastSyncError.includes('HTTP 404'), 'failed RSS sync should store readable error');
  assert(failedSourceAfterSync.consecutiveSyncFailures === 1, 'failed RSS sync should increment failure count');
  assert(typeof failedSourceAfterSync.nextSyncAfter === 'string', 'failed RSS sync should store nextSyncAfter');

  const syncAllSkipped = await request('/sources/sync', {method: 'POST'});
  assert(syncAllSkipped.response.ok, 'sync-all should succeed with mixed source health');
  assert(
    syncAllSkipped.body.skipped.some(source => source.sourceId === failedRssSource.body.id),
    'sync-all should skip a source whose backoff is still active',
  );

  const forcedSyncAll = await request('/sources/sync?force=true', {method: 'POST'});
  assert(forcedSyncAll.response.ok, 'forced sync-all should complete with mixed results');
  assert(
    forcedSyncAll.body.errors.some(source => source.sourceId === failedRssSource.body.id),
    'forced sync-all should retry and report the broken source error',
  );

  const sourcesAfterForcedSync = await request('/sources');
  const failedSourceAfterForcedSync = sourcesAfterForcedSync.body.find(source => source.id === failedRssSource.body.id);
  assert(failedSourceAfterForcedSync.consecutiveSyncFailures === 2, 'forced failed retry should increment failure count again');

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

  const rssRunCreate = await request('/briefing-runs', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({sourceIds: [createdRssSource.body.id]}),
  });
  assert(rssRunCreate.response.status === 201, 'RSS briefing run create should return 201');

  const completedRssRun = await pollRun(rssRunCreate.body.id);
  assert(completedRssRun.status === 'complete', 'RSS briefing run should complete');
  assert(completedRssRun.summary.includes('Smoke RSS Story One'), 'RSS briefing run should use stored real RSS item titles');

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

	const persistedRssItems = await request(`/sources/${encodeURIComponent(createdRssSource.body.id)}/items`);
	assert(persistedRssItems.response.ok, 'RSS source items should persist across API restart');
	assert(persistedRssItems.body.length === 2, 'persisted RSS item count should remain stable');

	const persistedSourcesAfterRestart = await request('/sources');
	const persistedFailedSource = persistedSourcesAfterRestart.body.find(source => source.id === failedRssSource.body.id);
	assert(persistedFailedSource.consecutiveSyncFailures === 2, 'failed sync metadata should persist across API restart');

	await stopServer();
	const sqlite = new Database(databasePath, {readonly: true});
	try {
		const migrations = sqlite.prepare('SELECT id FROM schema_migrations ORDER BY id').all().map(row => row.id);
		assert(migrations.includes('001_initial_schema'), 'initial schema migration should be recorded');
		assert(migrations.includes('002_source_item_identity'), 'source item identity migration should be recorded');
		assert(migrations.includes('003_source_sync_metadata'), 'source sync metadata migration should be recorded');

		const sourceItemColumns = sqlite.prepare('PRAGMA table_info(source_items)').all().map(row => row.name);
		assert(sourceItemColumns.includes('external_id'), 'source_items should include external_id column');
		assert(sourceItemColumns.includes('author'), 'source_items should include author column');

		const sourceColumns = sqlite.prepare('PRAGMA table_info(sources)').all().map(row => row.name);
		assert(sourceColumns.includes('last_synced_at'), 'sources should include last_synced_at column');
		assert(sourceColumns.includes('last_sync_status'), 'sources should include last_sync_status column');
		assert(sourceColumns.includes('last_sync_error'), 'sources should include last_sync_error column');
		assert(sourceColumns.includes('consecutive_sync_failures'), 'sources should include consecutive_sync_failures column');
		assert(sourceColumns.includes('next_sync_after'), 'sources should include next_sync_after column');
	} finally {
		sqlite.close();
	}

	console.log('API smoke checks passed');
} finally {
	await stopServer();
	await stopRssFixture();
	for (const suffix of ['', '-wal', '-shm']) {
		try {
			fs.unlinkSync(`${databasePath}${suffix}`);
		} catch {
			// Temporary database file may not exist if startup failed early.
		}
	}
}
