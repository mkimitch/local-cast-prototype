import AxeBuilder from '@axe-core/playwright';
import {expect, test, type APIRequestContext} from '@playwright/test';

const origin = 'http://127.0.0.1:43185';
const controlOrigin = 'http://127.0.0.1:43186';

test.use({trace: 'off'});

const createCompletedSyntheticEpisode = async (request: APIRequestContext, suffix = 'primary'): Promise<string> => {
	const noteResponse = await request.post(`${origin}/api/notes`, {data: {
		title: 'Synthetic grounded chat note',
		body: Array.from({length: 850}, (_value, index) => `syntheticChatFact${String(index + 1).padStart(4, '0')}`).join(' '),
		author: 'Synthetic Test Author',
		originalUrl: 'https://example.test/synthetic-chat',
	}});
	expect(noteResponse.status()).toBe(201);
	const note = await noteResponse.json() as {id: string};
	const stationResponse = await request.post(`${origin}/api/stations`, {data: {
		name: 'Synthetic grounded chat station',
		topicInstruction: 'Explain only the supplied synthetic material without outside research.',
		defaultMode: 'brief',
		noteIds: [note.id],
		sourceIds: [],
	}});
	expect(stationResponse.status()).toBe(201);
	const station = await stationResponse.json() as {id: string};
	const runResponse = await request.post(`${origin}/api/briefing-runs`, {
		headers: {'Idempotency-Key': `synthetic-browser-chat-generation-${suffix}`},
		data: {stationId: station.id, mode: 'brief'},
	});
	expect(runResponse.status()).toBe(201);
	const run = await runResponse.json() as {id: string};
	await expect.poll(async () => {
		const response = await request.get(`${origin}/api/briefing-runs/${encodeURIComponent(run.id)}`);
		return (await response.json() as {status: string}).status;
	}, {timeout: 35_000}).toBe('complete');
	return run.id;
};

