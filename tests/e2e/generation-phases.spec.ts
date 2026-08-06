import {expect, test} from '@playwright/test';

const origin = 'http://127.0.0.1:43180';

test('explicit browser action observes durable ordered phases across reload', async ({page}) => {
	test.setTimeout(45_000);
	await page.goto(`${origin}/stations`);
	await expect(page.getByRole('note', {name: 'External provider disclosure'})).toBeVisible();
	await page.getByLabel('Title').fill('Browser walking-skeleton note');
	await page.getByLabel('Pasted factual material').fill([
		'LocalCast starts generation only after a person chooses Sync and generate.',
		'A separate worker processes one persistent job at a time.',
		'SQLite records every generation phase and preserves evidence before provider use.',
		'The station direction shapes synthesis but is not factual evidence.',
		'Completed episodes preserve a transcript, citations, and persisted audio metadata.',
		'This supplied browser note is long enough for deterministic adequacy validation.',
	].join(' '));
	await page.getByRole('button', {name: 'Save note', exact: true}).click();
	await page.getByLabel('Station name').fill('Browser fixture station');
	await page.getByLabel('Topic and editorial direction').fill('Explain the supplied LocalCast facts in a calm order.');
	const noteSelection = page.getByRole('checkbox', {name: 'Browser walking-skeleton note'});
	await noteSelection.focus();
	await page.keyboard.press('Space');
	await expect(noteSelection).toBeChecked();
	await page.getByRole('button', {name: 'Save station', exact: true}).click();
	await page.waitForTimeout(500);
	expect(await (await page.request.get('http://127.0.0.1:43181/request-count')).json()).toEqual({count: 0});
	expect(await (await page.request.get(`${origin}/api/briefing-runs`)).json()).toEqual([]);

	const beforeAction = await page.request.get(`${origin}/api/briefing-runs`);
	expect(await beforeAction.json()).toEqual([]);

	const generate = page.getByRole('button', {name: 'Sync and generate'});
	await expect(generate).toBeEnabled();
	await generate.click();

	const observed: string[] = [];
	let reloaded = false;
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		const active = page.locator('.step[data-state="active"] .step__label');
		if (await active.count()) {
			const label = (await active.textContent())?.trim();
			if (label && observed.at(-1) !== label) observed.push(label);
			if (label === 'Freezing supplied evidence' && !reloaded) {
				reloaded = true;
				await page.reload();
			}
		}
		if (await page.getByText('AI-generated LocalCast audio').isVisible().catch(() => false)) break;
		await page.waitForTimeout(150);
	}

	expect(reloaded).toBe(true);
	expect(observed).toEqual([
		'Queued',
		'Synchronizing selected sources',
		'Freezing supplied evidence',
		'Drafting transcript',
		'Validating citations',
		'Synthesizing AI audio',
	]);
	await expect(page.getByText('AI-generated LocalCast audio')).toBeVisible();
	await expect(page.getByRole('heading', {name: 'Transcript & validated citations'})).toBeVisible();
	await expect(page.getByRole('list', {name: 'Validated citations'})).toBeVisible();
	await expect(page.getByText('Browser walking-skeleton note').last()).toBeVisible();
	const audio = page.getByLabel(/Play AI-generated episode/).first();
	const mediaPath = await audio.getAttribute('src');
	expect(mediaPath).toMatch(/^\/media\/audio-run-/);
	const media = await page.request.get(`${origin}${mediaPath}`);
	expect(media.status()).toBe(200);
	expect(media.headers()['content-type']).toContain('audio/mpeg');
	expect(Number(media.headers()['content-length'])).toBeGreaterThan(1_000);
	const playback = await audio.evaluate(async element => {
		const mediaElement = element as HTMLAudioElement;
		if (mediaElement.readyState < 1) await new Promise<void>((resolve, reject) => {
			mediaElement.addEventListener('loadedmetadata', () => resolve(), {once: true});
			mediaElement.addEventListener('error', () => reject(new Error('fixture MP3 did not decode')), {once: true});
		});
		await mediaElement.play();
		await new Promise(resolve => setTimeout(resolve, 100));
		const result = {duration: mediaElement.duration, paused: mediaElement.paused};
		mediaElement.pause();
		return result;
	});
	expect(playback.duration).toBeGreaterThan(0.4);
	expect(playback.paused).toBe(false);

	const runs = await (await page.request.get(`${origin}/api/briefing-runs`)).json();
	expect(runs).toHaveLength(1);
	const eventsDatabaseEvidence = runs[0].job;
	expect(eventsDatabaseEvidence.phase).toBe('complete');
	expect(eventsDatabaseEvidence.attemptCount).toBe(1);
});
