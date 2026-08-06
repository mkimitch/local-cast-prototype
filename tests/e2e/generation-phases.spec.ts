import {expect, test} from '@playwright/test';

const origin = 'http://127.0.0.1:43180';

test('explicit browser action observes durable ordered phases across reload', async ({page}) => {
	test.setTimeout(60_000);
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
		const labels = await active.allTextContents();
		if (labels.length > 0) {
			const label = labels[0]?.trim();
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
	await expect(page.getByRole('list', {name: /Validated citations for transcript segment/}).first()).toBeVisible();
	await expect(page.getByText('Browser walking-skeleton note').last()).toBeVisible();
	const openPlayer = page.getByRole('button', {name: 'Open player'});
	await openPlayer.click();
	const audio = page.getByLabel(/AI-generated episode media for/);
	const mediaPath = await audio.getAttribute('src');
	expect(mediaPath).toMatch(/^\/media\/audio-run-/);
	const media = await page.request.get(`${origin}${mediaPath}`);
	expect(media.status()).toBe(200);
	expect(media.headers()['content-type']).toContain('audio/mpeg');
	expect(Number(media.headers()['content-length'])).toBeGreaterThan(1_000);
	await audio.evaluate(async element => {
		const mediaElement = element as HTMLAudioElement;
		if (mediaElement.readyState < 1) await new Promise<void>((resolve, reject) => {
			mediaElement.addEventListener('loadedmetadata', () => resolve(), {once: true});
			mediaElement.addEventListener('error', () => reject(new Error('fixture MP3 did not decode')), {once: true});
		});
	});
	await page.getByRole('button', {name: 'Play episode'}).click();
	await expect.poll(() => audio.evaluate(element => !(element as HTMLAudioElement).paused)).toBe(true);
	await page.getByRole('button', {name: 'Pause episode'}).click();
	await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).paused)).toBe(true);
	await audio.evaluate(element => {
		element.dataset.seekEvents = '0';
		element.addEventListener('seeking', () => {
			element.dataset.seekEvents = String(Number(element.dataset.seekEvents || '0') + 1);
		});
	});
	await page.getByRole('button', {name: 'Skip forward 30 seconds'}).click();
	await expect.poll(() => audio.evaluate(element => Number(element.dataset.seekEvents || '0'))).toBeGreaterThan(0);
	const forwardSeekEvents = await audio.evaluate(element => Number(element.dataset.seekEvents || '0'));
	await page.getByRole('button', {name: 'Skip back 15 seconds'}).click();
	await expect.poll(() => audio.evaluate(element => Number(element.dataset.seekEvents || '0'))).toBeGreaterThan(forwardSeekEvents);
	await page.getByLabel('Playback speed').selectOption('1.5');
	expect(await audio.evaluate(element => (element as HTMLAudioElement).playbackRate)).toBe(1.5);
	await expect(page.getByRole('link', {name: /Download MP3 for/})).toHaveAttribute('href', mediaPath!);
	await page.screenshot({path: '/tmp/localcast-slice3-desktop.png', fullPage: true});
	await audio.evaluate(element => element.dispatchEvent(new Event('error')));
	await expect(page.getByRole('alert').filter({hasText: 'Playback failed'})).toBeVisible();
	await page.getByRole('button', {name: 'Close player'}).click();
	await expect(openPlayer).toBeFocused();

	const runs = await (await page.request.get(`${origin}/api/briefing-runs`)).json();
	expect(runs).toHaveLength(1);
	const eventsDatabaseEvidence = runs[0].job;
	expect(eventsDatabaseEvidence.phase).toBe('complete');
	expect(eventsDatabaseEvidence.attemptCount).toBe(1);

	await page.getByRole('button', {name: 'Back to episodes'}).click();
	await expect(page.getByRole('heading', {name: 'Episodes'})).toBeFocused();
	await page.getByLabel('Status').selectOption('complete');
	await page.getByLabel('Mode', {exact: true}).selectOption('brief');
	await expect(page).toHaveURL(/status=complete.*mode=brief|mode=brief.*status=complete/);
	await page.reload();
	await expect(page.getByRole('heading', {name: 'Browser fixture station'})).toBeVisible();
	await page.getByLabel('Mode', {exact: true}).selectOption('deep');
	await expect(page.getByText('No episodes match these filters')).toBeVisible();
	await page.goBack();
	await expect(page.getByLabel('Mode', {exact: true})).toHaveValue('brief');
});

