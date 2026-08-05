import {expect, test} from '@playwright/test';

test('production UI is same-origin, honest, and manually driven', async ({page}) => {
	const externalRequests: string[] = [];
	page.on('request', request => {
		const url = new URL(request.url());
		if (url.origin !== 'http://127.0.0.1:43179') externalRequests.push(request.url());
	});

	await page.goto('/');
	await expect(page).toHaveTitle('LocalCast');
	await expect(page.getByRole('main')).toBeVisible();
	await expect(page.getByRole('heading', {name: 'Dashboard'})).toBeVisible();
	await expect(page.getByRole('button', {name: 'Sync and generate'})).toBeDisabled();
	await expect(page.getByText('Generation is unavailable until text and speech providers are configured on the server.')).toBeVisible();

	await page.getByRole('button', {name: 'Settings'}).click();
	await expect(page.getByRole('heading', {name: 'Provider Status'})).toBeVisible();
	await expect(page.getByText('NOT CONFIGURED', {exact: true})).toHaveCount(2);
	await expect(page.locator('input[type="password"]')).toHaveCount(0);
	await expect(page.getByText(/credentials and endpoints are configured only on the LocalCast server/i)).toBeVisible();

	await page.getByRole('button', {name: 'Sources'}).click();
	await page.getByRole('button', {name: 'Add RSS Feed'}).click();
	await page.getByLabel('Source Name').fill('Release direction');
	await page.getByLabel('RSS URL').fill('https://example.test/feed.xml');
	await page.getByRole('button', {name: 'Save RSS Feed'}).click();
	await expect(page.getByRole('heading', {name: 'Release direction'})).toBeVisible();

	await page.getByRole('button', {name: 'Briefing Runs'}).click();
	await expect(page.getByText('No runs yet')).toBeVisible();
	await expect(page.getByRole('button', {name: 'Sync and generate'}).first()).toBeDisabled();
	await expect(page.getByText(/unavailable until text and speech providers are configured/i)).toBeVisible();

	expect(externalRequests).toEqual([]);
});
