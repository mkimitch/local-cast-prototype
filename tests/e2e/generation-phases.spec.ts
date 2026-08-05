import {expect, test} from '@playwright/test';

const origin = 'http://127.0.0.1:43180';

test('explicit browser action observes durable ordered phases across reload', async ({page}) => {
	test.setTimeout(45_000);
	await page.goto(origin);
	await page.getByRole('button', {name: 'Sources', exact: true}).click();
	await page.getByRole('button', {name: 'Add RSS Feed'}).click();
	await page.getByLabel('Source Name').fill('Browser fixture');
	await page.getByLabel('RSS URL').fill('http://127.0.0.1:43181/feed.xml');
	await page.getByRole('button', {name: 'Save RSS Feed'}).click();
	await page.waitForTimeout(500);
	expect(await (await page.request.get('http://127.0.0.1:43181/request-count')).json()).toEqual({count: 0});
	expect(await (await page.request.get(`${origin}/api/briefing-runs`)).json()).toEqual([]);
	await page.getByRole('button', {name: 'Sync RSS feed'}).click();
	await expect(page.getByText('1 items')).toBeVisible();
	expect(await (await page.request.get('http://127.0.0.1:43181/request-count')).json()).toEqual({count: 1});

	const beforeAction = await page.request.get(`${origin}/api/briefing-runs`);
	expect(await beforeAction.json()).toEqual([]);

	await page.getByRole('button', {name: 'Dashboard'}).click();
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
			if (label === 'Selecting Evidence' && !reloaded) {
				reloaded = true;
				await page.reload();
				await page.getByRole('button', {name: 'View', exact: true}).click();
			}
		}
		if (await page.getByText('Persisted audio').isVisible().catch(() => false)) break;
		await page.waitForTimeout(150);
	}

	expect(reloaded).toBe(true);
	expect(observed).toEqual([
		'Queued',
		'Synchronizing Sources',
		'Selecting Evidence',
		'Drafting Transcript',
		'Validating Citations',
		'Synthesizing Audio',
	]);
	await expect(page.getByText('Persisted audio')).toBeVisible();

	const runs = await (await page.request.get(`${origin}/api/briefing-runs`)).json();
	expect(runs).toHaveLength(1);
	const eventsDatabaseEvidence = runs[0].job;
	expect(eventsDatabaseEvidence.phase).toBe('complete');
	expect(eventsDatabaseEvidence.attemptCount).toBe(1);
});