test('episode-grounded chat is disclosed, cited, persistent, retryable, and accessible', async ({browser, page, request}) => {
	test.setTimeout(120_000);
	const runId = await createCompletedSyntheticEpisode(request);
	const chatApiPath = `/api/briefing-runs/${encodeURIComponent(runId)}/chat-turns`;
	let releaseInitialHistory!: () => void;
	const initialHistoryGate = new Promise<void>(resolve => { releaseInitialHistory = resolve; });
	let holdInitialHistory = true;
	let acceptedResponsesToReplace = 2;
	let markFirstSubmissionAccepted!: () => void;
	const firstSubmissionAccepted = new Promise<void>(resolve => { markFirstSubmissionAccepted = resolve; });
	let firstAcceptedTurnId = '';
	let releaseFirstSubmissionResponse!: () => void;
	const firstSubmissionResponseGate = new Promise<void>(resolve => { releaseFirstSubmissionResponse = resolve; });
	let markSecondSubmissionAccepted!: () => void;
	const secondSubmissionAccepted = new Promise<void>(resolve => { markSecondSubmissionAccepted = resolve; });
	let secondAcceptedTurnId = '';
	let releaseSecondSubmissionResponse!: () => void;
	const secondSubmissionResponseGate = new Promise<void>(resolve => { releaseSecondSubmissionResponse = resolve; });
	let rejectNextSubmission = false;
	const submissionKeys: string[] = [];
	const replacedSubmissionKeys = new Set<string>();
	let replaceFirstRetryResponse = true;
	let markRetryAccepted!: () => void;
	const retryAccepted = new Promise<void>(resolve => { markRetryAccepted = resolve; });
	let releaseRetryResponse!: () => void;
	const retryResponseGate = new Promise<void>(resolve => { releaseRetryResponse = resolve; });
	const retryKeys: string[] = [];
	let firstRetryPath = '';
	let competingRetry = false;
	let competingRetryObserved = false;
	let frozenHistory: unknown[] | undefined;
	let freezeHistory = false;
	await page.route(`**${chatApiPath}`, async route => {
		if (freezeHistory && frozenHistory && route.request().method() === 'GET') {
			await route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(frozenHistory)});
			return;
		}
		if (holdInitialHistory && route.request().method() === 'GET') {
			holdInitialHistory = false;
			await initialHistoryGate;
		}
		if (route.request().method() === 'POST') {
			const idempotencyKey = route.request().headers()['idempotency-key'] || '';
			submissionKeys.push(idempotencyKey);
			if (rejectNextSubmission) {
				rejectNextSubmission = false;
				await route.fulfill({status: 400, contentType: 'application/json', body: JSON.stringify({error: 'Synthetic submission rejected'})});
				return;
			}
			if (acceptedResponsesToReplace > 0 && !replacedSubmissionKeys.has(idempotencyKey)) {
				const isFirstAcceptedSubmission = acceptedResponsesToReplace === 2;
				acceptedResponsesToReplace -= 1;
				replacedSubmissionKeys.add(idempotencyKey);
				const accepted = await route.fetch();
				expect(accepted.status()).toBe(202);
				const acceptedTurn = await accepted.json() as {id: string};
				if (isFirstAcceptedSubmission) {
					firstAcceptedTurnId = acceptedTurn.id;
					markFirstSubmissionAccepted();
					await firstSubmissionResponseGate;
				} else {
					secondAcceptedTurnId = acceptedTurn.id;
					markSecondSubmissionAccepted();
					await secondSubmissionResponseGate;
				}
				await route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({error: 'Synthetic response unavailable'})});
				return;
			}
		}
		await route.continue();
	});
	await page.route(`**${chatApiPath}/*/retry`, async route => {
		const retryKey = route.request().headers()['idempotency-key'] || '';
		retryKeys.push(retryKey);
		if (competingRetry) {
			competingRetry = false;
			competingRetryObserved = true;
			freezeHistory = false;
			await route.fulfill({
				status: 409,
				contentType: 'application/json',
				body: JSON.stringify({error: 'This chat failure cannot be retried'}),
			});
			return;
		}
		if (replaceFirstRetryResponse) {
			replaceFirstRetryResponse = false;
			firstRetryPath = new URL(route.request().url()).pathname;
			const accepted = await route.fetch();
			expect(accepted.status()).toBe(200);
			markRetryAccepted();
			await retryResponseGate;
			await route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({error: 'Synthetic retry response unavailable'})});
			return;
		}
		await route.continue();
	});
	const browserRequests: string[] = [];
	page.on('request', browserRequest => browserRequests.push(browserRequest.url()));
	await page.goto(`${origin}/episodes/${encodeURIComponent(runId)}`);

	const chat = page.locator('.episode-chat');
	const disclosure = chat.getByRole('note', {name: 'External provider disclosure'});
	const question = chat.getByRole('textbox', {name: 'Question'});
	const submit = chat.locator('button[type="submit"]');
	const liveStatus = chat.locator('[role="status"][aria-live="polite"]');
	await expect(disclosure).toContainText(/receives your question, this episode['’]s complete frozen transcript, and all frozen supporting evidence snapshots/);
	await expect(disclosure).toContainText(/supported answer can require a second external semantic-support request/);
	await expect(disclosure).toContainText(/evidence-insufficient refusal ordinarily requires one request/);
	await expect(disclosure).toContainText('Provider-side response storage is disabled');
	await expect(disclosure).toContainText('A locally hosted provider processes the same context locally');
	await expect(disclosure).toContainText('LocalCast enables no tools, search, browsing, URL retrieval, file search, or general-knowledge fallback');
	expect(await chat.evaluate(section => {
		const note = section.querySelector('[aria-label="External provider disclosure"]');
		const textarea = section.querySelector('textarea');
		const button = section.querySelector('button[type="submit"]');
		return Boolean(
			note && textarea && button
			&& note.compareDocumentPosition(textarea) & Node.DOCUMENT_POSITION_FOLLOWING
			&& note.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING
		);
	})).toBe(true);
	await expect(question).toBeDisabled();
	await expect(submit).toBeDisabled();
	await expect(submit).toHaveText('Loading question history…');
	expect((await new AxeBuilder({page}).include('.episode-chat').analyze()).violations).toEqual([]);
	releaseInitialHistory();
	await expect(submit).toHaveText('Ask this episode');
	await expect(question).toBeEnabled();
	expect(await (await request.get(`${origin}/api/briefing-runs/${encodeURIComponent(runId)}/chat-turns`)).json()).toEqual([]);

	const suggestion = chat.getByRole('button', {name: 'What are the key points in this episode?'});
	await suggestion.focus();
	await page.keyboard.press('Enter');
	await expect(question).toBeFocused();
	await expect(question).toHaveValue('What are the key points in this episode?');
	await submit.focus();
	await page.keyboard.press('Enter');
	await firstSubmissionAccepted;
	try {
		await expect(suggestion).toBeDisabled();
		await expect(question).toBeDisabled();
		await expect(submit).toBeDisabled();
		await expect.poll(async () => {
			const response = await request.get(`${origin}${chatApiPath}`);
			const history = await response.json() as Array<{id: string; state: string}>;
			return history.find(turn => turn.id === firstAcceptedTurnId)?.state;
		}, {timeout: 15_000}).toBe('answered');
		await expect(chat.getByRole('article').filter({hasText: 'What are the key points in this episode?'})).toContainText('Grounded answer');
		await expect(chat.getByRole('alert')).toHaveCount(0);
	} finally {
		releaseFirstSubmissionResponse();
	}
	const firstHeading = chat.getByRole('heading', {name: 'Question 1'});
	await expect(firstHeading).toBeVisible();
	await expect(chat.getByRole('article', {name: 'Question 1'})).toContainText('Grounded answer');
	await expect(liveStatus).toHaveCount(1);
	expect((await new AxeBuilder({page}).include('.episode-chat').analyze()).violations).toEqual([]);
	await expect(chat.getByRole('list', {name: 'Validated citations for answer to question 1'})).toBeVisible({timeout: 15_000});
	await expect(chat.getByRole('alert')).toHaveCount(0);
	await expect(firstHeading).toBeFocused();
	await expect(question).toHaveValue('');
	expect(submissionKeys).toHaveLength(1);
	expect(submissionKeys[0]).toBeTruthy();
	await expect(chat.locator('strong').filter({hasText: 'Synthetic grounded chat note'})).toBeVisible();
	const provenanceLink = chat.getByRole('link', {name: 'Open provenance for Synthetic grounded chat note'}).first();
	await expect(provenanceLink).toHaveAttribute('rel', 'noopener noreferrer');
	let turns = await (await request.get(`${origin}/api/briefing-runs/${encodeURIComponent(runId)}/chat-turns`)).json() as Array<{state: string; attemptCount: number; claims?: unknown[]}>;
	expect(turns).toMatchObject([{state: 'answered', attemptCount: 1, claims: [expect.any(Object)]}]);
	const firstTurnBeforeAppRestart = structuredClone(turns);
	await page.reload();
	await expect(chat.getByRole('list', {name: 'Validated citations for answer to question 1'})).toBeVisible();

	expect((await request.post(`${controlOrigin}/restart-app`)).status()).toBe(204);
	await expect.poll(async () => {
		try { return (await request.get(`${origin}/api/health`)).status(); } catch { return 0; }
	}).toBe(200);
	const firstTurnAfterAppRestart = await (await request.get(`${origin}/api/briefing-runs/${encodeURIComponent(runId)}/chat-turns`)).json();
	expect(firstTurnAfterAppRestart).toEqual(firstTurnBeforeAppRestart);
	await page.reload();
	await expect(chat.getByRole('heading', {name: 'Question 1'})).toBeVisible();
	await expect(chat.getByRole('list', {name: 'Validated citations for answer to question 1'})).toBeVisible();

	await question.fill('What happened outside this episode?');
	await submit.focus();
	await page.keyboard.press('Enter');
	await secondSubmissionAccepted;
	try {
		await expect.poll(async () => {
			const response = await request.get(`${origin}${chatApiPath}`);
			const history = await response.json() as Array<{id: string; state: string}>;
			return history.find(turn => turn.id === secondAcceptedTurnId)?.state;
		}, {timeout: 15_000}).toBe('refused');
		await expect(chat.getByRole('article').filter({hasText: 'What happened outside this episode?'})).toContainText(/do not support a reliable answer/i);
		await expect(chat.getByRole('alert')).toHaveCount(0);
	} finally {
		releaseSecondSubmissionResponse();
	}
	const secondHeading = chat.getByRole('heading', {name: 'Question 2'});
	await expect(secondHeading).toBeVisible();
	await expect(chat.getByText(/do not support a reliable answer/)).toBeVisible({timeout: 15_000});
	await expect(chat.getByText('LocalCast did not use outside knowledge.')).toBeVisible();
	await expect(liveStatus).toHaveText('The episode evidence was insufficient for an answer.');
	await expect(chat.getByRole('alert')).toHaveCount(0);
	await expect(secondHeading).toBeFocused();
	expect(submissionKeys).toHaveLength(2);
	expect((await new AxeBuilder({page}).include('.episode-chat').analyze()).violations).toEqual([]);

	await question.fill('How does the synthetic retry fixture recover?');
	await submit.focus();
	await page.keyboard.press('Enter');
	const thirdArticle = chat.getByRole('article', {name: 'Question 3'});
	await expect(thirdArticle.getByText(/synthetic text provider timed out/i)).toBeVisible({timeout: 15_000});
	await expect(chat.locator('[role="status"], [role="alert"]')).toHaveCount(1);
	expect((await new AxeBuilder({page}).include('.episode-chat').analyze()).violations).toEqual([]);
	const thirdRetry = thirdArticle.getByRole('button', {name: 'Retry question'});
	await thirdRetry.focus();
	await page.keyboard.press('Enter');
	await retryAccepted;
	try {
		await expect(suggestion).toBeDisabled();
		await expect(question).toBeDisabled();
		await expect(submit).toBeDisabled();
		expect(await thirdRetry.evaluateAll(buttons => buttons.length === 0 || buttons.every(button => (button as HTMLButtonElement).disabled))).toBe(true);
		const replay = await request.post(`${origin}${firstRetryPath}`, {headers: {'Idempotency-Key': retryKeys[0]!}});
		expect(replay.status()).toBe(200);
		expect(await replay.json()).toMatchObject({
			acceptedRetry: {idempotencyKey: retryKeys[0], attemptNumber: 2},
		});
		await expect.poll(async () => {
			const response = await request.get(`${origin}${chatApiPath}`);
			const history = await response.json() as Array<{acceptedRetry?: {idempotencyKey: string}}>;
			return history[2]?.acceptedRetry?.idempotencyKey;
		}).toBe(retryKeys[0]);
		await expect(thirdArticle).toContainText(/Question queued|Checking the episode evidence|Grounded answer/);
		await expect(chat.getByRole('alert')).toHaveCount(0);
	} finally {
		releaseRetryResponse();
	}
	expect(retryKeys).toHaveLength(1);
	await expect(chat.getByRole('heading', {name: 'Question 3'})).toBeFocused();
	await expect(chat.getByRole('list', {name: 'Validated citations for answer to question 3'})).toBeVisible({timeout: 15_000});
	await expect(chat.getByRole('alert')).toHaveCount(0);
	expect(retryKeys).toHaveLength(1);
	expect(retryKeys[0]).toBeTruthy();
	const thirdAttemptSummary = thirdArticle.getByText('Attempt history');
	await thirdAttemptSummary.focus();
	await page.keyboard.press('Enter');
	await expect(chat.getByText('Attempt 1: failed (SYNTHETIC_CHAT_TIMEOUT)')).toBeVisible();
	await expect(chat.getByText('Attempt 2: answered')).toBeVisible();

	await question.fill('What survives a worker restart?');
	await submit.focus();
	await page.keyboard.press('Enter');
	await expect(chat.getByRole('article', {name: 'Question 4'})).toContainText(/Question queued|Checking the episode evidence/, {timeout: 5_000});
	expect((await request.post(`${controlOrigin}/configure-failure/none`)).status()).toBe(204);
	const fourthArticle = chat.getByRole('article', {name: 'Question 4'});
	await expect(fourthArticle.getByText(/interrupted before LocalCast could publish/)).toBeVisible({timeout: 15_000});
	const fourthRetry = fourthArticle.getByRole('button', {name: 'Retry question'});
	await fourthRetry.focus();
	await page.keyboard.press('Enter');
	await expect(chat.getByRole('heading', {name: 'Question 4'})).toBeFocused();
	await expect(chat.getByRole('list', {name: 'Validated citations for answer to question 4'})).toBeVisible({timeout: 20_000});

	turns = await (await request.get(`${origin}/api/briefing-runs/${encodeURIComponent(runId)}/chat-turns`)).json() as Array<{state: string; attemptCount: number}>;
	expect(turns.map(turn => turn.state)).toEqual(['answered', 'refused', 'answered', 'answered']);
	expect(turns.map(turn => turn.attemptCount)).toEqual([1, 1, 2, 2]);
	expect(browserRequests.every(url => new URL(url).origin === origin)).toBe(true);
	const stableHistory = structuredClone(turns);
	const renderedQuestions = await chat.locator('.episode-chat__question').allTextContents();
	const renderedTimestamps = await chat.locator('.episode-chat__turn time').evaluateAll(elements => elements.map(element => element.getAttribute('datetime')));

	const freshContext = await browser.newContext();
	try {
		const freshPage = await freshContext.newPage();
		const freshRequests: string[] = [];
		freshPage.on('request', browserRequest => freshRequests.push(browserRequest.url()));
		await freshPage.goto(`${origin}/episodes/${encodeURIComponent(runId)}`);
		const freshChat = freshPage.locator('.episode-chat');
		await expect(freshChat.getByRole('article')).toHaveCount(4);
		expect(await freshChat.getByRole('heading', {name: /^Question [1-4]$/}).allTextContents()).toEqual(['Question 1', 'Question 2', 'Question 3', 'Question 4']);
		await expect(freshChat.getByRole('list', {name: 'Validated citations for answer to question 1'})).toBeVisible();
		await expect(freshChat.getByText(/do not support a reliable answer/)).toBeVisible();
		await expect(freshChat.getByText('Attempt 1: failed (SYNTHETIC_CHAT_TIMEOUT)')).toHaveCount(1);
		await expect(freshChat.getByText('Attempt 2: answered')).toHaveCount(2);
		expect(await freshChat.locator('.episode-chat__question').allTextContents()).toEqual(renderedQuestions);
		expect(await freshChat.locator('.episode-chat__turn time').evaluateAll(elements => elements.map(element => element.getAttribute('datetime')))).toEqual(renderedTimestamps);
		const freshHistory = await freshPage.evaluate(async path => {
			const response = await fetch(path);
			if (!response.ok) throw new Error('Synthetic persisted chat history request failed');
			return response.json();
		}, chatApiPath);
		expect(freshHistory).toEqual(stableHistory);
		expect(freshRequests.every(url => new URL(url).origin === origin)).toBe(true);
	} finally {
		await freshContext.close();
	}

	rejectNextSubmission = true;
	await question.fill('This synthetic submission must be rejected before persistence.');
	await submit.focus();
	await page.keyboard.press('Enter');
	await expect(chat.getByRole('alert')).toContainText('Synthetic submission rejected');
	await expect(chat.getByRole('alert')).toBeFocused();
	await expect(chat.getByRole('article')).toHaveCount(4);
	await page.waitForTimeout(750);
	await expect(chat.getByRole('alert')).toContainText('Synthetic submission rejected');
	const afterRejectedSubmission = await (await request.get(`${origin}${chatApiPath}`)).json() as unknown[];
	expect(afterRejectedSubmission).toHaveLength(4);

	await question.fill('How does the synthetic retry fixture behave with competing clients?');
	await submit.focus();
	await page.keyboard.press('Enter');
	const fifthArticle = chat.getByRole('article', {name: 'Question 5'});
	await expect(fifthArticle.getByText(/synthetic text provider timed out/i)).toBeVisible({timeout: 15_000});
	frozenHistory = await (await request.get(`${origin}${chatApiPath}`)).json() as unknown[];
	const fifthTurnId = (frozenHistory[4] as {id: string}).id;
	freezeHistory = true;
	const fifthRetryPath = `${chatApiPath}/${encodeURIComponent(fifthTurnId)}/retry`;
	const competingWinner = await request.post(`${origin}${fifthRetryPath}`, {headers: {'Idempotency-Key': 'synthetic-competing-winner'}});
	expect(competingWinner.status()).toBe(200);
	const competingApiLoser = await request.post(`${origin}${fifthRetryPath}`, {headers: {'Idempotency-Key': 'synthetic-competing-api-loser'}});
	expect(competingApiLoser.status()).toBe(409);
	competingRetry = true;
	const losingRetry = fifthArticle.getByRole('button', {name: 'Retry question'});
	await expect(losingRetry).toBeEnabled();
	const losingResponse = page.waitForResponse(response => (
		response.request().method() === 'POST' && new URL(response.url()).pathname === fifthRetryPath
	));
	await losingRetry.focus();
	await page.keyboard.press('Enter');
	expect((await losingResponse).status()).toBe(409);
	expect(competingRetryObserved).toBe(true);
	expect(retryKeys.at(-1)).not.toBe('synthetic-competing-winner');
	const competingHistory = await (await request.get(`${origin}${chatApiPath}`)).json() as Array<{
		state: string;
		acceptedRetry?: {idempotencyKey: string; attemptNumber: number};
	}>;
	expect(competingHistory[4]?.acceptedRetry).toEqual({
		idempotencyKey: 'synthetic-competing-winner',
		attemptNumber: 2,
		acceptedAt: expect.any(String),
	});
	await expect(chat.getByRole('alert')).toContainText('A different retry request was accepted. This retry was not accepted.');
	await expect(chat.getByRole('alert')).toBeFocused();
	await expect(fifthArticle.getByRole('list', {name: 'Validated citations for answer to question 5'})).toBeVisible({timeout: 15_000});
	await expect(chat.getByRole('alert')).toContainText('A different retry request was accepted. This retry was not accepted.');
	const fifthTurn = (await (await request.get(`${origin}${chatApiPath}`)).json() as Array<{
		state: string;
		acceptedRetry?: {idempotencyKey: string; attemptNumber: number};
	}>)[4];
	expect(fifthTurn).toMatchObject({
		state: 'answered',
		acceptedRetry: {idempotencyKey: 'synthetic-competing-winner', attemptNumber: 2},
	});
	expect(retryKeys.at(-1)).not.toBe('synthetic-competing-winner');

	const errorContext = await browser.newContext();
	try {
		const errorPage = await errorContext.newPage();
		await errorPage.route(`**${chatApiPath}`, async route => {
			if (route.request().method() === 'GET') {
				await route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({error: 'Synthetic history unavailable'})});
				return;
			}
			await route.continue();
		});
		await errorPage.goto(`${origin}/episodes/${encodeURIComponent(runId)}`);
		const errorChat = errorPage.locator('.episode-chat');
		await expect(errorChat.getByText(/Question history is unavailable/)).toBeVisible({timeout: 15_000});
		await expect(errorChat.getByRole('textbox', {name: 'Question'})).toBeDisabled();
		await expect(errorChat.locator('button[type="submit"]')).toBeDisabled();
		expect((await new AxeBuilder({page: errorPage}).include('.episode-chat').analyze()).violations).toEqual([]);
	} finally {
		await errorContext.close();
	}

	const accessibility = await new AxeBuilder({page}).include('.episode-chat').analyze();
	expect(accessibility.violations).toEqual([]);
	await page.setViewportSize({width: 320, height: 900});
	await page.evaluate(() => { document.documentElement.style.fontSize = '32px'; });
	await expect(chat).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
	expect((await chat.boundingBox())!.width).toBeLessThanOrEqual(320);
	await expect(disclosure).toBeVisible();
	expect((await new AxeBuilder({page}).include('.episode-chat').analyze()).violations).toEqual([]);
});

