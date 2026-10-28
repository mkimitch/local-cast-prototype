import AxeBuilder from '@axe-core/playwright';
import {expect, test, type Page} from '@playwright/test';

const routes = [
	{path: '/', heading: 'Dashboard'},
	{path: '/sources', heading: 'Sources'},
	{path: '/stations', heading: 'Stations & Notes'},
	{path: '/episodes', heading: 'Episodes'},
	{path: '/settings', heading: 'Settings'},
] as const;

const assertNoPageOverflow = async (page: Page) => {
	await expect.poll(() => page.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
	const overflowingControls = await page.locator('main button:visible, main input:visible, main select:visible, main textarea:visible, main a:visible').evaluateAll(elements => elements.flatMap(element => {
		const bounds = element.getBoundingClientRect();
		return bounds.left >= 0 && bounds.right <= window.innerWidth ? [] : [(element.getAttribute('aria-label') || element.textContent || element.tagName).trim()];
	}));
	expect(overflowingControls).toEqual([]);
};

test.describe('Slice 6C accessibility coverage', () => {
	test('all core routes are named, axe-clean, keyboard-navigable, and reflow at 320 CSS pixels with 200% text', async ({page}) => {
		const thirdPartyOrigins = new Set<string>();
		let applicationOrigin: string | undefined;
		page.on('request', request => {
			const requested = new URL(request.url());
			if (request.isNavigationRequest() && request.frame() === page.mainFrame() && !applicationOrigin) applicationOrigin = requested.origin;
			if ((requested.protocol === 'http:' || requested.protocol === 'https:') && applicationOrigin && requested.origin !== applicationOrigin) {
				thirdPartyOrigins.add(requested.origin);
			}
		});
		for (const route of routes) {
			await page.goto(route.path);
			await expect(page.getByRole('heading', {name: route.heading, level: 1})).toBeVisible();
			for (const appearance of ['light', 'dark', 'high-contrast'] as const) {
				await page.locator('html').evaluate((element, selectedAppearance) => {
					element.classList.toggle('dark', selectedAppearance === 'dark');
					if (selectedAppearance === 'high-contrast') element.dataset.contrast = 'high';
					else delete element.dataset.contrast;
				}, appearance);
				// Audit the selected theme, not intermediate colors during its transition.
				await page.evaluate(async () => {
					await Promise.allSettled(document.getAnimations()
						.filter(animation => animation instanceof CSSTransition)
						.map(animation => animation.finished));
				});
				expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
			}
		}

		await page.setViewportSize({width: 320, height: 900});
		for (const route of routes) {
			await page.goto(route.path);
			await page.locator('html').evaluate(element => { element.style.fontSize = '200%'; });
			await expect(page.getByRole('heading', {name: route.heading, level: 1})).toBeVisible();
			await assertNoPageOverflow(page);
		}

		await page.setViewportSize({width: 1280, height: 900});
		await page.goto('/');
		await page.keyboard.press('Tab');
		const skipLink = page.getByRole('link', {name: 'Skip to main content'});
		await expect(skipLink).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(page.getByRole('main')).toBeFocused();

		for (const route of routes.slice(1)) {
			const navigation = page.getByRole('link', {name: route.heading === 'Stations & Notes' ? 'Stations & Notes' : route.heading});
			await navigation.focus();
			await page.keyboard.press('Enter');
			await expect(page.getByRole('heading', {name: route.heading, level: 1})).toBeFocused();
		}
		expect([...thirdPartyOrigins]).toEqual([]);
	});

	test('source destructive confirmation traps focus, restores it on cancel, and announces completed deletion once', async ({page}) => {
		await page.goto('/sources');
		await page.getByRole('button', {name: 'Add RSS or Atom feed'}).click();
		await page.getByLabel('Source name').fill('Accessible source fixture');
		await page.getByLabel('Credential-free HTTP(S) feed URL').fill('https://example.test/accessibility.xml');
		await page.getByRole('button', {name: 'Save feed', exact: true}).click();
		const deleteSource = page.getByRole('button', {name: 'Delete source Accessible source fixture'});
		await deleteSource.focus();
		await page.keyboard.press('Enter');
		const dialog = page.getByRole('alertdialog', {name: 'Delete Accessible source fixture?'});
		await expect(dialog.getByRole('button', {name: 'Cancel'})).toBeFocused();
		await page.keyboard.press('Tab');
		await expect(dialog.getByRole('button', {name: 'Delete source'})).toBeFocused();
		await page.keyboard.press('Tab');
		await expect(dialog.getByRole('button', {name: 'Cancel'})).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(deleteSource).toBeFocused();
		await page.keyboard.press('Enter');
		await dialog.getByRole('button', {name: 'Delete source'}).click();
		await expect(page.getByText('Accessible source fixture deleted. Completed episode evidence remains unchanged.')).toBeAttached();
		await expect(page.getByRole('button', {name: 'Add RSS or Atom feed'})).toBeFocused();
	});

	test.describe('reduced motion', () => {
		test('preserves route focus and leaves no looping animated affordance', async ({page}) => {
			await page.emulateMedia({reducedMotion: 'reduce'});
			await page.goto('/sources');
			await expect(page.getByRole('heading', {name: 'Sources', level: 1})).toBeVisible();
			await page.getByRole('link', {name: 'Settings'}).focus();
			await page.keyboard.press('Enter');
			await expect(page.getByRole('heading', {name: 'Settings', level: 1})).toBeFocused();
			const animated = await page.locator('.is-spinning, .is-pulsing, .fade-slide-in').evaluateAll(elements => elements.every(element => {
				const style = window.getComputedStyle(element);
				return style.animationIterationCount !== 'infinite' && style.animationDuration !== '0s';
			}));
			expect(animated).toBe(true);
		});
	});

	test('settings discloses trusted-client and plaintext-backup privacy boundaries', async ({page}) => {
		await page.goto('/settings');
		await expect(page.getByText(/any client admitted to the application origin is treated as an authorized operator/i)).toBeVisible();
		await expect(page.getByText(/versioned backups contain that user content and media in plaintext/i)).toBeVisible();
		await expect(page.getByText(/backups exclude provider credentials, configured endpoints, environment files, and the podcast bearer token/i)).toBeVisible();

		await page.getByRole('button', {name: 'Replace API key'}).click();
		const dialog = page.getByRole('dialog', {name: 'Replace OpenAI API key'});
		expect((await new AxeBuilder({page}).include('.confirm-dialog').analyze()).violations).toEqual([]);
		await page.setViewportSize({width: 320, height: 450});
		await page.locator('html').evaluate(element => { element.style.fontSize = '200%'; });
		const bounds = await dialog.boundingBox();
		expect(bounds).not.toBeNull();
		expect(bounds!.x).toBeGreaterThanOrEqual(0);
		expect(bounds!.y).toBeGreaterThanOrEqual(0);
		expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
		expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(450);
		await expect(dialog).toHaveCSS('overflow-y', 'auto');
	});
});
