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

	await page.getByRole('link', {name: 'Settings'}).click();
	await expect(page.getByRole('heading', {name: 'Provider Status'})).toBeVisible();
	await expect(page.getByText('NOT CONFIGURED', {exact: true})).toHaveCount(2);
	await expect(page.locator('input[type="password"]')).toHaveCount(0);
	await expect(page.getByText(/provider credentials remain server-side/i)).toBeVisible();
	await expect(page.getByText(/complete frozen transcript, and all frozen supporting evidence snapshots/i)).toBeVisible();
	await expect(page.getByText(/supported answer can use two external requests/i)).toBeVisible();
	await expect(page.getByText(/provider-side response storage is disabled through store: false/i)).toBeVisible();
	await expect(page.getByText(/LocalCast still keeps the ordered chat history in SQLite/i)).toBeVisible();
	await expect(page.getByText(/pinned to.*gpt-5\.4-mini-2026-03-17/i)).toBeVisible();

	const browserCredential = 'sk-localcast-browser-credential-1234';
	const replaceCredential = page.getByRole('button', {name: 'Replace API key'});
	await replaceCredential.focus();
	await page.keyboard.press('Enter');
	let credentialDialog = page.getByRole('dialog', {name: 'Replace OpenAI API key'});
	await expect(credentialDialog.getByLabel('Complete new API key')).toBeFocused();
	await expect(credentialDialog.getByLabel('Complete new API key')).toHaveAttribute('autocomplete', 'new-password');
	await credentialDialog.getByLabel('Complete new API key').fill(browserCredential);
	await page.keyboard.press('Escape');
	await expect(credentialDialog).toHaveCount(0);
	await expect(replaceCredential).toBeFocused();
	await page.keyboard.press('Enter');
	credentialDialog = page.getByRole('dialog', {name: 'Replace OpenAI API key'});
	const credentialInput = credentialDialog.getByLabel('Complete new API key');
	await expect(credentialInput).toHaveValue('');
	await page.keyboard.press('Tab');
	await expect(credentialDialog.getByRole('button', {name: 'Cancel'})).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(credentialDialog.getByRole('button', {name: 'Replace API key'})).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(credentialInput).toBeFocused();

	let releaseRejectedReplacement!: () => void;
	const rejectedReplacement = new Promise<void>(resolve => { releaseRejectedReplacement = resolve; });
	await page.route('**/api/settings/provider-credentials/openai', async route => {
		await rejectedReplacement;
		await route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({error: 'Synthetic credential rejection.'})});
	});
	await credentialInput.fill(browserCredential);
	await credentialDialog.getByRole('button', {name: 'Replace API key'}).click();
	await expect(credentialInput).toHaveValue('');
	await expect(credentialInput).toHaveAttribute('readonly', '');
	await credentialInput.focus();
	await page.keyboard.press('Tab');
	await expect(credentialInput).toBeFocused();
	releaseRejectedReplacement();
	await expect(credentialDialog.getByRole('alert')).toHaveText('Synthetic credential rejection.');
	await expect(credentialInput).toBeFocused();
	await expect(credentialInput).not.toHaveAttribute('readonly', '');
	await page.unroute('**/api/settings/provider-credentials/openai');
	await credentialDialog.getByLabel('Complete new API key').fill(browserCredential);
	await credentialDialog.getByRole('button', {name: 'Replace API key'}).click();
	await expect(credentialDialog).toHaveCount(0);
	await expect(replaceCredential).toBeFocused();
	await expect(page.getByText(/OpenAI API key replaced/i)).toBeVisible();
	await expect(page.getByText(/••••1234/)).toBeVisible();
	await expect(page.locator('input[type="password"]')).toHaveCount(0);
	await expect(page.getByText(browserCredential)).toHaveCount(0);
	const browserState = await page.evaluate(async () => ({
		local: JSON.stringify(localStorage),
		session: JSON.stringify(sessionStorage),
		settings: JSON.stringify(await fetch('/api/settings').then(response => response.json())),
		documentText: document.body.textContent,
	}));
	expect(JSON.stringify(browserState)).not.toContain(browserCredential);

	await page.route('**/api/settings/provider-credentials/openai/test', route => route.fulfill({
		status: 200,
		contentType: 'application/json',
		body: JSON.stringify({verified: true, verifiedAt: '2026-09-23T12:00:00.000Z', capabilities: ['text', 'speech']}),
	}));
	await page.getByRole('button', {name: 'Test connection'}).click();
	await expect(page.getByRole('region', {name: 'OpenAI API key'}).getByRole('status')).toContainText('OpenAI connection verified for text and speech.');
	await page.unroute('**/api/settings/provider-credentials/openai/test');
	await page.route('**/api/settings/provider-credentials/openai/test', route => route.fulfill({
		status: 429,
		contentType: 'application/json',
		body: JSON.stringify({code: 'OPENAI_RATE_LIMIT_OR_QUOTA', error: 'OpenAI reported a rate-limit, quota, or account-capacity problem.'}),
	}));
	await page.getByRole('button', {name: 'Test connection'}).click();
	await expect(page.getByRole('alert')).toContainText('rate-limit, quota, or account-capacity problem');
	await page.unroute('**/api/settings/provider-credentials/openai/test');

	await page.getByRole('link', {name: 'Sources'}).click();
	await page.getByRole('button', {name: 'Add RSS or Atom feed'}).click();
	await page.getByLabel('Source name').fill('Release direction');
	await page.getByLabel('Credential-free HTTP(S) feed URL').fill('https://example.test/feed.xml');
	await page.getByRole('button', {name: 'Save feed', exact: true}).click();
	await expect(page.getByRole('heading', {name: 'Release direction'})).toBeVisible();

	await page.getByRole('link', {name: 'Stations & Notes'}).click();
	await expect(page.getByRole('note', {name: 'External provider disclosure'})).toContainText('OpenAI receives the station direction');
	await expect(page.getByText(/all resulting audio is AI-generated/i)).toBeVisible();
	await page.getByLabel('Title').fill('Supplied local note');
	await page.getByLabel('Pasted factual material').fill('A multiline supplied note.\nThis remains on the server unless explicit generation sends it through the disclosed provider flow.');
	await page.getByRole('button', {name: 'Save note', exact: true}).click();
	await expect(page.getByRole('heading', {name: 'Supplied local note'})).toBeVisible();
	await page.getByRole('button', {name: 'Edit note Supplied local note'}).click();
	await page.getByLabel('Title').fill('Updated supplied local note');
	await page.getByRole('button', {name: 'Save note changes'}).click();
	await expect(page.getByRole('heading', {name: 'Updated supplied local note'})).toBeVisible();

	await page.getByLabel('Station name').fill('Saved local station');
	await page.getByLabel('Topic and editorial direction').fill('Explain only the selected supplied note.');
	const noteSelection = page.getByRole('checkbox', {name: 'Updated supplied local note'});
	await noteSelection.focus();
	await page.keyboard.press('Space');
	await page.getByRole('button', {name: 'Save station', exact: true}).click();
	await expect(page.getByRole('heading', {name: 'Saved local station'})).toBeVisible();
	await page.reload();
	await expect(page.getByRole('heading', {name: 'Updated supplied local note'})).toBeVisible();
	await expect(page.getByRole('heading', {name: 'Saved local station'})).toBeVisible();
	await page.getByRole('button', {name: 'Edit station Saved local station'}).click();
	await page.getByLabel('Station name').fill('Updated local station');
	await page.getByRole('button', {name: 'Save station changes'}).click();
	await expect(page.getByRole('heading', {name: 'Updated local station'})).toBeVisible();
	const deleteStation = page.getByRole('button', {name: 'Delete station Updated local station'});
	await deleteStation.click();
	const stationConfirmation = page.getByRole('alertdialog', {name: 'Delete Updated local station?'});
	await expect(stationConfirmation.getByRole('button', {name: 'Cancel'})).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(deleteStation).toBeFocused();
	await deleteStation.click();
	await stationConfirmation.getByRole('button', {name: 'Delete station'}).click();
	await expect(page.getByRole('heading', {name: 'Updated local station'})).toHaveCount(0);
	const deleteNote = page.getByRole('button', {name: 'Delete note Updated supplied local note'});
	await deleteNote.click();
	await page.getByRole('alertdialog', {name: 'Delete Updated supplied local note?'}).getByRole('button', {name: 'Delete note'}).click();
	await expect(page.getByRole('heading', {name: 'Updated supplied local note'})).toHaveCount(0);

	await page.getByRole('link', {name: 'Episodes'}).click();
	await expect(page.getByText('No episodes yet')).toBeVisible();
	await expect(page.getByRole('link', {name: 'Choose a station'})).toBeVisible();

	expect(externalRequests).toEqual([]);
});