test('ambiguous chat mutations survive an empty first history fetch and reconcile only by exact identity', async ({page, request}) => {
	test.setTimeout(120_000);
	const runId = await createCompletedSyntheticEpisode(request, 'late-visibility');
	const chatApiPath = `/api/briefing-runs/${encodeURIComponent(runId)}/chat-turns`;
	type PendingIntercept = {
		idempotencyKey: string;
		question?: string;
		path: string;
		firstHistoryWasEmpty: boolean;
	};
	let submissionBehavior: 'pass' | 'ambiguous' | 'reject' = 'pass';
	let retryBehavior: 'pass' | 'ambiguous' | 'reject' = 'pass';
	let pendingSubmission: PendingIntercept | undefined;
	let pendingRetry: PendingIntercept | undefined;
	let browserSubmissionCalls = 0;
	let browserRetryCalls = 0;
	let browserHistoryCalls = 0;
	let heldHistory: {markStarted: () => void; markCompleted: () => void; release: Promise<void>; fail: boolean} | undefined;
	const holdNextHistoryResponse = (fail = false) => {
		let markStarted!: () => void;
		let markCompleted!: () => void;
		let release!: () => void;
		const started = new Promise<void>(resolve => { markStarted = resolve; });
		const completed = new Promise<void>(resolve => { markCompleted = resolve; });
		const released = new Promise<void>(resolve => { release = resolve; });
		heldHistory = {markStarted, markCompleted, release: released, fail};
		return {started, completed, release};
	};

	await page.route(`**${chatApiPath}`, async route => {
		if (route.request().method() === 'GET') {
			browserHistoryCalls += 1;
			const held = heldHistory;
			if (held) {
				heldHistory = undefined;
				const response = await route.fetch();
				const history = await response.json() as Array<{
					submissionId?: string;
					acceptedRetry?: {idempotencyKey: string};
				}>;
				const pending = pendingSubmission || pendingRetry;
				expect(pending).toBeDefined();
				expect(history.some(turn => (
					turn.submissionId === pending?.idempotencyKey
					|| turn.acceptedRetry?.idempotencyKey === pending?.idempotencyKey
				))).toBe(false);
				if (pending) pending.firstHistoryWasEmpty = true;
				held.markStarted();
				await held.release;
				if (held.fail) await route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({error: 'Synthetic stale history failure'})});
				else await route.fulfill({response, body: JSON.stringify(history)});
				held.markCompleted();
				return;
			}
			const pending = pendingSubmission || pendingRetry;
			if (pending && !pending.firstHistoryWasEmpty) {
				const response = await route.fetch();
				const history = await response.json() as Array<{
					submissionId?: string;
					acceptedRetry?: {idempotencyKey: string};
				}>;
				expect(history.some(turn => (
					turn.submissionId === pending.idempotencyKey
					|| turn.acceptedRetry?.idempotencyKey === pending.idempotencyKey
				))).toBe(false);
				pending.firstHistoryWasEmpty = true;
				await route.fulfill({response, body: JSON.stringify(history)});
				return;
			}
		}
		if (route.request().method() === 'POST') {
			browserSubmissionCalls += 1;
			if (submissionBehavior !== 'pass') {
				const behavior = submissionBehavior;
				submissionBehavior = 'pass';
				const body = route.request().postDataJSON() as {question: string};
				if (behavior === 'ambiguous') pendingSubmission = {
					idempotencyKey: route.request().headers()['idempotency-key'] || '',
					question: body.question,
					path: new URL(route.request().url()).pathname,
					firstHistoryWasEmpty: false,
				};
				await route.fulfill({
					status: behavior === 'ambiguous' ? 503 : 400,
					contentType: 'application/json',
					body: JSON.stringify({error: behavior === 'ambiguous' ? 'Synthetic response lost before persistence was visible' : 'Synthetic request rejected'}),
				});
				return;
			}
		}
		await route.continue();
	});
	await page.route(`**${chatApiPath}/*/retry`, async route => {
		browserRetryCalls += 1;
		if (retryBehavior !== 'pass') {
			const behavior = retryBehavior;
			retryBehavior = 'pass';
			if (behavior === 'ambiguous') pendingRetry = {
				idempotencyKey: route.request().headers()['idempotency-key'] || '',
				path: new URL(route.request().url()).pathname,
				firstHistoryWasEmpty: false,
			};
			await route.fulfill({
				status: behavior === 'ambiguous' ? 503 : 409,
				contentType: 'application/json',
				body: JSON.stringify({error: behavior === 'ambiguous' ? 'Synthetic retry response lost' : 'Synthetic retry rejected'}),
			});
			return;
		}
		await route.continue();
	});

	await page.goto(`${origin}/episodes/${encodeURIComponent(runId)}`);
	const chat = page.locator('.episode-chat');
	const question = chat.getByRole('textbox', {name: 'Question'});
	const submit = chat.locator('button[type="submit"]');
	await expect(submit).toHaveText('Ask this episode');

	const persistedAction = async () => page.evaluate(() => {
		const entry = Object.entries(localStorage).find(([key]) => key.includes('localcast:episode-chat:pending:v2:'));
		return entry ? JSON.parse(entry[1]) as Record<string, unknown> : undefined;
	});

	submissionBehavior = 'ambiguous';
	const supportedQuestion = 'What exact synthetic fact is grounded in this episode?';
	await question.fill(supportedQuestion);
	await submit.click();
	await expect(chat.getByRole('alert')).toContainText(/could not confirm whether this question was accepted/i);
	expect(pendingSubmission?.firstHistoryWasEmpty).toBe(true);
	expect(await persistedAction()).toMatchObject({kind: 'submission', idempotencyKey: pendingSubmission?.idempotencyKey});
	expect(JSON.stringify(await persistedAction())).not.toContain(supportedQuestion);
	await expect(question).toBeDisabled();
	await expect(submit).toBeDisabled();
	await expect(chat.getByRole('button', {name: 'Check question history again'})).toBeEnabled();

	await expect(chat.getByRole('alert')).toContainText(/could not confirm whether this question was accepted/i);
	expect(browserSubmissionCalls).toBe(1);

	const acceptedSupported = await request.post(`${origin}${pendingSubmission!.path}`, {
		headers: {'Idempotency-Key': pendingSubmission!.idempotencyKey},
		data: {question: pendingSubmission!.question},
	});
	expect(acceptedSupported.status()).toBe(202);
	await expect(chat.getByText(supportedQuestion)).toBeVisible({timeout: 20_000});
	const supportedArticle = chat.getByRole('article').filter({hasText: supportedQuestion});
	await expect(supportedArticle).toContainText('Grounded answer', {timeout: 20_000});
	await expect(chat.getByRole('alert')).toHaveCount(0);
	expect(await persistedAction()).toBeUndefined();
	expect(browserSubmissionCalls).toBe(1);
	pendingSubmission = undefined;

	submissionBehavior = 'ambiguous';
	const refusalQuestion = 'What happened outside this episode during late reconciliation?';
	await question.fill(refusalQuestion);
	await submit.click();
	await expect(chat.getByRole('alert')).toContainText(/could not confirm whether this question was accepted/i);
	expect(pendingSubmission?.firstHistoryWasEmpty).toBe(true);
	await page.reload();
	await expect(chat.getByRole('alert')).toContainText(/reconciling a shared question request/i);
	await expect(question).toBeDisabled();
	expect((await persistedAction())?.idempotencyKey).toBe(pendingSubmission?.idempotencyKey);
	const acceptedRefusal = await request.post(`${origin}${pendingSubmission!.path}`, {
		headers: {'Idempotency-Key': pendingSubmission!.idempotencyKey},
		data: {question: pendingSubmission!.question},
	});
	expect(acceptedRefusal.status()).toBe(202);
	await expect(chat.getByText(refusalQuestion)).toBeVisible({timeout: 20_000});
	const refusalArticle = chat.getByRole('article').filter({hasText: refusalQuestion});
	await expect(refusalArticle).toContainText(/do not support a reliable answer/i, {timeout: 20_000});
	await expect(chat.getByRole('alert')).toHaveCount(0);
	expect(await persistedAction()).toBeUndefined();
	pendingSubmission = undefined;

	const retryQuestion = 'How does the synthetic retry fixture preserve exact retry identity?';
	await question.fill(retryQuestion);
	await submit.click();
	const retryArticle = chat.getByRole('article').filter({hasText: retryQuestion});
	await expect(retryArticle.getByRole('button', {name: 'Retry question'})).toBeVisible({timeout: 20_000});
	retryBehavior = 'ambiguous';
	await retryArticle.getByRole('button', {name: 'Retry question'}).click();
	await expect(chat.getByRole('alert')).toContainText(/could not confirm whether this retry was accepted/i);
	expect(pendingRetry?.firstHistoryWasEmpty).toBe(true);
	expect(await persistedAction()).toMatchObject({
		kind: 'retry',
		idempotencyKey: pendingRetry?.idempotencyKey,
		baselineAttemptCount: 1,
	});
	await expect(submit).toBeDisabled();
	const acceptedRetry = await request.post(`${origin}${pendingRetry!.path}`, {
		headers: {'Idempotency-Key': pendingRetry!.idempotencyKey},
	});
	expect(acceptedRetry.status()).toBe(200);
	const retryReplay = await request.post(`${origin}${pendingRetry!.path}`, {
		headers: {'Idempotency-Key': pendingRetry!.idempotencyKey},
	});
	expect(retryReplay.status()).toBe(200);
	await expect(retryArticle).toContainText('Grounded answer', {timeout: 20_000});
	await expect(chat.getByRole('alert')).toHaveCount(0);
	expect(await persistedAction()).toBeUndefined();
	expect(browserRetryCalls).toBe(1);
	pendingRetry = undefined;

	submissionBehavior = 'ambiguous';
	const automaticPollQuestion = 'How is an older automatic history poll fenced from exact acceptance?';
	await question.fill(automaticPollQuestion);
	await submit.click();
	await expect(chat.getByRole('alert')).toContainText(/could not confirm whether this question was accepted/i);
	expect(pendingSubmission?.firstHistoryWasEmpty).toBe(true);
	const automaticHistory = holdNextHistoryResponse(true);
	await automaticHistory.started;
	const acceptedDuringAutomaticPoll = await request.post(`${origin}${pendingSubmission!.path}`, {
		headers: {'Idempotency-Key': pendingSubmission!.idempotencyKey},
		data: {question: pendingSubmission!.question},
	});
	expect(acceptedDuringAutomaticPoll.status()).toBe(202);
	await chat.getByRole('button', {name: 'Check question history again'}).click();
	const automaticPollArticle = chat.getByRole('article').filter({hasText: automaticPollQuestion});
	await expect(automaticPollArticle).toContainText(/Question queued|Checking the episode evidence/);
	await expect(chat.getByRole('alert')).toHaveCount(0);
	automaticHistory.release();
	await automaticHistory.completed;
	await expect(automaticPollArticle).toContainText('Grounded answer', {timeout: 20_000});
	await expect(chat.getByRole('alert')).toHaveCount(0);
	await expect(chat.getByText(/Question history is unavailable/)).toHaveCount(0);
	await expect(question).toBeEnabled();
	await question.fill('Synthetic controls remain usable after the stale history failure.');
	await expect(submit).toBeEnabled();
	expect(await persistedAction()).toBeUndefined();
	pendingSubmission = undefined;

	submissionBehavior = 'ambiguous';
	const mutationErrorQuestion = 'How is an older mutation-error history response fenced from exact acceptance?';
	const mutationErrorHistory = holdNextHistoryResponse();
	await question.fill(mutationErrorQuestion);
	await submit.click();
	await mutationErrorHistory.started;
	const acceptedDuringMutationErrorHistory = await request.post(`${origin}${pendingSubmission!.path}`, {
		headers: {'Idempotency-Key': pendingSubmission!.idempotencyKey},
		data: {question: pendingSubmission!.question},
	});
	expect(acceptedDuringMutationErrorHistory.status()).toBe(202);
	const mutationErrorArticle = chat.getByRole('article').filter({hasText: mutationErrorQuestion});
	await expect(mutationErrorArticle).toContainText(/Question queued|Checking the episode evidence/, {timeout: 20_000});
	await expect(chat.getByRole('alert')).toHaveCount(0);
	mutationErrorHistory.release();
	await mutationErrorHistory.completed;
	await expect(mutationErrorArticle).toContainText('Grounded answer', {timeout: 20_000});
	await expect(chat.getByRole('alert')).toHaveCount(0);
	await expect.poll(persistedAction).toBeUndefined();
	pendingSubmission = undefined;

	submissionBehavior = 'ambiguous';
	const manualRaceQuestion = 'How is a delayed manual history response fenced from newer state?';
	await question.fill(manualRaceQuestion);
	await submit.click();
	await expect(chat.getByRole('alert')).toContainText(/could not confirm whether this question was accepted/i);
	expect(pendingSubmission?.firstHistoryWasEmpty).toBe(true);
	await page.waitForResponse(response => (
		response.request().method() === 'GET'
		&& new URL(response.url()).pathname === chatApiPath
	));
	const manualHistory = holdNextHistoryResponse();
	await chat.getByRole('button', {name: 'Check question history again'}).click();
	await manualHistory.started;
	const acceptedDuringManualCheck = await request.post(`${origin}${pendingSubmission!.path}`, {
		headers: {'Idempotency-Key': pendingSubmission!.idempotencyKey},
		data: {question: pendingSubmission!.question},
	});
	expect(acceptedDuringManualCheck.status()).toBe(202);
	const manualRaceArticle = chat.getByRole('article').filter({hasText: manualRaceQuestion});
	await expect(manualRaceArticle).toContainText('Grounded answer', {timeout: 20_000});
	await expect(chat.getByRole('alert')).toHaveCount(0);

	submissionBehavior = 'reject';
	const newerRejectedQuestion = 'This newer synthetic action must retain its own rejection.';
	await question.fill(newerRejectedQuestion);
	await submit.click();
	await expect(chat.getByRole('alert')).toContainText('Synthetic request rejected');
	manualHistory.release();
	await manualHistory.completed;
	await expect(manualRaceArticle).toContainText('Grounded answer');
	await expect(chat.getByRole('alert')).toContainText('Synthetic request rejected');
	await expect(chat.getByRole('alert')).toBeFocused();
	expect(await persistedAction()).toBeUndefined();
	pendingSubmission = undefined;

	submissionBehavior = 'reject';
	await question.fill('This synthetic initial request is provably rejected.');
	await submit.click();
	await expect(chat.getByRole('alert')).toContainText('Synthetic request rejected');
	await expect(chat.getByRole('alert')).toBeFocused();
	expect(await persistedAction()).toBeUndefined();
	await expect(question).toBeEnabled();

	await question.fill('How does another synthetic retry fixture remain rejected?');
	await submit.click();
	const rejectedRetryArticle = chat.getByRole('article').filter({hasText: 'How does another synthetic retry fixture remain rejected?'});
	await expect(rejectedRetryArticle.getByRole('button', {name: 'Retry question'})).toBeVisible({timeout: 20_000});
	retryBehavior = 'reject';
	await rejectedRetryArticle.getByRole('button', {name: 'Retry question'}).click();
	await expect(chat.getByRole('alert')).toContainText('Synthetic retry rejected');
	await expect(chat.getByRole('alert')).toBeFocused();
	expect(await persistedAction()).toBeUndefined();
	await page.waitForTimeout(750);
	await expect(chat.getByRole('alert')).toContainText('Synthetic retry rejected');
	await expect(rejectedRetryArticle.getByRole('button', {name: 'Retry question'})).toBeEnabled();

	submissionBehavior = 'ambiguous';
	const supersededManualQuestion = 'How does a superseded manual history check release its checking control?';
	await question.fill(supersededManualQuestion);
	await submit.click();
	await expect(chat.getByRole('alert')).toContainText(/could not confirm whether this question was accepted/i);
	const historyCallsBeforeManualCheck = browserHistoryCalls;
	const supersededManualHistory = holdNextHistoryResponse();
	const manualCheck = chat.getByRole('button', {name: 'Check question history again'});
	await manualCheck.click();
	await supersededManualHistory.started;
	await expect.poll(() => browserHistoryCalls).toBeGreaterThan(historyCallsBeforeManualCheck + 1);
	supersededManualHistory.release();
	await supersededManualHistory.completed;
	await expect(manualCheck).toBeEnabled();
	await expect(chat.getByRole('alert')).toContainText(/could not confirm whether this question was accepted/i);
	const acceptedAfterSupersededManual = await request.post(`${origin}${pendingSubmission!.path}`, {
		headers: {'Idempotency-Key': pendingSubmission!.idempotencyKey},
		data: {question: pendingSubmission!.question},
	});
	expect(acceptedAfterSupersededManual.status()).toBe(202);
	await expect(chat.getByRole('article').filter({hasText: supersededManualQuestion})).toContainText('Grounded answer', {timeout: 20_000});
	await expect(chat.getByRole('alert')).toHaveCount(0);
	pendingSubmission = undefined;

	submissionBehavior = 'ambiguous';
	const boundedQuestion = 'What happens when the bounded identity check window expires?';
	await question.fill(boundedQuestion);
	await submit.click();
	await expect(chat.getByRole('alert')).toContainText(/could not confirm whether this question was accepted/i);
	expect(pendingSubmission?.firstHistoryWasEmpty).toBe(true);
	await page.evaluate(() => {
		const key = Object.keys(localStorage).find(candidate => candidate.includes('localcast:episode-chat:pending:v2:'));
		if (!key) throw new Error('Synthetic pending identity was not retained');
		const pending = JSON.parse(localStorage.getItem(key) || '{}') as Record<string, unknown>;
		const createdAt = Date.now() - 10_000;
		localStorage.setItem(key, JSON.stringify({...pending, createdAt, reconcileUntil: Date.now() - 1}));
	});
	await page.reload();
	await expect(chat.getByRole('alert')).toContainText(/could not confirm this question within the bounded check window/i);
	await expect(question).toBeDisabled();
	await expect(submit).toBeDisabled();
	const callsBeforeManualResolution = browserSubmissionCalls;
	const acceptedAfterWindow = await request.post(`${origin}${pendingSubmission!.path}`, {
		headers: {'Idempotency-Key': pendingSubmission!.idempotencyKey},
		data: {question: pendingSubmission!.question},
	});
	expect(acceptedAfterWindow.status()).toBe(202);
	await chat.getByRole('button', {name: 'Check question history again'}).click();
	await expect(chat.getByText(boundedQuestion)).toBeVisible({timeout: 20_000});
	await expect(chat.getByRole('alert')).toHaveCount(0);
	await expect(chat.getByRole('article').filter({hasText: boundedQuestion})).toContainText('Grounded answer', {timeout: 20_000});
	expect(browserSubmissionCalls).toBe(callsBeforeManualResolution);
	expect(await persistedAction()).toBeUndefined();
	expect((await new AxeBuilder({page}).include('.episode-chat').analyze()).violations).toEqual([]);
});

