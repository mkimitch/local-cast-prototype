import AxeBuilder from '@axe-core/playwright';
import {expect, test} from '@playwright/test';

test.use({trace: 'off', screenshot: 'off', video: 'off'});

test('private podcast setup is keyboard-copyable without rendering or persisting the credential', async ({context, page}) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write'], {origin: 'http://127.0.0.1:43179'});
	await page.goto('/settings');
	await expect(page.getByRole('heading', {name: 'Private podcast delivery'})).toBeVisible();
	await expect(page.getByText('Private feed configured')).toBeVisible();
	await expect(page.getByText('Canonical LAN origin: http://127.0.0.1:43179')).toBeVisible();
	await expect(page.getByLabel('Private subscription URL is masked')).toBeVisible();
	await expect(page.locator('body')).not.toContainText('/podcast/');

	const copy = page.getByRole('button', {name: 'Copy private RSS URL'});
	await copy.focus();
	await expect(copy).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(page.getByRole('status').filter({hasText: 'Private RSS URL copied'})).toBeVisible();
	await expect(copy).toBeFocused();

	const privacy = await page.evaluate(async () => {
		const value = await navigator.clipboard.readText();
		try {
			let validShape = false;
			try {
				const url = new URL(value);
				const segments = url.pathname.split('/').filter(Boolean);
				validShape = url.origin === location.origin
					&& segments.length === 3
					&& segments[0] === 'podcast'
					&& /^[A-Za-z0-9_-]{43}$/.test(segments[1] || '')
					&& segments[2] === 'feed.xml';
			} catch {
				validShape = false;
			}
			const persistentValues = [
				document.documentElement.outerHTML,
				location.href,
				...Object.entries(localStorage).flat(),
				...Object.entries(sessionStorage).flat(),
			];
			const persisted = persistentValues.some(entry => typeof entry === 'string' && entry.includes(value));
			const cacheNames = 'caches' in globalThis ? await caches.keys() : [];
			const databases = indexedDB.databases ? await indexedDB.databases() : [];
			return {validShape, persisted, cacheCount: cacheNames.length, databaseCount: databases.length};
		} finally {
			await navigator.clipboard.writeText('');
		}
	});
	expect(privacy).toEqual({validShape: true, persisted: false, cacheCount: 0, databaseCount: 0});

	await page.setViewportSize({width: 320, height: 900});
	await page.locator('html').evaluate(element => { element.style.fontSize = '200%'; });
	await expect(copy).toBeVisible();
	const bounds = await copy.boundingBox();
	expect(Boolean(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 320)).toBe(true);
	const buttonReflow = await copy.evaluate(element => ({clientWidth: element.clientWidth, scrollWidth: element.scrollWidth}));
	expect({...buttonReflow, fits: buttonReflow.scrollWidth <= buttonReflow.clientWidth}).toEqual({
		...buttonReflow,
		fits: true,
	});
	expect(await page.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
	const accessibility = await new AxeBuilder({page}).analyze();
	expect(accessibility.violations).toEqual([]);

	await page.locator('html').evaluate(element => {
		element.classList.add('dark');
		delete element.dataset.contrast;
	});
	expect((await new AxeBuilder({page}).include('.podcast-setup').analyze()).violations).toEqual([]);
	await page.locator('html').evaluate(element => { element.dataset.contrast = 'high'; });
	expect((await new AxeBuilder({page}).include('.podcast-setup').analyze()).violations).toEqual([]);
});
