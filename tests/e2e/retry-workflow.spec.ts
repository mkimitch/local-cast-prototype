import {expect, test} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const retryOrigin = 'http://127.0.0.1:43183';
const generationOrigin = 'http://127.0.0.1:43180';

test('a safe failed run retries once from the same durable episode URL', async ({page}) => {
	test.setTimeout(45_000);
	await page.goto(`${retryOrigin}/stations`);
	await page.getByLabel('Title').fill('Retry evidence note');
	await page.getByLabel('Pasted factual material').fill(Array.from({length: 800}, (_value, index) => `fact${String(index + 1).padStart(4, '0')}`).join(' '));
	await page.getByRole('button', {name: 'Save note', exact: true}).click();
	await page.getByLabel('Station name').fill('Retry browser station');
	await page.getByLabel('Topic and editorial direction').fill('Use the supplied retry evidence only.');
	const noteSelection = page.getByRole('checkbox', {name: 'Retry evidence note'});
	await noteSelection.focus();
	await page.keyboard.press('Space');
	await expect(noteSelection).toBeChecked();
	await page.getByRole('button', {name: 'Save station', exact: true}).click();
	await page.getByRole('button', {name: 'Sync and generate'}).click();

	await expect(page.getByRole('heading', {name: 'Generation failed'})).toBeVisible({timeout: 20_000});
	await expect(page.getByText('Code: GENERATION_FAILED')).toBeVisible();
	await expect(page.getByText(/Diagnostic reference: job-/)).toBeVisible();
	await expect(page.getByText(/secret-canary|source-canary|provider-body-canary|private\/path-canary/)).toHaveCount(0);
	const failedAccessibility = await new AxeBuilder({page}).include('main').analyze();
	expect(failedAccessibility.violations).toEqual([]);
	const runUrl = page.url();
	const runId = decodeURIComponent(new URL(runUrl).pathname.split('/').at(-1)!);
	const failed = await (await page.request.get(`${retryOrigin}/api/briefing-runs/${encodeURIComponent(runId)}`)).json();
	expect(failed.job).toMatchObject({attemptCount: 1, retryable: true, failedPhase: 'drafting'});
	const restart = await page.request.post('http://127.0.0.1:43184/restart-app');
	expect(restart.status()).toBe(204);
	await expect.poll(async () => {
		try { return (await page.request.get(`${retryOrigin}/api/health`)).status(); } catch { return 0; }
	}).toBe(200);
	await page.reload();
	await expect(page.getByRole('heading', {name: 'Generation failed'})).toBeVisible();
	await expect(page.getByText(/Diagnostic reference: job-/)).toBeVisible();

	const retryRequestPromise = page.waitForRequest(request => request.url().endsWith(`/api/briefing-runs/${encodeURIComponent(runId)}/retry`) && request.method() === 'POST');
	await page.getByRole('button', {name: 'Retry same evidence'}).click();
	const retryRequest = await retryRequestPromise;
	const retryKey = retryRequest.headers()['idempotency-key'];
	expect(retryKey).toBeTruthy();
	const replay = await page.request.post(`${retryOrigin}/api/briefing-runs/${encodeURIComponent(runId)}/retry`, {headers: {'Idempotency-Key': retryKey!}});
	expect(replay.status()).toBe(200);
	await expect(page.getByRole('heading', {name: 'Generation in progress'})).toBeVisible();
	await page.reload();
	await expect(page).toHaveURL(runUrl);
	await expect(page.getByText('AI-generated LocalCast audio')).toBeVisible({timeout: 25_000});
	await expect(page.locator('.detail-meta')).toContainText('Completed');
	const completeAccessibility = await new AxeBuilder({page}).include('main').analyze();
	expect(completeAccessibility.violations).toEqual([]);

	const complete = await (await page.request.get(`${retryOrigin}/api/briefing-runs/${encodeURIComponent(runId)}`)).json();
	expect(complete.job.attemptCount).toBe(2);
	expect(complete.job.attempts.map((attempt: {outcome: string}) => attempt.outcome)).toEqual(['failed', 'complete']);
	expect(complete.sections.length).toBeGreaterThan(1);
	expect(complete.sections.flatMap((section: {segments: unknown[]}) => section.segments).length).toBeGreaterThan(1);
	expect(complete.audioAsset.url).toMatch(/^\/media\/audio-run-/);
});