test('same-origin tabs share the unresolved action lock while the server remains authoritative', async ({browser, request}) => {
	test.setTimeout(90_000);
	const runId = await createCompletedSyntheticEpisode(request, 'cross-tab-lock');
	const chatApiPath = `/api/briefing-runs/${encodeURIComponent(runId)}/chat-turns`;
	const context = await browser.newContext();
	let releasePost!: () => void;
	const postGate = new Promise<void>(resolve => { releasePost = resolve; });
	let markPostStarted!: () => void;
	const postStarted = new Promise<void>(resolve => { markPostStarted = resolve; });
	let browserPostCount = 0;
	const submittedKeys = new Set<string>();
	await context.route(`**${chatApiPath}`, async route => {
		if (route.request().method() === 'POST') {
			browserPostCount += 1;
			submittedKeys.add(route.request().headers()['idempotency-key'] || '');
			const response = await route.fetch();
			markPostStarted();
			await postGate;
			try {
				await route.fulfill({response});
			} catch (error) {
				if (!route.request().frame().page().isClosed()) throw error;
			}
			return;
		}
		await route.continue();
	});

	try {
		const first = await context.newPage();
		const second = await context.newPage();
		await Promise.all([
			first.goto(`${origin}/episodes/${encodeURIComponent(runId)}`),
			second.goto(`${origin}/episodes/${encodeURIComponent(runId)}`),
		]);
		const firstChat = first.locator('.episode-chat');
		const secondChat = second.locator('.episode-chat');
		await expect(firstChat.locator('button[type="submit"]')).toHaveText('Ask this episode');
		await expect(secondChat.locator('button[type="submit"]')).toHaveText('Ask this episode');
		await firstChat.getByRole('textbox', {name: 'Question'}).fill('Synthetic first-tab race question?');
		await secondChat.getByRole('textbox', {name: 'Question'}).fill('Synthetic second-tab race question?');
		await Promise.all([
			firstChat.locator('form').evaluate(form => (form as HTMLFormElement).requestSubmit()),
			secondChat.locator('form').evaluate(form => (form as HTMLFormElement).requestSubmit()),
		]);
		await postStarted;
		expect(browserPostCount).toBeGreaterThanOrEqual(1);
		await expect(firstChat.locator('button[type="submit"]')).toBeDisabled();
		await expect(secondChat.locator('button[type="submit"]')).toBeDisabled();
		const sharedRecords = await Promise.all([first, second].map(tab => tab.evaluate(() => {
			const entry = Object.entries(localStorage).find(([key]) => key.includes('localcast:episode-chat:pending:v2:'));
			return entry?.[1];
		})));
		expect(sharedRecords[0]).toBeTruthy();
		expect(sharedRecords[1]).toBe(sharedRecords[0]);
		expect(sharedRecords[0]).not.toContain('Synthetic first-tab race question');
		expect(sharedRecords[0]).not.toContain('Synthetic second-tab race question');

		const restored = await context.newPage();
		await restored.goto(`${origin}/episodes/${encodeURIComponent(runId)}`);
		await expect(restored.locator('.episode-chat').locator('button[type="submit"]')).toBeDisabled();
		await first.close();
		releasePost();
		await expect(secondChat.getByRole('article')).toHaveCount(1, {timeout: 20_000});
		await expect(secondChat.getByRole('article').first()).toContainText(/Grounded answer|do not support a reliable answer/i, {timeout: 20_000});
		const authoritativeHistory = await (await request.get(`${origin}${chatApiPath}`)).json() as Array<{submissionId: string}>;
		expect(authoritativeHistory).toHaveLength(1);
		expect([...submittedKeys]).toContain(authoritativeHistory[0]!.submissionId);
		expect(browserPostCount).toBeLessThanOrEqual(2);
		await expect(secondChat.getByRole('textbox', {name: 'Question'})).toBeEnabled();
		await expect.poll(async () => second.evaluate(() => (
			Object.keys(localStorage).some(key => key.includes('localcast:episode-chat:pending:v2:'))
		))).toBe(false);

		await secondChat.getByRole('textbox', {name: 'Question'}).fill('Synthetic sequential post-terminal question?');
		await expect(secondChat.locator('button[type="submit"]')).toBeEnabled();
		await secondChat.locator('button[type="submit"]').click();
		await expect(secondChat.getByRole('article')).toHaveCount(2, {timeout: 20_000});
		expect((await request.get(`${origin}${chatApiPath}`)).status()).toBe(200);
	} finally {
		releasePost();
		await context.close();
	}
});