test('RSS and Atom source lifecycle, FTS search, and selected-feed generation stay explicit and grounded', async ({page}) => {
	test.setTimeout(45_000);
	await page.goto(`${origin}/sources`);
	const addFeed = async (name: string, url: string) => {
		await page.getByRole('button', {name: 'Add RSS or Atom feed'}).click();
		await page.getByLabel('Source name').fill(name);
		await page.getByLabel('Credential-free HTTP(S) feed URL').fill(url);
		await page.getByRole('button', {name: 'Save feed', exact: true}).click();
		await expect(page.getByRole('heading', {name})).toBeVisible();
	};
	await addFeed('Selected RSS feed', 'http://127.0.0.1:43181/feed.xml');
	await addFeed('Unselected Atom feed', 'http://127.0.0.1:43181/atom.xml');

	await page.getByRole('button', {name: 'Synchronize Selected RSS feed'}).click();
	await expect(page.getByText(/Selected RSS feed synchronized/)).toBeAttached();
	const inspectSelected = page.getByRole('button', {name: 'Inspect items from Selected RSS feed'});
	await inspectSelected.click();
	await expect(page.getByRole('region', {name: 'Selected RSS feed items'})).toBeFocused();
	await page.getByRole('button', {name: 'Close source item review'}).click();
	await expect(inspectSelected).toBeFocused();
	await page.getByLabel('Search feed items and pasted notes').fill('lighthouse');
	await page.getByRole('button', {name: 'Search', exact: true}).click();
	await expect(page.getByRole('heading', {name: 'Browser Feed Lighthouse'})).toBeVisible();
	await expect(page.getByText('Feed item', {exact: true})).toBeVisible();
	await expect(page).toHaveURL(/q=lighthouse/);
	await page.reload();
	await expect(page.getByRole('heading', {name: 'Browser Feed Lighthouse'})).toBeVisible();
	await expect(page.getByRole('link', {name: 'Open original source for Browser Feed Lighthouse'})).toHaveAttribute('rel', 'noopener noreferrer');

	await page.getByRole('button', {name: 'Edit source Selected RSS feed'}).click();
	await page.getByLabel('Source name').fill('Selected RSS feed updated');
	await page.getByRole('button', {name: 'Save feed changes'}).click();
	await expect(page.getByRole('heading', {name: 'Selected RSS feed updated'})).toBeVisible();
	await page.getByRole('button', {name: 'Disable source Unselected Atom feed'}).click();
	await expect(page.getByText('Inactive', {exact: true})).toBeVisible();
	await page.getByRole('button', {name: 'Enable source Unselected Atom feed'}).click();

	await page.getByRole('button', {name: 'Synchronize Unselected Atom feed'}).click();
	await expect(page.getByText(/Unselected Atom feed synchronized/)).toBeAttached();
	const before = await (await page.request.get('http://127.0.0.1:43181/request-log')).json() as {paths: string[]};
	await page.goto(`${origin}/stations`);
	await page.getByLabel('Station name').fill('Feed-backed browser station');
	await page.getByLabel('Topic and editorial direction').fill('Explain only the selected supplied feed facts.');
	const selected = page.getByRole('checkbox', {name: 'Selected RSS feed updated'});
	await selected.focus();
	await page.keyboard.press('Space');
	await expect(selected).toBeChecked();
	await page.getByRole('button', {name: 'Save station', exact: true}).click();
	const storedSources = await (await page.request.get(`${origin}/api/sources`)).json() as Array<{id: string; name: string}>;
	const selectedSourceId = storedSources.find(source => source.name === 'Selected RSS feed updated')!.id;
	await page.request.patch(`${origin}/api/sources/${encodeURIComponent(selectedSourceId)}`, {data: {isActive: false}});
	await page.reload();
	let stationRow = page.getByRole('article').filter({has: page.getByRole('heading', {name: 'Feed-backed browser station'})});
	await stationRow.getByRole('button', {name: 'Edit station Feed-backed browser station'}).click();
	const inactiveSelection = page.getByRole('checkbox', {name: 'Selected RSS feed updated (inactive)'});
	await expect(inactiveSelection).toBeEnabled();
	await inactiveSelection.focus();
	await page.keyboard.press('Space');
	await expect(inactiveSelection).not.toBeChecked();
	await page.getByRole('button', {name: 'Cancel'}).click();
	await page.request.patch(`${origin}/api/sources/${encodeURIComponent(selectedSourceId)}`, {data: {isActive: true}});
	await page.reload();
	stationRow = page.getByRole('article').filter({has: page.getByRole('heading', {name: 'Feed-backed browser station'})});
	await stationRow.getByRole('button', {name: 'Sync and generate'}).click();
	await expect(page.getByText('AI-generated LocalCast audio')).toBeVisible({timeout: 30_000});
	await expect(page.getByText('Browser Feed Lighthouse').last()).toBeVisible();

	const after = await (await page.request.get('http://127.0.0.1:43181/request-log')).json() as {paths: string[]};
	const newPaths = after.paths.slice(before.paths.length);
	expect(newPaths).toEqual(['/feed.xml']);
	expect(after.paths).not.toContain('/article');
});