test('every retryable phase has safe, accurate, idempotent browser recovery', async ({page}) => {
	test.setTimeout(120_000);
	const phases = ['syncing', 'selecting', 'drafting', 'validating', 'rendering_audio'] as const;
	for (const phase of phases) {
		const configured = await page.request.post(`http://127.0.0.1:43184/configure-failure/${phase}`);
		expect(configured.status()).toBe(204);
		const noteResponse = await page.request.post(`${retryOrigin}/api/notes`, {data: {
			title: `Phase ${phase} evidence`,
			body: Array.from({length: 800}, (_value, index) => `${phase}fact${String(index + 1).padStart(4, '0')}`).join(' '),
		}});
		const note = await noteResponse.json();
		const stationResponse = await page.request.post(`${retryOrigin}/api/stations`, {data: {
			name: `Phase ${phase} station`,
			topicInstruction: 'Use only this phase fixture.',
			defaultMode: 'brief',
			noteIds: [note.id],
			sourceIds: [],
		}});
		expect(stationResponse.status()).toBe(201);

		await page.goto(`${retryOrigin}/stations`);
		const row = page.getByRole('article').filter({has: page.getByRole('heading', {name: `Phase ${phase} station`})});
		await row.getByRole('button', {name: 'Sync and generate'}).click();
		await expect(page.getByRole('heading', {name: 'Generation failed'})).toBeVisible({timeout: 15_000});
		const runId = decodeURIComponent(new URL(page.url()).pathname.split('/').at(-1)!);
		const failed = await (await page.request.get(`${retryOrigin}/api/briefing-runs/${encodeURIComponent(runId)}`)).json();
		expect(failed.job).toMatchObject({attemptCount: 1, retryable: true, failedPhase: phase});
		await expect(page.getByText(`failed during ${phase}`, {exact: false})).toBeVisible();
		await expect(page.getByText(/secret-canary|source-canary|provider-body-canary|private\/path-canary/)).toHaveCount(0);
		const retryName = failed.job.evidenceFrozen ? 'Retry same evidence' : 'Retry before freezing evidence';
		if (!failed.job.evidenceFrozen) await expect(page.getByRole('note')).toContainText('OpenAI receives the selected supplied material');
		const retryButton = page.getByRole('button', {name: retryName});
		await retryButton.focus();
		await page.keyboard.press('Enter');
		await expect(page.getByText('AI-generated LocalCast audio')).toBeVisible({timeout: 20_000});
		const complete = await (await page.request.get(`${retryOrigin}/api/briefing-runs/${encodeURIComponent(runId)}`)).json();
		expect(complete.job.attemptCount).toBe(2);
		expect(complete.job.attempts.map((attempt: {outcome: string}) => attempt.outcome)).toEqual(['failed', 'complete']);
		const segments = complete.sections.flatMap((section: {segments: Array<{id: string}>}) => section.segments);
		expect(new Set(segments.map((segment: {id: string}) => segment.id)).size).toBe(segments.length);
		const accessibility = await new AxeBuilder({page}).include('main').analyze();
		expect(accessibility.violations).toEqual([]);
	}
});

test('insufficient material requires changed inputs and offers no retry', async ({page}) => {
	test.setTimeout(30_000);
	const noteResponse = await page.request.post(`${generationOrigin}/api/notes`, {data: {title: 'Sparse browser evidence', body: 'one two three four five six seven eight nine ten'}});
	const note = await noteResponse.json();
	const stationResponse = await page.request.post(`${generationOrigin}/api/stations`, {data: {
		name: 'Sparse browser station',
		topicInstruction: 'Do not invent missing facts.',
		defaultMode: 'brief',
		noteIds: [note.id],
		sourceIds: [],
	}});
	expect(stationResponse.status()).toBe(201);
	await page.goto(`${generationOrigin}/stations`);
	const row = page.getByRole('article').filter({has: page.getByRole('heading', {name: 'Sparse browser station'})});
	await row.getByRole('button', {name: 'Sync and generate'}).click();
	await expect(page.getByRole('heading', {name: 'Generation failed'})).toBeVisible({timeout: 15_000});
	await expect(page.getByText('Code: INSUFFICIENT_SOURCE_MATERIAL')).toBeVisible();
	await expect(page.getByRole('button', {name: /Retry/})).toHaveCount(0);
	await expect(page.getByText('New or changed input is required:', {exact: false})).toBeVisible();
	await expect(page.getByRole('link', {name: 'Review station and generation options.'})).toBeVisible();
});