test('authoritative active history survives malformed-record replacement races without leaving controls blocked', async ({page, request}) => {
	test.setTimeout(90_000);
	const runId = await createCompletedSyntheticEpisode(request, 'malformed-shared-coordination');
	const chatApiPath = `/api/briefing-runs/${encodeURIComponent(runId)}/chat-turns`;
	const question = 'Synthetic malformed coordination recovery question?';
	const acceptedResponse = await request.post(`${origin}${chatApiPath}`, {
		headers: {'Idempotency-Key': 'synthetic-malformed-coordination-key'},
		data: {question},
	});
	expect(acceptedResponse.status()).toBe(202);
	const acceptedTurn = await acceptedResponse.json() as Record<string, unknown> & {submissionId: string};
	let releaseFirstHistory!: () => void;
	const firstHistoryGate = new Promise<void>(resolve => { releaseFirstHistory = resolve; });
	let markFirstHistoryStarted!: () => void;
	const firstHistoryStarted = new Promise<void>(resolve => { markFirstHistoryStarted = resolve; });
	let releaseLaterHistory!: () => void;
	const laterHistoryGate = new Promise<void>(resolve => { releaseLaterHistory = resolve; });
	let getCount = 0;
	await page.addInitScript(episodeId => {
		localStorage.setItem(`localcast:episode-chat:pending:v2:${episodeId}`, JSON.stringify({version: 2, runId: episodeId}));
	}, runId);
	await page.route(`**${chatApiPath}`, async route => {
		if (route.request().method() !== 'GET') {
			await route.continue();
			return;
		}
		getCount += 1;
		if (getCount === 1) {
			markFirstHistoryStarted();
			await firstHistoryGate;
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify([{...acceptedTurn, state: 'queued'}]),
			});
			return;
		}
		await laterHistoryGate;
		await route.continue();
	});

	try {
		const navigation = page.goto(`${origin}/episodes/${encodeURIComponent(runId)}`);
		await firstHistoryStarted;
		const chat = page.locator('.episode-chat');
		await expect(chat.getByRole('alert')).toContainText('could not validate the shared pending-action record');
		await page.evaluate(({episodeId, idempotencyKey}) => {
			const createdAt = Date.now();
			localStorage.setItem(`localcast:episode-chat:pending:v2:${episodeId}`, JSON.stringify({
				version: 2,
				runId: episodeId,
				kind: 'submission',
				idempotencyKey,
				generationId: 'competing-generation-id',
				ownerId: 'competing-owner-id',
				createdAt,
				reconcileUntil: createdAt + 10_000,
			}));
		}, {episodeId: runId, idempotencyKey: acceptedTurn.submissionId});
		releaseFirstHistory();
		releaseLaterHistory();
		await navigation;
		await expect(chat.getByRole('article').filter({hasText: question})).toContainText(
			/Grounded answer|do not support a reliable answer/i,
			{timeout: 20_000},
		);
		await expect(chat.getByRole('alert')).toHaveCount(0);
		await expect(chat.getByRole('textbox', {name: 'Question'})).toBeEnabled();
		await expect.poll(async () => page.evaluate(episodeId => (
			localStorage.getItem(`localcast:episode-chat:pending:v2:${episodeId}`)
		), runId)).toBeNull();
	} finally {
		releaseFirstHistory();
		releaseLaterHistory();
	}
});

