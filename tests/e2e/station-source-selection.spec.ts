import {expect, test} from '@playwright/test';

test('station note and feed selections are visible, operable, and persistent', async ({page, request}) => {
	const createNote = async (title: string) => {
		const response = await request.post('/api/notes', {data: {title, body: `${title} contains supplied factual material for the station selection regression.`}});
		expect(response.ok()).toBe(true);
		return response.json() as Promise<{id: string}>;
	};
	const createSource = async (name: string, url: string, isActive = true) => {
		const response = await request.post('/api/sources', {data: {type: 'rss', name, url, isActive}});
		expect(response.ok()).toBe(true);
		return response.json() as Promise<{id: string}>;
	};

	await Promise.all([
		createNote('Selection note one'),
		createNote('Selection note two'),
		createSource('Selection feed one', 'https://selection-one.example.test/feed.xml'),
		createSource('Selection feed two', 'https://selection-two.example.test/feed.xml'),
		createSource('Inactive selection feed', 'https://selection-inactive.example.test/feed.xml', false),
	]);

	await page.goto('/stations');
	await page.getByLabel('Station name').fill('Selection persistence station');
	await page.getByLabel('Topic and editorial direction').fill('Use the selected notes and feeds together.');

	const firstNote = page.getByRole('checkbox', {name: 'Selection note one'});
	const secondNote = page.getByRole('checkbox', {name: 'Selection note two'});
	const firstFeed = page.getByRole('checkbox', {name: 'Selection feed one'});
	const secondFeed = page.getByRole('checkbox', {name: 'Selection feed two'});
	const unavailableFeed = page.getByRole('checkbox', {name: 'Inactive selection feed'});

	for (const control of [firstNote, secondNote, firstFeed, secondFeed, unavailableFeed]) {
		expect(await control.evaluate(element => (element as HTMLInputElement).labels?.length)).toBe(1);
	}
	const checkboxBox = await firstNote.boundingBox();
	expect(checkboxBox?.width).toBeGreaterThanOrEqual(16);
	expect(checkboxBox?.height).toBeGreaterThanOrEqual(16);

	await firstNote.click();
	await expect(firstNote).toBeChecked();
	const secondNoteId = await secondNote.getAttribute('id');
	await page.locator(`label[for="${secondNoteId}"]`).click();
	await expect(secondNote).toBeChecked();
	await firstFeed.focus();
	await page.keyboard.press('Space');
	await expect(firstFeed).toBeChecked();
	const secondFeedId = await secondFeed.getAttribute('id');
	await page.locator(`label[for="${secondFeedId}"]`).click();
	await expect(secondFeed).toBeChecked();
	await expect(firstNote.locator('xpath=..')).toHaveAttribute('data-selected', 'true');
	await expect(firstFeed.locator('xpath=..')).toHaveAttribute('data-selected', 'true');
	await expect(unavailableFeed).toBeDisabled();
	await expect(page.getByText('Unavailable because this feed is inactive.')).toBeVisible();

	await page.getByRole('button', {name: 'Save station', exact: true}).click();
	await expect(page.getByRole('heading', {name: 'Selection persistence station'})).toBeVisible();
	await page.reload();
	await page.getByRole('button', {name: 'Edit station Selection persistence station'}).click();
	await expect(page.getByRole('checkbox', {name: 'Selection note one'})).toBeChecked();
	await expect(page.getByRole('checkbox', {name: 'Selection note two'})).toBeChecked();
	await expect(page.getByRole('checkbox', {name: 'Selection feed one'})).toBeChecked();
	await expect(page.getByRole('checkbox', {name: 'Selection feed two'})).toBeChecked();

	await page.getByRole('checkbox', {name: 'Selection note one'}).click();
	await page.getByRole('button', {name: 'Save station changes'}).click();
	await page.reload();
	await page.getByRole('button', {name: 'Edit station Selection persistence station'}).click();
	await expect(page.getByRole('checkbox', {name: 'Selection note one'})).not.toBeChecked();
	await expect(page.getByRole('checkbox', {name: 'Selection note two'})).toBeChecked();
	await expect(page.getByRole('checkbox', {name: 'Selection feed one'})).toBeChecked();
	await expect(page.getByRole('checkbox', {name: 'Selection feed two'})).toBeChecked();

	const persistedFeed = page.getByRole('checkbox', {name: 'Selection feed one'});
	const persistedFeedId = await persistedFeed.getAttribute('id');
	await page.locator(`label[for="${persistedFeedId}"]`).click();
	await page.getByRole('button', {name: 'Save station changes'}).click();
	await page.reload();
	await page.getByRole('button', {name: 'Edit station Selection persistence station'}).click();
	await expect(page.getByRole('checkbox', {name: 'Selection note one'})).not.toBeChecked();
	await expect(page.getByRole('checkbox', {name: 'Selection note two'})).toBeChecked();
	await expect(page.getByRole('checkbox', {name: 'Selection feed one'})).not.toBeChecked();
	await expect(page.getByRole('checkbox', {name: 'Selection feed two'})).toBeChecked();
});