test('deep mode can be selected per run and persists a materially long transcript', async ({page}) => {
	test.setTimeout(50_000);
	const noteResponse = await page.request.post(`${generationOrigin}/api/notes`, {data: {
		title: 'Deep browser evidence',
		body: Array.from({length: 2_300}, (_value, index) => `fact${String(index + 1).padStart(4, '0')}`).join(' '),
	}});
	expect(noteResponse.status()).toBe(201);
	const note = await noteResponse.json();
	const stationResponse = await page.request.post(`${generationOrigin}/api/stations`, {data: {
		name: 'Deep browser station',
		topicInstruction: 'Build a source-grounded deep dive without outside research.',
		defaultMode: 'brief',
		noteIds: [note.id],
		sourceIds: [],
	}});
	expect(stationResponse.status()).toBe(201);

	await page.goto(`${generationOrigin}/stations`);
	await page.getByLabel('Generation mode for Deep browser station').selectOption('deep');
	const row = page.getByRole('article').filter({has: page.getByRole('heading', {name: 'Deep browser station'})});
	await row.getByRole('button', {name: 'Sync and generate'}).click();
	await expect(page.getByText('AI-generated LocalCast audio')).toBeVisible({timeout: 30_000});
	const runId = decodeURIComponent(new URL(page.url()).pathname.split('/').at(-1)!);
	const complete = await (await page.request.get(`${generationOrigin}/api/briefing-runs/${encodeURIComponent(runId)}`)).json();
	const words = complete.sections
		.flatMap((section: {segments: Array<{text: string}>}) => section.segments)
		.flatMap((segment: {text: string}) => segment.text.trim().split(/\s+/))
		.length;
	expect(complete.mode).toBe('deep');
	expect(words).toBeGreaterThanOrEqual(1_800);
	expect(words).toBeLessThanOrEqual(3_000);
	expect(complete.sections.flatMap((section: {segments: Array<{speakerRole: string}>}) => section.segments).every((segment: {speakerRole: string}) => segment.speakerRole === 'host')).toBe(true);

	await page.request.put(`${generationOrigin}/api/settings`, {data: {
		theme: 'dark',
		contrastMode: 'high',
		colorVisionMode: 'default',
		textSize: 'extra-large',
		density: 'comfortable',
	}});
	await page.emulateMedia({reducedMotion: 'reduce'});
	await page.setViewportSize({width: 320, height: 800});
	await page.reload();
	await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
	await expect(page.getByRole('heading', {name: 'Transcript & validated citations'})).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
	const openPlayer = page.getByRole('button', {name: 'Open player'});
	await openPlayer.focus();
	await page.keyboard.press('Enter');
	const player = page.getByRole('region', {name: 'Persistent episode player'});
	await expect(player).toBeVisible();
	await page.getByRole('button', {name: 'Play episode'}).focus();
	await page.keyboard.press('Enter');
	await expect.poll(() => page.getByLabel(/AI-generated episode media for/).evaluate(element => !(element as HTMLAudioElement).paused)).toBe(true);
	await page.getByRole('button', {name: 'Pause episode'}).press('Enter');
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
	const playerBox = await player.boundingBox();
	expect(playerBox).not.toBeNull();
	expect(playerBox!.x).toBeGreaterThanOrEqual(0);
	expect(playerBox!.width).toBeLessThanOrEqual(320);
	expect(playerBox!.y).toBeGreaterThanOrEqual(0);
	expect(playerBox!.y + playerBox!.height).toBeLessThanOrEqual(800);
	const compactAccessibility = await new AxeBuilder({page}).include('main').include('.audio-player').analyze();
	expect(compactAccessibility.violations).toEqual([]);
	await page.screenshot({path: '/tmp/localcast-slice3-mobile.png', fullPage: true});
});