test('an unresolved valid record winning a malformed-record race keeps exact manual reconciliation available', async ({page, request}) => {
	test.setTimeout(60_000);
	const runId = await createCompletedSyntheticEpisode(request, 'malformed-shared-unresolved');
	const chatApiPath = `/api/briefing-runs/${encodeURIComponent(runId)}/chat-turns`;
	let releaseHistory!: () => void;
	const historyGate = new Promise<void>(resolve => { releaseHistory = resolve; });
	let markHistoryStarted!: () => void;
	const historyStarted = new Promise<void>(resolve => { markHistoryStarted = resolve; });
	await page.addInitScript(episodeId => {
		localStorage.setItem(`localcast:episode-chat:pending:v2:${episodeId}`, JSON.stringify({version: 2, runId: episodeId}));
	}, runId);
	await page.route(`**${chatApiPath}`, async route => {
		if (route.request().method() === 'GET') {
			markHistoryStarted();
			await historyGate;
			await route.fulfill({status: 200, contentType: 'application/json', body: '[]'});
			return;
		}
		await route.continue();
	});

	try {
		const navigation = page.goto(`${origin}/episodes/${encodeURIComponent(runId)}`);
		await historyStarted;
		const chat = page.locator('.episode-chat');
		await expect(chat.getByRole('alert')).toContainText('could not validate the shared pending-action record');
		await page.evaluate(episodeId => {
			const createdAt = Date.now();
			localStorage.setItem(`localcast:episode-chat:pending:v2:${episodeId}`, JSON.stringify({
				version: 2,
				runId: episodeId,
				kind: 'submission',
				idempotencyKey: 'unresolved-shared-action-key',
				generationId: 'unresolved-generation-id',
				ownerId: 'unresolved-owner-id',
				createdAt,
				reconcileUntil: createdAt + 10_000,
			}));
		}, runId);
		releaseHistory();
		await navigation;
		await expect(chat.getByRole('alert')).toContainText('reconciling a shared question request');
		await expect(chat.getByRole('button', {name: 'Check question history again'})).toBeEnabled();
		await expect(chat.locator('button[type="submit"]')).toBeDisabled();
	} finally {
		releaseHistory();
	}
});

