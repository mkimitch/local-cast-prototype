import {expect, test} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('failed citation output is not displayed as completed or blamed on supplied inputs', async ({page}) => {
	const errors: string[] = [];
	page.on('pageerror', error => errors.push(error.message));
	const mutations: string[] = [];
	page.on('request', request => { if (request.method() !== 'GET') mutations.push(request.method()); });
	await page.route('**/api/briefing-runs/run-citation-failure', route => route.fulfill({json: {
		id: 'run-citation-failure', title: 'Synthetic citation failure', status: 'failed', mode: 'brief',
		createdAt: '2026-10-09T18:20:04.724Z', completedAt: '2026-10-09T18:20:20.184Z', sections: [], warnings: [],
		job: {id: 'job-synthetic', attemptCount: 1, retryable: false, evidenceFrozen: true, failedPhase: 'validating',
			errorCode: 'INVALID_CITATIONS', errorMessage: 'The generated transcript repeated a source citation within one factual segment',
			attempts: [{attemptNumber: 1, outcome: 'failed', errorCode: 'INVALID_CITATIONS'}]},
	}}));
	await page.goto('/episodes/run-citation-failure');
	await expect(page.getByRole('heading', {name: 'Generation failed'})).toBeVisible();
	await expect(page.locator('.detail-meta')).toContainText('Failed');
	await expect(page.getByText('Completed', {exact: true})).toHaveCount(0);
	await expect(page.getByText('this does not establish that the supplied material is invalid.', {exact: false})).toBeVisible();
	await expect(page.getByText('new or changed input required', {exact: false})).toHaveCount(0);
	await expect(page.getByRole('button', {name: /Retry/})).toHaveCount(0);
	const link = page.getByRole('link', {name: 'Review station and generation options.'});
	await link.focus();
	await expect(link).toBeFocused();
	expect((await new AxeBuilder({page}).include('main').analyze()).violations).toEqual([]);
	await page.screenshot({path: '/tmp/localcast-citation-failure-desktop.png', fullPage: true});
	await page.setViewportSize({width: 320, height: 800});
	await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
	const failure = page.getByRole('region', {name: 'Generation failed'});
	await failure.scrollIntoViewIfNeeded();
	expect(await failure.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
	await failure.getByRole('heading').scrollIntoViewIfNeeded();
	await page.screenshot({path: '/tmp/localcast-citation-failure-mobile-heading.png'});
	await link.scrollIntoViewIfNeeded();
	await page.screenshot({path: '/tmp/localcast-citation-failure-mobile.png'});
	await link.press('Enter');
	await expect(page).toHaveURL(/\/stations$/);
	expect(errors).toEqual([]);
	expect(mutations).toEqual([]);
});

test('a completed short Compact briefing exposes its nonfatal editorial warning accessibly', async ({page}) => {
	await page.route('**/api/briefing-runs/run-compact-warning', route => route.fulfill({json: {
		id: 'run-compact-warning', title: 'Synthetic Compact briefing', status: 'complete', mode: 'brief',
		createdAt: '2026-10-14T12:00:00.000Z', completedAt: '2026-10-14T12:01:00.000Z', sections: [],
		warnings: [{
			kind: 'editorial_length', code: 'COMPACT_EDITORIAL_LENGTH_BELOW_PREFERRED',
			message: 'This Compact briefing is 199 published words, below the preferred 200–350-word editorial range.',
			actualWords: 199, preferredMinimumWords: 200, preferredMaximumWords: 350,
		}],
	}}));
	await page.goto('/episodes/run-compact-warning');
	const warnings = page.getByRole('region', {name: 'Episode warnings'});
	await expect(warnings).toContainText('199 published words');
	await expect(warnings).toContainText('COMPACT_EDITORIAL_LENGTH_BELOW_PREFERRED');
	await expect(page.locator('.detail-meta')).toContainText('Completed');
	expect((await new AxeBuilder({page}).include('main').analyze()).violations).toEqual([]);
});