test('independent browser contexts converge on one server-authoritative unresolved question', async ({browser, request}) => {
	test.setTimeout(90_000);
	const runId = await createCompletedSyntheticEpisode(request, 'independent-context-race');
	const chatApiPath = `/api/briefing-runs/${encodeURIComponent(runId)}/chat-turns`;
	const contexts = [await browser.newContext(), await browser.newContext()];
	const pages = await Promise.all(contexts.map(context => context.newPage()));
	const questions = [
		'Synthetic independent-client question A?',
		'Synthetic independent-client question B?',
	] as const;
	const submittedKeys: string[] = [];
	let postArrivals = 0;
	let releasePosts!: () => void;
	const postGate = new Promise<void>(resolve => { releasePosts = resolve; });

	try {
		await Promise.all(pages.map(async (page, index) => {
			await page.route(`**${chatApiPath}`, async route => {
				if (route.request().method() === 'POST') {
					submittedKeys[index] = route.request().headers()['idempotency-key'] || '';
					postArrivals += 1;
					if (postArrivals === pages.length) releasePosts();
					await postGate;
				}
				await route.continue();
			});
			await page.goto(`${origin}/episodes/${encodeURIComponent(runId)}`);
		}));

		await Promise.all(pages.map(async (page, index) => {
			const chat = page.locator('.episode-chat');
			await chat.getByRole('textbox', {name: 'Question'}).fill(questions[index]!);
			await chat.locator('form').evaluate(form => (form as HTMLFormElement).requestSubmit());
		}));
		await expect.poll(() => postArrivals).toBe(2);
		expect(submittedKeys[0]).toBeTruthy();
		expect(submittedKeys[1]).toBeTruthy();
		expect(submittedKeys[0]).not.toBe(submittedKeys[1]);

		let authoritativeHistory: Array<{id: string; question: string; state: string; submissionId: string}> = [];
		await expect.poll(async () => {
			authoritativeHistory = await (await request.get(`${origin}${chatApiPath}`)).json() as typeof authoritativeHistory;
			return authoritativeHistory.length;
		}).toBe(1);
		const winner = authoritativeHistory[0]!;
		const winnerIndex = submittedKeys.indexOf(winner.submissionId);
		expect(winnerIndex).toBeGreaterThanOrEqual(0);
		const loserIndex = winnerIndex === 0 ? 1 : 0;
		expect(winner.submissionId).not.toBe(submittedKeys[loserIndex]);

		const loserChat = pages[loserIndex]!.locator('.episode-chat');
		await expect(loserChat.getByRole('alert')).toContainText('A different question was accepted first. This question was not accepted.');
		await Promise.all(pages.map(page => expect.poll(async () => page.evaluate(() => {
			const entry = Object.entries(localStorage).find(([key]) => key.includes('localcast:episode-chat:pending:v2:'));
			if (!entry) return undefined;
			return (JSON.parse(entry[1]) as {idempotencyKey?: string}).idempotencyKey;
		})).toBe(winner.submissionId)));
		await Promise.all(pages.map(page => expect(page.locator('.episode-chat').locator('button[type="submit"]')).toBeDisabled()));
		await Promise.all(pages.map(page => expect(page.locator('.episode-chat').getByRole('article').filter({hasText: winner.question})).toContainText(
			/Grounded answer|do not support a reliable answer/i,
			{timeout: 20_000},
		)));
		await Promise.all(pages.map(page => expect.poll(async () => page.evaluate(() => (
			Object.keys(localStorage).some(key => key.includes('localcast:episode-chat:pending:v2:'))
		))).toBe(false)));
	} finally {
		releasePosts();
		await Promise.all(contexts.map(context => context.close()));
	}
});

test('a losing retry identity yields to a different authoritative active question', async ({page, request}) => {
	test.setTimeout(90_000);
	const runId = await createCompletedSyntheticEpisode(request, 'retry-versus-question');
	const chatApiPath = `/api/briefing-runs/${encodeURIComponent(runId)}/chat-turns`;
	const retryableQuestion = 'How does this synthetic retry fixture fail before provider reservation?';
	const failedResponse = await request.post(`${origin}${chatApiPath}`, {
		headers: {'Idempotency-Key': 'synthetic-retry-versus-question-first'},
		data: {question: retryableQuestion},
	});
	expect(failedResponse.status()).toBe(202);
	const failedTurn = await failedResponse.json() as {id: string};
	await expect.poll(async () => {
		const history = await (await request.get(`${origin}${chatApiPath}`)).json() as Array<{id: string; state: string; retryable: boolean}>;
		return history.find(turn => turn.id === failedTurn.id);
	}, {timeout: 20_000}).toMatchObject({state: 'failed', retryable: true});

	let browserRetryKey = '';
	let winningSubmissionId = '';
	let competingHistory: unknown[] | undefined;
	let serveCompetingHistory = false;
	await page.route(`**${chatApiPath}`, async route => {
		if (route.request().method() === 'GET' && serveCompetingHistory && competingHistory) {
			serveCompetingHistory = false;
			await route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(competingHistory)});
			return;
		}
		await route.continue();
	});
	await page.route(`**${chatApiPath}/${encodeURIComponent(failedTurn.id)}/retry`, async route => {
		browserRetryKey = route.request().headers()['idempotency-key'] || '';
		const winningResponse = await request.post(`${origin}${chatApiPath}`, {
			headers: {'Idempotency-Key': 'synthetic-retry-versus-question-winner'},
			data: {question: 'Synthetic different question wins while retry is pending.'},
		});
		expect(winningResponse.status()).toBe(202);
		const winningTurn = await winningResponse.json() as {submissionId: string};
		winningSubmissionId = winningTurn.submissionId;
		competingHistory = await (await request.get(`${origin}${chatApiPath}`)).json() as unknown[];
		serveCompetingHistory = true;
		const rejectedRetry = await request.post(`${origin}${new URL(route.request().url()).pathname}`, {
			headers: {'Idempotency-Key': browserRetryKey},
		});
		expect(rejectedRetry.status()).toBe(409);
		await route.fulfill({
			status: rejectedRetry.status(),
			contentType: 'application/json',
			body: await rejectedRetry.text(),
		});
	});

	await page.goto(`${origin}/episodes/${encodeURIComponent(runId)}`);
	const chat = page.locator('.episode-chat');
	const failedArticle = chat.getByRole('article').filter({hasText: retryableQuestion});
	await failedArticle.getByRole('button', {name: 'Retry question'}).click();
	await expect(chat.getByRole('alert')).toContainText('A different question was accepted first. This retry was not accepted.');
	const sharedRecord = await page.evaluate(() => {
		const entry = Object.entries(localStorage).find(([key]) => key.includes('localcast:episode-chat:pending:v2:'));
		return entry ? JSON.parse(entry[1]) as Record<string, unknown> : undefined;
	});
	expect(sharedRecord).toMatchObject({kind: 'submission', idempotencyKey: winningSubmissionId});
	expect(sharedRecord?.idempotencyKey).not.toBe(browserRetryKey);
	await expect(chat.getByRole('article').filter({hasText: 'Synthetic different question wins while retry is pending.'})).toContainText(
		/Grounded answer|do not support a reliable answer/i,
		{timeout: 20_000},
	);
	await expect.poll(async () => page.evaluate(() => (
		Object.keys(localStorage).some(key => key.includes('localcast:episode-chat:pending:v2:'))
	))).toBe(false);
});

test('callbacks retained across unmount cannot overwrite a remounted action or shared cache', async ({page, request}) => {
	test.setTimeout(120_000);
	const runId = await createCompletedSyntheticEpisode(request, 'unmount-fence');
	const chatApiPath = `/api/briefing-runs/${encodeURIComponent(runId)}/chat-turns`;
	let postMode: 'hold-accepted' | 'ambiguous' | 'pass' = 'hold-accepted';
	let releaseOldMutation!: () => void;
	const oldMutationGate = new Promise<void>(resolve => { releaseOldMutation = resolve; });
	let markOldMutationAccepted!: () => void;
	const oldMutationAccepted = new Promise<void>(resolve => { markOldMutationAccepted = resolve; });
	let markOldMutationCompleted!: () => void;
	const oldMutationCompleted = new Promise<void>(resolve => { markOldMutationCompleted = resolve; });
	let pendingAmbiguous: {key: string; question: string; path: string} | undefined;
	let holdManualHistory = false;
	let releaseOldManual!: () => void;
	const oldManualGate = new Promise<void>(resolve => { releaseOldManual = resolve; });
	let markOldManualStarted!: () => void;
	const oldManualStarted = new Promise<void>(resolve => { markOldManualStarted = resolve; });
	let markOldManualCompleted!: () => void;
	const oldManualCompleted = new Promise<void>(resolve => { markOldManualCompleted = resolve; });

	await page.route(`**${chatApiPath}`, async route => {
		if (route.request().method() === 'GET' && holdManualHistory) {
			holdManualHistory = false;
			const response = await route.fetch();
			const body = await response.body();
			markOldManualStarted();
			await oldManualGate;
			try {
				await route.fulfill({response, body});
			} catch {
				// The old component aborts this request during unmount.
			}
			markOldManualCompleted();
			return;
		}
		if (route.request().method() === 'POST') {
			if (postMode === 'hold-accepted') {
				postMode = 'pass';
				const response = await route.fetch();
				markOldMutationAccepted();
				await oldMutationGate;
				try {
					await route.fulfill({response});
				} catch {
					// The old component aborts this request during unmount.
				}
				markOldMutationCompleted();
				return;
			}
			if (postMode === 'ambiguous') {
				postMode = 'pass';
				pendingAmbiguous = {
					key: route.request().headers()['idempotency-key'] || '',
					question: (route.request().postDataJSON() as {question: string}).question,
					path: new URL(route.request().url()).pathname,
				};
				await route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({error: 'Synthetic delayed response'})});
				return;
			}
		}
		await route.continue();
	});

	await page.goto(`${origin}/episodes/${encodeURIComponent(runId)}`);
	let chat = page.locator('.episode-chat');
	await chat.getByRole('textbox', {name: 'Question'}).fill('Synthetic mutation callback A?');
	await chat.locator('button[type="submit"]').click();
	await oldMutationAccepted;
	await page.goto(`${origin}/settings`);
	await page.goto(`${origin}/episodes/${encodeURIComponent(runId)}`);
	chat = page.locator('.episode-chat');
	await expect(chat.getByRole('article').filter({hasText: 'Synthetic mutation callback A?'})).toContainText('Grounded answer', {timeout: 20_000});
	await expect(chat.getByRole('textbox', {name: 'Question'})).toBeEnabled();

	postMode = 'ambiguous';
	const manualQuestion = 'Synthetic stale manual response B?';
	await chat.getByRole('textbox', {name: 'Question'}).fill(manualQuestion);
	await chat.locator('button[type="submit"]').click();
	await expect(chat.getByRole('alert')).toContainText(/could not confirm whether this question was accepted/i);
	const manualIdentity = pendingAmbiguous!;
	holdManualHistory = true;
	await chat.getByRole('button', {name: 'Check question history again'}).click();
	await oldManualStarted;
	await page.goto(`${origin}/settings`);
	await page.goto(`${origin}/episodes/${encodeURIComponent(runId)}`);
	chat = page.locator('.episode-chat');
	const acceptedManual = await request.post(`${origin}${manualIdentity.path}`, {
		headers: {'Idempotency-Key': manualIdentity.key},
		data: {question: manualIdentity.question},
	});
	expect(acceptedManual.status()).toBe(202);
	await expect(chat.getByRole('article').filter({hasText: manualQuestion})).toContainText('Grounded answer', {timeout: 20_000});
	await expect(chat.getByRole('textbox', {name: 'Question'})).toBeEnabled();

	postMode = 'ambiguous';
	const newerQuestion = 'Synthetic newer unresolved action C?';
	await chat.getByRole('textbox', {name: 'Question'}).fill(newerQuestion);
	await chat.locator('button[type="submit"]').click();
	await expect(chat.getByRole('alert')).toContainText(/could not confirm whether this question was accepted/i);
	const newerRecord = await page.evaluate(() => Object.entries(localStorage).find(([key]) => key.includes('localcast:episode-chat:pending:v2:'))?.[1]);
	expect(newerRecord).toBeTruthy();

	releaseOldMutation();
	await oldMutationCompleted;
	releaseOldManual();
	await oldManualCompleted;
	await expect(chat.getByRole('alert')).toContainText(/could not confirm whether this question was accepted/i);
	await expect(chat.getByRole('alert')).toBeFocused();
	await expect(chat.getByRole('textbox', {name: 'Question'})).toBeDisabled();
	expect(await page.evaluate(() => Object.entries(localStorage).find(([key]) => key.includes('localcast:episode-chat:pending:v2:'))?.[1])).toBe(newerRecord);
	await expect(chat.getByRole('article').filter({hasText: newerQuestion})).toHaveCount(0);
});

test('development StrictMode rebinds restored uncertainty and fences the first epoch history response', async ({page, request}) => {
	test.setTimeout(90_000);
	const runId = await createCompletedSyntheticEpisode(request, 'strict-mode-replay');
	const strictOrigin = 'http://127.0.0.1:43189';
	const chatApiPath = `/api/briefing-runs/${encodeURIComponent(runId)}/chat-turns`;
	const idempotencyKey = 'strict-mode-restored-request';
	const question = 'Synthetic StrictMode restored question?';
	let firstHistory = true;
	let releaseFirstHistory!: () => void;
	const firstHistoryGate = new Promise<void>(resolve => { releaseFirstHistory = resolve; });
	let markFirstHistoryStarted!: () => void;
	const firstHistoryStarted = new Promise<void>(resolve => { markFirstHistoryStarted = resolve; });
	let firstHistoryCompleted = false;

	await page.addInitScript(({key, episodeId}) => {
		const createdAt = Date.now();
		localStorage.setItem(`localcast:episode-chat:pending:v2:${episodeId}`, JSON.stringify({
			version: 2,
			runId: episodeId,
			kind: 'submission',
			idempotencyKey: key,
			generationId: 'strict-mode-generation-0001',
			ownerId: 'strict-mode-owner-0001',
			createdAt,
			reconcileUntil: createdAt + 10_000,
		}));
	}, {key: idempotencyKey, episodeId: runId});
	await page.route(`**${chatApiPath}`, async route => {
		if (route.request().method() === 'GET' && firstHistory) {
			firstHistory = false;
			const response = await route.fetch();
			const body = await response.body();
			markFirstHistoryStarted();
			await firstHistoryGate;
			try {
				await route.fulfill({response, body});
			} catch {
				// StrictMode cleanup may abort the first effect lifetime's request.
			}
			firstHistoryCompleted = true;
			return;
		}
		await route.continue();
	});

	await page.goto(`${strictOrigin}/episodes/${encodeURIComponent(runId)}`);
	await firstHistoryStarted;
	const chat = page.locator('.episode-chat');
	await expect(chat.getByRole('alert')).toContainText(/reconciling a shared question request|could not confirm/i);
	await expect(chat.getByRole('textbox', {name: 'Question'})).toBeDisabled();
	const accepted = await request.post(`${origin}${chatApiPath}`, {
		headers: {'Idempotency-Key': idempotencyKey},
		data: {question},
	});
	expect(accepted.status()).toBe(202);
	await chat.getByRole('button', {name: 'Check question history again'}).click();
	const acceptedArticle = chat.getByRole('article').filter({hasText: question});
	await expect(acceptedArticle).toContainText('Grounded answer', {timeout: 20_000});
	await expect(chat.getByRole('alert')).toHaveCount(0);
	await expect(chat.getByRole('textbox', {name: 'Question'})).toBeEnabled();

	releaseFirstHistory();
	await expect.poll(() => firstHistoryCompleted).toBe(true);
	await expect(acceptedArticle).toContainText('Grounded answer');
	await expect(chat.getByRole('alert')).toHaveCount(0);
	await expect(chat.getByRole('textbox', {name: 'Question'})).toBeEnabled();
	expect(await page.evaluate(episodeId => localStorage.getItem(`localcast:episode-chat:pending:v2:${episodeId}`), runId)).toBeNull();
});
