import {createServer, type Server} from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import express from 'express';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {applyMigrations} from '../../server/database/migrations';
import {OpenAiChatProcessor, type ChatProcessor, type EpisodeChatProvider} from '../../server/jobs/chatProcessor';
import {ChatWorker} from '../../server/jobs/chatWorker';
import {GenerationError} from '../../server/jobs/types';
import {OpenAiTextProvider} from '../../server/providers/openai';
import {createChatRouter} from '../../server/routes/chat';
import {ProviderCheckStore} from '../../server/services/providerCheckStore';
import {
	ChatEpisodeNotFoundError,
	ChatEpisodeUnavailableError,
	ChatIdempotencyConflictError,
	ChatProviderUnavailableError,
	ChatStateError,
	ChatStore,
	ChatTurnInProgressError,
	enterReservedChatProviderStage,
} from '../../server/services/chatStore';
import {
	approvedChatModel,
	type ChatProviderCallAudit,
	type ChatProviderCallFinalOutcome,
	type ChatProviderCallStage,
} from '../../server/chat/types';
import {createTestDatabase, testConfig} from '../helpers/database';
import {insertGroundedEpisode} from '../helpers/chat';

const databases: Database.Database[] = [];
const roots: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
		server.close(error => error ? reject(error) : resolve());
	})));
	while (databases.length > 0) databases.pop()?.close();
	while (roots.length > 0) fs.rmSync(roots.pop()!, {recursive: true, force: true});
});

const trackedDatabase = (): Database.Database => {
	const database = createTestDatabase();
	databases.push(database);
	return database;
};

const chatWorkCounts = (database: Database.Database, runId: string) => ({
	turns: (database.prepare('SELECT COUNT(*) AS count FROM chat_turns WHERE run_id = ?').get(runId) as {count: number}).count,
	attempts: (database.prepare(`
		SELECT COUNT(*) AS count FROM chat_attempts
		JOIN chat_turns ON chat_turns.id = chat_attempts.turn_id
		WHERE chat_turns.run_id = ?
	`).get(runId) as {count: number}).count,
	providerCalls: (database.prepare(`
		SELECT COUNT(*) AS count FROM chat_provider_calls
		JOIN chat_turns ON chat_turns.id = chat_provider_calls.turn_id
		WHERE chat_turns.run_id = ?
	`).get(runId) as {count: number}).count,
	retryRequests: (database.prepare(`
		SELECT COUNT(*) AS count FROM chat_retry_requests
		JOIN chat_turns ON chat_turns.id = chat_retry_requests.turn_id
		WHERE chat_turns.run_id = ?
	`).get(runId) as {count: number}).count,
});

const expectDistinctInitialBlocked = (
	chats: ChatStore,
	database: Database.Database,
	runId: string,
	idempotencyKey: string,
): void => {
	const before = chatWorkCounts(database, runId);
	expect(() => chats.enqueue(runId, 'Distinct synthetic question must remain blocked?', idempotencyKey)).toThrow(ChatTurnInProgressError);
	expect(chatWorkCounts(database, runId)).toEqual(before);
	expect(chats.listByRun(runId).some(turn => turn.submissionId === idempotencyKey)).toBe(false);
};

const finalizeSyntheticStage = (
	chats: ChatStore,
	turnId: string,
	workerId: string,
	stage: ChatProviderCallStage,
	outcome: ChatProviderCallFinalOutcome,
	audit: Partial<ChatProviderCallAudit> = {},
) => {
	const reservation = chats.reserveProviderCall(turnId, workerId, stage, approvedChatModel);
	const lifecycle = enterReservedChatProviderStage(reservation, {
		runId: chats.get(turnId)!.runId,
		turnId,
		attemptNumber: chats.get(turnId)!.attemptCount,
		workerId,
	}, stage, approvedChatModel);
	lifecycle.record({
		kind: 'response',
		audit: {stage, model: approvedChatModel, ...audit},
	});
	lifecycle.record({kind: 'finalize', stage, outcome});
	return reservation;
};

const supportedProcessor = (chats: ChatStore, calls = vi.fn()): ChatProcessor => ({
	process: async (turn, workerId) => {
		calls(turn.id);
		const context = chats.loadGroundingContext(turn.id);
		const factual = context.transcript.find(segment => segment.kind === 'factual')!;
		finalizeSyntheticStage(chats, turn.id, workerId, 'draft', 'draft_answer_validated');
		finalizeSyntheticStage(chats, turn.id, workerId, 'support', 'support_validated');
		chats.completeAnswer(turn.id, workerId, [{
			id: 'provider-id-must-not-be-trusted',
			text: factual.text,
			citations: [factual.citations[0]!],
			supportStatus: 'supported',
		}]);
	},
});

const outputPayload = (value: unknown) => ({
	status: 'completed',
	output: [{type: 'message', content: [{type: 'output_text', text: JSON.stringify(value)}]}],
	usage: {input_tokens: 10, output_tokens: 5, total_tokens: 15},
});

const startRouter = async (database: Database.Database, isTextProviderConfigured: () => boolean = () => true): Promise<string> => {
	const app = express();
	app.use(express.json({limit: '16kb'}));
	const chats = new ChatStore(database);
	app.use('/api', createChatRouter({
		chats,
		isTextProviderConfigured,
	}));
	const server = createServer(app);
	servers.push(server);
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('Synthetic chat test server did not bind');
	return `http://127.0.0.1:${address.port}/api`;
};

describe('episode-grounded chat workflow', () => {
	it('accepts questions only for existing completed grounded episodes', () => {
		const database = trackedDatabase();
		const chats = new ChatStore(database, () => '2026-08-07T12:01:00.000Z', () => 'turn-id');
		const complete = insertGroundedEpisode(database);
		insertGroundedEpisode(database, {runId: 'run-queued', status: 'queued'});
		insertGroundedEpisode(database, {runId: 'run-failed', status: 'failed'});
		insertGroundedEpisode(database, {runId: 'run-legacy', scriptFormatVersion: null});
		const corrupt = insertGroundedEpisode(database, {runId: 'run-corrupt'});
		database.prepare('UPDATE episode_citations SET excerpt = ? WHERE claim_id = ?').run('Synthetic excerpt absent from its snapshot.', corrupt.claimId);

		expect(chats.enqueue(complete.runId, 'What does the synthetic episode establish?', 'chat-request-0001').turn).toMatchObject({state: 'queued'});
		expect(() => chats.enqueue('run-missing', 'Question?', 'chat-request-0002')).toThrow(ChatEpisodeNotFoundError);
		expect(() => chats.enqueue('run-queued', 'Question?', 'chat-request-0003')).toThrow(ChatEpisodeUnavailableError);
		expect(() => chats.enqueue('run-failed', 'Question?', 'chat-request-0004')).toThrow(ChatEpisodeUnavailableError);
		expect(() => chats.enqueue('run-legacy', 'Question?', 'chat-request-0005')).toThrow(ChatEpisodeUnavailableError);
		expect(() => chats.enqueue('run-corrupt', 'Question?', 'chat-request-corrupt')).toThrow(ChatEpisodeUnavailableError);

		database.prepare('DELETE FROM briefing_runs WHERE id = ?').run(complete.runId);
		expect(chats.listByRun(complete.runId)).toEqual([]);
		expect(() => chats.enqueue(complete.runId, 'Question?', 'chat-request-0006')).toThrow(ChatEpisodeNotFoundError);
	});

	it('builds the actual provider request only from immutable server snapshots after original-source deletion', async () => {
		const database = trackedDatabase();
		database.prepare(`
			INSERT INTO notes (id, revision, title, body, created_at, updated_at)
			VALUES ('note-synthetic', 1, 'Mutable original', 'Original mutable body', ?, ?)
		`).run('2026-08-07T12:00:00.000Z', '2026-08-07T12:00:00.000Z');
		const episode = insertGroundedEpisode(database);
		let id = 0;
		const chats = new ChatStore(database, () => '2026-08-07T12:01:00.000Z', () => `immutable-turn-${++id}`);
		const turn = chats.enqueue(episode.runId, 'Use only the frozen synthetic facts.', 'chat-context-0001').turn;
		const before = chats.loadGroundingContext(turn.id);

		database.prepare("UPDATE notes SET body = 'Mutated original body' WHERE id = 'note-synthetic'").run();
		database.prepare("DELETE FROM notes WHERE id = 'note-synthetic'").run();
		const after = chats.loadGroundingContext(turn.id);

		expect(after).toEqual(before);
		expect(after.question).toBe('Use only the frozen synthetic facts.');
		expect(after.evidence[0]).toMatchObject({id: episode.snapshotId, body: episode.excerpt});

		const providerBodies: Record<string, unknown>[] = [];
		const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
			const stage = providerBodies.length === 0 ? 'draft' : 'support';
			expect(database.prepare(`
				SELECT status, safe_outcome FROM chat_provider_calls
				WHERE turn_id = ? AND attempt_number = 1 AND stage = ?
			`).get(turn.id, stage)).toEqual({status: 'reserved', safe_outcome: null});
			providerBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
			const result = providerBodies.length === 1
				? {
					kind: 'answer',
					claims: [{text: episode.excerpt, citations: [{snapshotId: episode.snapshotId, excerpt: episode.excerpt}]}],
					reason: 'not_applicable',
				}
				: {results: [{claimId: `chat-claim-${turn.id}-0`, status: 'supported'}]};
			return new Response(JSON.stringify(outputPayload(result)), {
				status: 200,
				headers: {'content-type': 'application/json'},
			});
		});
		const config = testConfig({
			textProvider: 'openai',
			speechProvider: 'openai',
			allowFakeProviders: false,
			openAiApiKey: 'synthetic-test-credential',
			workerId: 'immutable-context-worker',
		});
		const provider = new OpenAiTextProvider('synthetic-test-credential', config.openAiTextModel, {
			fetchImpl,
			baseUrl: 'http://provider.test/v1',
			allowTestBaseUrl: true,
		});
		const providerChecks = new ProviderCheckStore(database, () => '2026-08-07T12:00:30.000Z');
		providerChecks.recordLive('text', config);
		const generationProviderStatusBefore = database.prepare("SELECT * FROM provider_checks WHERE capability = 'text'").get();
		const processor = new OpenAiChatProcessor(config, chats, 'synthetic-test-credential', provider);

		await new ChatWorker(config, chats, processor).runOnce();
		expect(fetchImpl).toHaveBeenCalledTimes(2);
		const input = providerBodies[0]!.input as Array<{role: string; content: string}>;
		const supplied = JSON.parse(input[1]!.content) as Record<string, unknown>;
		expect(JSON.stringify(supplied)).toContain(episode.excerpt);
		expect(JSON.stringify(supplied)).not.toContain('Original mutable body');
		expect(JSON.stringify(supplied)).not.toContain('Mutated original body');
		expect(JSON.stringify(providerBodies[1])).toContain(episode.excerpt);
		const completedTurn = chats.get(turn.id)!;
		expect({
			state: completedTurn.state,
			answerKind: completedTurn.answerKind,
			errorCode: completedTurn.errorCode,
		}).toEqual({state: 'answered', answerKind: 'answer', errorCode: undefined});
		expect(database.prepare("SELECT * FROM provider_checks WHERE capability = 'text'").get()).toEqual(generationProviderStatusBefore);
		expect(database.prepare(`
			SELECT stage, model, status, safe_outcome, input_tokens, cached_input_tokens,
				output_tokens, reasoning_output_tokens, provider_request_id
			FROM chat_provider_calls WHERE turn_id = ? ORDER BY stage
		`).all(turn.id)).toEqual([
			{
				stage: 'draft', model: approvedChatModel, status: 'finalized', safe_outcome: 'draft_answer_validated',
				input_tokens: 10, cached_input_tokens: null, output_tokens: 5, reasoning_output_tokens: null, provider_request_id: null,
			},
			{
				stage: 'support', model: approvedChatModel, status: 'finalized', safe_outcome: 'support_validated',
				input_tokens: 10, cached_input_tokens: null, output_tokens: 5, reasoning_output_tokens: null, provider_request_id: null,
			},
		]);
	});

	it('commits each durable stage reservation before entering the draft or support adapter', async () => {
		const database = trackedDatabase();
		const episode = insertGroundedEpisode(database);
		let id = 0;
		const chats = new ChatStore(database, () => '2026-08-07T12:01:00.000Z', () => `adapter-entry-${++id}`);
		const turn = chats.enqueue(episode.runId, 'What does the synthetic episode establish?', 'adapter-entry-request').turn;
		const stageEntries: string[] = [];
		const answerClaims = [{
			id: `chat-claim-${turn.id}-0`,
			text: episode.excerpt,
			citations: [{snapshotId: episode.snapshotId, excerpt: episode.excerpt}],
		}];
		const provider: EpisodeChatProvider = {
			draftEpisodeQuestion: vi.fn(async (_context, identity, draftReservation) => {
				stageEntries.push('draft');
				expect(draftReservation).toMatchObject({...identity, stage: 'draft', model: approvedChatModel});
				expect(database.prepare(`
					SELECT status, worker_id FROM chat_provider_calls WHERE id = ?
				`).get(draftReservation.id)).toEqual({status: 'reserved', worker_id: identity.workerId});
				const draftLifecycle = enterReservedChatProviderStage(draftReservation, identity, 'draft', approvedChatModel);
				draftLifecycle.record({kind: 'response', audit: {stage: 'draft', model: approvedChatModel}});
				draftLifecycle.record({kind: 'finalize', stage: 'draft', outcome: 'draft_answer_validated'});
				return {result: {kind: 'answer' as const, claims: answerClaims}, usage: {}};
			}),
			validateEpisodeQuestionSupport: vi.fn(async (claims, identity, supportReservation) => {
				stageEntries.push('support');
				expect(supportReservation).toMatchObject({...identity, stage: 'support', model: approvedChatModel});
				expect(database.prepare(`
					SELECT status, worker_id FROM chat_provider_calls WHERE id = ?
				`).get(supportReservation.id)).toEqual({status: 'reserved', worker_id: identity.workerId});
				const supportLifecycle = enterReservedChatProviderStage(supportReservation, identity, 'support', approvedChatModel);
				supportLifecycle.record({kind: 'response', audit: {stage: 'support', model: approvedChatModel}});
				supportLifecycle.record({kind: 'finalize', stage: 'support', outcome: 'support_validated'});
				return {claims: claims.map(claim => ({...claim, supportStatus: 'supported' as const})), usage: {}};
			}),
		};
		const config = testConfig({
			textProvider: 'openai', speechProvider: 'openai', allowFakeProviders: false,
			openAiApiKey: 'synthetic-test-credential', workerId: 'adapter-entry-worker',
		});

		await new ChatWorker(config, chats, new OpenAiChatProcessor(config, chats, 'synthetic-test-credential', provider)).runOnce();
		expect(stageEntries).toEqual(['draft', 'support']);
		expect(chats.get(turn.id)).toMatchObject({state: 'answered', attemptCount: 1});
	});

	it('persists the completed draft call and never replays automatically when semantic support times out', async () => {
		const database = trackedDatabase();
		const episode = insertGroundedEpisode(database);
		let id = 0;
		const chats = new ChatStore(database, () => '2026-08-07T12:01:00.000Z', () => `support-timeout-${++id}`);
		const turn = chats.enqueue(episode.runId, 'What does the synthetic episode establish?', 'chat-support-timeout').turn;
		const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
			if (fetchImpl.mock.calls.length === 1) return new Response(JSON.stringify(outputPayload({
				kind: 'answer',
				claims: [{text: episode.excerpt, citations: [{snapshotId: episode.snapshotId, excerpt: episode.excerpt}]}],
				reason: 'not_applicable',
			})), {status: 200, headers: {'content-type': 'application/json'}});
			return new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {once: true});
			});
		});
		const config = testConfig({
			textProvider: 'openai',
			speechProvider: 'openai',
			allowFakeProviders: false,
			openAiApiKey: 'synthetic-test-credential',
			workerId: 'support-timeout-worker',
		});
		const provider = new OpenAiTextProvider('synthetic-test-credential', config.openAiTextModel, {
			fetchImpl,
			baseUrl: 'http://provider.test/v1',
			allowTestBaseUrl: true,
			timeoutMs: 10,
		});
		const processor = new OpenAiChatProcessor(config, chats, 'synthetic-test-credential', provider);
		const worker = new ChatWorker(config, chats, processor);

		await worker.runOnce();
		expect(fetchImpl).toHaveBeenCalledTimes(2);
		expect(chats.get(turn.id)).toMatchObject({
			state: 'failed',
			attemptCount: 1,
			errorCode: 'CHAT_PROVIDER_OUTCOME_UNCONFIRMED',
			retryable: false,
		});
		expect(database.prepare(`
			SELECT stage, status, safe_outcome FROM chat_provider_calls
			WHERE turn_id = ? ORDER BY stage
		`).all(turn.id)).toEqual([
			{stage: 'draft', status: 'finalized', safe_outcome: 'draft_answer_validated'},
			{stage: 'support', status: 'ambiguous', safe_outcome: 'timeout'},
		]);
		expect(() => chats.retry(turn.id, 'support-timeout-retry')).toThrow(ChatStateError);
		await expect(worker.runOnce()).resolves.toBe(false);
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it('reserves each provider stage once and makes every ambiguous outcome non-retryable', () => {
		const database = trackedDatabase();
		const episode = insertGroundedEpisode(database);
		let nowMs = Date.parse('2026-08-07T12:00:00.000Z');
		let id = 0;
		const chats = new ChatStore(database, () => new Date(nowMs).toISOString(), () => `lifecycle-${++id}`);
		const turn = chats.enqueue(episode.runId, 'Synthetic ambiguous provider call?', 'chat-lifecycle-0001').turn;
		chats.claimNext('lifecycle-worker', 10_000);

		expect(() => chats.reserveProviderCall(turn.id, 'lifecycle-worker', 'support', approvedChatModel)).toThrow(ChatStateError);
		const reservation = chats.reserveProviderCall(turn.id, 'lifecycle-worker', 'draft', approvedChatModel);
		expect(database.prepare(`
			SELECT status, safe_outcome FROM chat_provider_calls WHERE turn_id = ? AND stage = 'draft'
		`).get(turn.id)).toEqual({status: 'reserved', safe_outcome: null});
		expect(() => chats.reserveProviderCall(turn.id, 'lifecycle-worker', 'draft', approvedChatModel)).toThrow(ChatStateError);
		const lifecycle = enterReservedChatProviderStage(reservation, {
			runId: turn.runId, turnId: turn.id, attemptNumber: 1, workerId: 'lifecycle-worker',
		}, 'draft', approvedChatModel);
		lifecycle.record({kind: 'ambiguous', stage: 'draft', outcome: 'network_failure'});
		chats.fail(turn.id, 'lifecycle-worker', {code: 'OPENAI_NETWORK_FAILURE', message: 'Synthetic network failure', retryable: true});

		expect(chats.get(turn.id)).toMatchObject({
			state: 'failed', errorCode: 'CHAT_PROVIDER_OUTCOME_UNCONFIRMED', retryable: false,
		});
		expect(() => chats.retry(turn.id, 'chat-lifecycle-retry')).toThrow(ChatStateError);
		expect(database.prepare(`
			SELECT status, safe_outcome FROM chat_provider_calls WHERE turn_id = ?
		`).get(turn.id)).toEqual({status: 'ambiguous', safe_outcome: 'network_failure'});
		expect(database.prepare('SELECT episode_lock FROM chat_turns WHERE id = ?').get(turn.id)).toEqual({episode_lock: 1});
		expect(() => chats.enqueue(episode.runId, 'Blocked by ambiguous provider work?', 'chat-lifecycle-blocked')).toThrow(ChatTurnInProgressError);

		const staleEpisode = insertGroundedEpisode(database, {runId: 'run-lifecycle-stale'});
		const stale = chats.enqueue(staleEpisode.runId, 'Synthetic stale reservation?', 'chat-lifecycle-0002').turn;
		chats.claimNext('stale-worker', 1_000);
		const staleReservation = chats.reserveProviderCall(stale.id, 'stale-worker', 'draft', approvedChatModel);
		const staleLifecycle = enterReservedChatProviderStage(staleReservation, {
			runId: stale.runId, turnId: stale.id, attemptNumber: 1, workerId: 'stale-worker',
		}, 'draft', approvedChatModel);
		nowMs += 2_000;
		expect(() => staleLifecycle.record({
			kind: 'response', audit: {stage: 'draft', model: approvedChatModel},
		})).toThrow(ChatStateError);
		expect(() => chats.completeRefusal(stale.id, 'stale-worker')).toThrow(ChatStateError);
		expect(chats.recoverStale()).toBe(1);
		expect(chats.get(stale.id)).toMatchObject({
			state: 'failed', errorCode: 'CHAT_PROVIDER_OUTCOME_UNCONFIRMED', retryable: false,
		});
		expect(() => chats.enqueue(staleEpisode.runId, 'Blocked by stale reserved work?', 'chat-lifecycle-stale-blocked')).toThrow(ChatTurnInProgressError);

		const beforeDispatchEpisode = insertGroundedEpisode(database, {runId: 'run-lifecycle-before-dispatch'});
		const beforeDispatch = chats.enqueue(beforeDispatchEpisode.runId, 'Synthetic pre-dispatch recovery?', 'chat-lifecycle-0003').turn;
		chats.claimNext('pre-dispatch-worker', 1_000);
		nowMs += 2_000;
		expect(chats.recoverStale()).toBe(1);
		expect(chats.get(beforeDispatch.id)).toMatchObject({
			state: 'failed', errorCode: 'CHAT_ATTEMPT_OUTCOME_UNKNOWN', retryable: true,
		});
		expect(database.prepare('SELECT episode_lock FROM chat_turns WHERE id = ?').get(beforeDispatch.id)).toEqual({episode_lock: 0});
		expect(chats.enqueue(beforeDispatchEpisode.runId, 'Allowed after proven pre-provider failure?', 'chat-lifecycle-0004')).toMatchObject({created: true});
	});

	it('requires exact finalized lifecycle outcomes for answer and refusal publication', () => {
		const createClaimed = (suffix: string) => {
			const database = trackedDatabase();
			const episode = insertGroundedEpisode(database, {runId: `run-publication-${suffix}`});
			let id = 0;
			const chats = new ChatStore(database, () => '2026-08-07T12:01:00.000Z', () => `publication-${suffix}-${++id}`);
			const turn = chats.enqueue(episode.runId, `Synthetic publication ${suffix}?`, `publication-request-${suffix}`).turn;
			const workerId = `publication-worker-${suffix}`;
			chats.claimNext(workerId, 60_000);
			const claims = [{
				id: 'ignored', text: episode.excerpt,
				citations: [{snapshotId: episode.snapshotId, excerpt: episode.excerpt}],
				supportStatus: 'supported' as const,
			}];
			return {chats, turn, workerId, claims};
		};

		const zero = createClaimed('zero');
		expect(() => zero.chats.completeAnswer(zero.turn.id, zero.workerId, zero.claims)).toThrow(ChatStateError);
		expect(() => zero.chats.completeRefusal(zero.turn.id, zero.workerId)).toThrow(ChatStateError);

		const draftOnly = createClaimed('draft-only');
		finalizeSyntheticStage(draftOnly.chats, draftOnly.turn.id, draftOnly.workerId, 'draft', 'draft_answer_validated');
		expect(() => draftOnly.chats.completeAnswer(draftOnly.turn.id, draftOnly.workerId, draftOnly.claims)).toThrow(ChatStateError);
		expect(() => draftOnly.chats.completeRefusal(draftOnly.turn.id, draftOnly.workerId)).toThrow(ChatStateError);

		const reserved = createClaimed('reserved');
		reserved.chats.reserveProviderCall(reserved.turn.id, reserved.workerId, 'draft', approvedChatModel);
		expect(() => reserved.chats.completeRefusal(reserved.turn.id, reserved.workerId)).toThrow(ChatStateError);

		const received = createClaimed('received');
		const receivedReservation = received.chats.reserveProviderCall(received.turn.id, received.workerId, 'draft', approvedChatModel);
		enterReservedChatProviderStage(receivedReservation, {
			runId: received.turn.runId, turnId: received.turn.id, attemptNumber: 1, workerId: received.workerId,
		}, 'draft', approvedChatModel).record({kind: 'response', audit: {stage: 'draft', model: approvedChatModel}});
		expect(() => received.chats.completeRefusal(received.turn.id, received.workerId)).toThrow(ChatStateError);

		const ambiguous = createClaimed('ambiguous');
		const ambiguousReservation = ambiguous.chats.reserveProviderCall(ambiguous.turn.id, ambiguous.workerId, 'draft', approvedChatModel);
		enterReservedChatProviderStage(ambiguousReservation, {
			runId: ambiguous.turn.runId, turnId: ambiguous.turn.id, attemptNumber: 1, workerId: ambiguous.workerId,
		}, 'draft', approvedChatModel).record({kind: 'ambiguous', stage: 'draft', outcome: 'network_failure'});
		expect(() => ambiguous.chats.completeRefusal(ambiguous.turn.id, ambiguous.workerId)).toThrow(ChatStateError);

		const refusal = createClaimed('refusal');
		finalizeSyntheticStage(refusal.chats, refusal.turn.id, refusal.workerId, 'draft', 'draft_refusal');
		expect(() => refusal.chats.completeAnswer(refusal.turn.id, refusal.workerId, refusal.claims)).toThrow(ChatStateError);
		expect(refusal.chats.completeRefusal(refusal.turn.id, refusal.workerId)).toMatchObject({state: 'refused'});

		const rejectedSupport = createClaimed('support-rejected');
		finalizeSyntheticStage(rejectedSupport.chats, rejectedSupport.turn.id, rejectedSupport.workerId, 'draft', 'draft_answer_validated');
		finalizeSyntheticStage(rejectedSupport.chats, rejectedSupport.turn.id, rejectedSupport.workerId, 'support', 'support_rejected');
		expect(() => rejectedSupport.chats.completeAnswer(rejectedSupport.turn.id, rejectedSupport.workerId, rejectedSupport.claims)).toThrow(ChatStateError);
		expect(() => rejectedSupport.chats.completeRefusal(rejectedSupport.turn.id, rejectedSupport.workerId)).toThrow(ChatStateError);

		const answer = createClaimed('answer');
		finalizeSyntheticStage(answer.chats, answer.turn.id, answer.workerId, 'draft', 'draft_answer_validated');
		finalizeSyntheticStage(answer.chats, answer.turn.id, answer.workerId, 'support', 'support_validated');
		expect(answer.chats.completeAnswer(answer.turn.id, answer.workerId, answer.claims)).toMatchObject({state: 'answered'});
	});

	it('allows one explicit retry after a definitive provider rejection and finalizes malformed envelopes safely', async () => {
		const database = trackedDatabase();
		const episode = insertGroundedEpisode(database);
		let id = 0;
		const chats = new ChatStore(database, () => '2026-08-07T12:01:00.000Z', () => `definitive-${++id}`);
		const config = testConfig({
			textProvider: 'openai', speechProvider: 'openai', allowFakeProviders: false,
			openAiApiKey: 'synthetic-test-credential', workerId: 'definitive-worker',
		});

		const rejected = chats.enqueue(episode.runId, 'Synthetic definitive rejection?', 'chat-definitive-0001').turn;
		const rejectedFetch = vi.fn<typeof fetch>(async () => new Response(null, {status: 503}));
		const rejectedProvider = new OpenAiTextProvider('synthetic-test-credential', config.openAiTextModel, {
			fetchImpl: rejectedFetch, baseUrl: 'http://provider.test/v1', allowTestBaseUrl: true,
		});
		await new ChatWorker(config, chats, new OpenAiChatProcessor(config, chats, 'synthetic-test-credential', rejectedProvider)).runOnce();
		expect(rejectedFetch).toHaveBeenCalledTimes(1);
		expect(chats.get(rejected.id)).toMatchObject({state: 'failed', errorCode: 'OPENAI_SERVICE_UNAVAILABLE', retryable: true});
		expect(database.prepare(`
			SELECT status, safe_outcome FROM chat_provider_calls WHERE turn_id = ?
		`).get(rejected.id)).toEqual({status: 'finalized', safe_outcome: 'provider_rejected'});
		expect(database.prepare('SELECT episode_lock FROM chat_turns WHERE id = ?').get(rejected.id)).toEqual({episode_lock: 1});
		expect(chats.enqueue(episode.runId, 'Synthetic definitive rejection?', 'chat-definitive-0001')).toMatchObject({
			created: false,
			turn: {id: rejected.id},
		});
		expectDistinctInitialBlocked(chats, database, episode.runId, 'chat-definitive-blocked');
		expect(chats.retry(rejected.id, 'chat-definitive-retry')).toMatchObject({
			state: 'queued', acceptedRetry: {idempotencyKey: 'chat-definitive-retry', attemptNumber: 2},
		});
		await new ChatWorker({...config, workerId: 'definitive-retry-worker'}, chats, supportedProcessor(chats)).runOnce();
		expect(database.prepare('SELECT episode_lock FROM chat_turns WHERE id = ?').get(rejected.id)).toEqual({episode_lock: 0});

		const malformed = chats.enqueue(episode.runId, 'Synthetic malformed response?', 'chat-definitive-0002').turn;
		const malformedProvider = new OpenAiTextProvider('synthetic-test-credential', config.openAiTextModel, {
			fetchImpl: vi.fn<typeof fetch>(async () => new Response('null', {status: 200, headers: {'content-type': 'application/json'}})),
			baseUrl: 'http://provider.test/v1', allowTestBaseUrl: true,
		});
		await new ChatWorker(config, chats, new OpenAiChatProcessor(config, chats, 'synthetic-test-credential', malformedProvider)).runOnce();
		expect(chats.get(malformed.id)).toMatchObject({state: 'failed', errorCode: 'OPENAI_INVALID_RESPONSE', retryable: false});
		expect(database.prepare(`
			SELECT status, safe_outcome FROM chat_provider_calls WHERE turn_id = ?
		`).get(malformed.id)).toEqual({status: 'finalized', safe_outcome: 'invalid_response'});
		expect(database.prepare('SELECT episode_lock FROM chat_turns WHERE id = ?').get(malformed.id)).toEqual({episode_lock: 1});
		expectDistinctInitialBlocked(chats, database, episode.runId, 'chat-malformed-blocked');

		const citationEpisode = insertGroundedEpisode(database, {runId: 'run-invalid-chat-citation-lock'});
		const invalidCitation = chats.enqueue(
			citationEpisode.runId,
			'Synthetic invalid citation response?',
			'chat-invalid-citation-lock',
		).turn;
		const invalidCitationProvider = new OpenAiTextProvider('synthetic-test-credential', config.openAiTextModel, {
			fetchImpl: vi.fn<typeof fetch>(async () => new Response(JSON.stringify(outputPayload({
				kind: 'answer',
				claims: [{
					text: citationEpisode.excerpt,
					citations: [{snapshotId: 'snapshot-not-in-grounding', excerpt: citationEpisode.excerpt}],
				}],
				reason: 'not_applicable',
			})), {status: 200, headers: {'content-type': 'application/json'}})),
			baseUrl: 'http://provider.test/v1',
			allowTestBaseUrl: true,
		});
		await new ChatWorker(
			{...config, workerId: 'invalid-citation-worker'},
			chats,
			new OpenAiChatProcessor(config, chats, 'synthetic-test-credential', invalidCitationProvider),
		).runOnce();
		expect(chats.get(invalidCitation.id)).toMatchObject({
			state: 'failed', errorCode: 'CHAT_INVALID_CITATIONS', retryable: false,
		});
		expect(database.prepare(`
			SELECT status, safe_outcome FROM chat_provider_calls WHERE turn_id = ?
		`).get(invalidCitation.id)).toEqual({status: 'finalized', safe_outcome: 'invalid_citations'});
		expect(database.prepare('SELECT episode_lock FROM chat_turns WHERE id = ?').get(invalidCitation.id)).toEqual({episode_lock: 1});
		expectDistinctInitialBlocked(chats, database, citationEpisode.runId, 'chat-invalid-citation-blocked');
	});

	it('requires a fresh lease immediately before support-stage reservation', async () => {
		const database = trackedDatabase();
		const episode = insertGroundedEpisode(database);
		const baseNowMs = Date.parse('2026-08-07T12:00:00.000Z');
		let id = 0;
		const chats = new ChatStore(database, () => {
			const draftFinalized = database.prepare(`
				SELECT 1 FROM chat_provider_calls
				WHERE stage = 'draft' AND status = 'finalized'
			`).get();
			return new Date(baseNowMs + (draftFinalized ? 2_000 : 0)).toISOString();
		}, () => `support-lease-${++id}`);
		const turn = chats.enqueue(episode.runId, 'Synthetic support lease?', 'chat-support-lease').turn;
		const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(outputPayload({
			kind: 'answer',
			claims: [{text: episode.excerpt, citations: [{snapshotId: episode.snapshotId, excerpt: episode.excerpt}]}],
			reason: 'not_applicable',
		})), {status: 200, headers: {'content-type': 'application/json'}}));
		const config = testConfig({
			textProvider: 'openai', speechProvider: 'openai', allowFakeProviders: false,
			openAiApiKey: 'synthetic-test-credential', workerId: 'support-lease-worker', leaseMs: 1_000,
		});
		const provider = new OpenAiTextProvider('synthetic-test-credential', config.openAiTextModel, {
			fetchImpl, baseUrl: 'http://provider.test/v1', allowTestBaseUrl: true,
		});
		await new ChatWorker(config, chats, new OpenAiChatProcessor(config, chats, 'synthetic-test-credential', provider)).runOnce();
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(database.prepare(`
			SELECT stage, status, safe_outcome FROM chat_provider_calls WHERE turn_id = ?
		`).all(turn.id)).toEqual([{stage: 'draft', status: 'finalized', safe_outcome: 'draft_answer_validated'}]);
		expect(chats.recoverStale()).toBe(1);
		expect(chats.get(turn.id)).toMatchObject({state: 'failed', retryable: true, errorCode: 'CHAT_ATTEMPT_OUTCOME_UNKNOWN'});
		expect(database.prepare('SELECT episode_lock FROM chat_turns WHERE id = ?').get(turn.id)).toEqual({episode_lock: 1});
		expectDistinctInitialBlocked(chats, database, episode.runId, 'chat-support-lease-blocked');
		expect(chats.retry(turn.id, 'chat-support-lease-retry')).toMatchObject({state: 'queued'});
	});

	it('enforces two durable call slots per attempt and four across the two-attempt turn ceiling', () => {
		const database = trackedDatabase();
		const episode = insertGroundedEpisode(database);
		let id = 0;
		const chats = new ChatStore(database, () => '2026-08-07T12:01:00.000Z', () => `ceiling-${++id}`);
		const turn = chats.enqueue(episode.runId, 'Synthetic call ceiling?', 'chat-call-ceiling').turn;
		const finalizeTwoStages = (workerId: string) => {
			finalizeSyntheticStage(chats, turn.id, workerId, 'draft', 'draft_answer_validated');
			finalizeSyntheticStage(chats, turn.id, workerId, 'support', 'support_rejected');
			expect(() => chats.reserveProviderCall(turn.id, workerId, 'support', approvedChatModel)).toThrow(ChatStateError);
		};

		chats.claimNext('ceiling-worker-1', 10_000);
		finalizeTwoStages('ceiling-worker-1');
		chats.fail(turn.id, 'ceiling-worker-1', {code: 'SYNTHETIC_DEFINITIVE_FAILURE', message: 'Synthetic definitive failure', retryable: true});
		expect(database.prepare('SELECT episode_lock FROM chat_turns WHERE id = ?').get(turn.id)).toEqual({episode_lock: 1});
		expectDistinctInitialBlocked(chats, database, episode.runId, 'chat-call-ceiling-blocked');
		expect(chats.retry(turn.id, 'chat-call-ceiling-retry')).toMatchObject({state: 'queued'});
		chats.claimNext('ceiling-worker-2', 10_000);
		finalizeTwoStages('ceiling-worker-2');
		chats.fail(turn.id, 'ceiling-worker-2', {code: 'SYNTHETIC_DEFINITIVE_FAILURE', message: 'Synthetic definitive failure', retryable: true});

		expect((database.prepare('SELECT COUNT(*) AS count FROM chat_provider_calls WHERE turn_id = ?').get(turn.id) as {count: number}).count).toBe(4);
		expect(chats.get(turn.id)).toMatchObject({attemptCount: 2, retryable: false});
		expect(database.prepare('SELECT episode_lock FROM chat_turns WHERE id = ?').get(turn.id)).toEqual({episode_lock: 1});
		expectDistinctInitialBlocked(chats, database, episode.runId, 'chat-call-ceiling-final-blocked');
		expect(() => chats.retry(turn.id, 'chat-call-ceiling-third')).toThrow(ChatStateError);
	});

	it('retains a provider-used episode lock through interruption and queued failure recovery paths', () => {
		const createRetryQueued = (suffix: string) => {
			const database = trackedDatabase();
			const episode = insertGroundedEpisode(database, {runId: `run-lock-transition-${suffix}`});
			let id = 0;
			const chats = new ChatStore(database, () => '2026-08-07T12:01:00.000Z', () => `lock-transition-${suffix}-${++id}`);
			const turn = chats.enqueue(episode.runId, `Synthetic ${suffix} transition?`, `lock-transition-${suffix}`).turn;
			const workerId = `lock-transition-worker-${suffix}`;
			chats.claimNext(workerId, 60_000);
			finalizeSyntheticStage(chats, turn.id, workerId, 'draft', 'provider_rejected');
			chats.fail(turn.id, workerId, {
				code: 'SYNTHETIC_DEFINITIVE_FAILURE',
				message: 'Synthetic definitive failure',
				retryable: true,
			});
			expect(database.prepare('SELECT episode_lock FROM chat_turns WHERE id = ?').get(turn.id)).toEqual({episode_lock: 1});
			chats.retry(turn.id, `lock-transition-retry-${suffix}`);
			return {database, episode, chats, turn};
		};

		const interruptedDatabase = trackedDatabase();
		const interruptedEpisode = insertGroundedEpisode(interruptedDatabase, {runId: 'run-lock-transition-interrupted'});
		let interruptedId = 0;
		const interruptedChats = new ChatStore(
			interruptedDatabase,
			() => '2026-08-07T12:01:00.000Z',
			() => `lock-transition-interrupted-${++interruptedId}`,
		);
		const interrupted = interruptedChats.enqueue(
			interruptedEpisode.runId,
			'Synthetic interruption after provider response?',
			'lock-transition-interrupted',
		).turn;
		interruptedChats.claimNext('lock-transition-worker-interrupted', 60_000);
		finalizeSyntheticStage(
			interruptedChats,
			interrupted.id,
			'lock-transition-worker-interrupted',
			'draft',
			'provider_rejected',
		);
		interruptedChats.interrupt(interrupted.id, 'lock-transition-worker-interrupted');
		expect(interruptedDatabase.prepare('SELECT episode_lock FROM chat_turns WHERE id = ?').get(interrupted.id)).toEqual({episode_lock: 1});
		expectDistinctInitialBlocked(interruptedChats, interruptedDatabase, interruptedEpisode.runId, 'lock-transition-interrupted-blocked');
		expect(interruptedChats.retry(interrupted.id, 'lock-transition-interrupted-retry')).toMatchObject({state: 'queued'});

		const unavailable = createRetryQueued('unavailable');
		unavailable.database.prepare("UPDATE briefing_runs SET status = 'failed' WHERE id = ?").run(unavailable.episode.runId);
		expect(unavailable.chats.claimNext('lock-transition-unavailable-recovery', 60_000)).toBeUndefined();
		expect(unavailable.chats.get(unavailable.turn.id)).toMatchObject({state: 'failed', errorCode: 'EPISODE_NOT_AVAILABLE'});
		expect(unavailable.database.prepare('SELECT episode_lock FROM chat_turns WHERE id = ?').get(unavailable.turn.id)).toEqual({episode_lock: 1});
		expectDistinctInitialBlocked(unavailable.chats, unavailable.database, unavailable.episode.runId, 'lock-transition-unavailable-blocked');

		const exhausted = createRetryQueued('exhausted');
		exhausted.database.prepare('UPDATE chat_turns SET attempt_count = 2 WHERE id = ?').run(exhausted.turn.id);
		expect(exhausted.chats.claimNext('lock-transition-exhausted-recovery', 60_000)).toBeUndefined();
		expect(exhausted.chats.get(exhausted.turn.id)).toMatchObject({state: 'failed', errorCode: 'CHAT_ATTEMPT_LIMIT_REACHED'});
		expect(exhausted.database.prepare('SELECT episode_lock FROM chat_turns WHERE id = ?').get(exhausted.turn.id)).toEqual({episode_lock: 1});
		expectDistinctInitialBlocked(exhausted.chats, exhausted.database, exhausted.episode.runId, 'lock-transition-exhausted-blocked');
	});

	it('blocks private or unverified feed evidence before any external-provider request', async () => {
		const database = trackedDatabase();
		const episode = insertGroundedEpisode(database);
		database.prepare(`
			UPDATE episode_evidence_snapshots
			SET kind = 'feed', network_scope = 'private', source_name_snapshot = 'Synthetic private feed'
			WHERE id = ?
		`).run(episode.snapshotId);
		const chats = new ChatStore(database, () => '2026-08-07T12:01:00.000Z', () => 'private-turn');
		const turn = chats.enqueue(episode.runId, 'What does this private synthetic feed say?', 'chat-private-0001').turn;
		const fetchImpl = vi.fn<typeof fetch>();
		const config = testConfig({
			textProvider: 'openai',
			speechProvider: 'openai',
			allowFakeProviders: false,
			openAiApiKey: 'synthetic-test-credential',
			workerId: 'private-boundary-worker',
		});
		const provider = new OpenAiTextProvider('synthetic-test-credential', config.openAiTextModel, {
			fetchImpl,
			baseUrl: 'http://provider.test/v1',
			allowTestBaseUrl: true,
		});
		const processor = new OpenAiChatProcessor(config, chats, 'synthetic-test-credential', provider);

		await new ChatWorker(config, chats, processor).runOnce();
		expect(fetchImpl).not.toHaveBeenCalled();
		expect(chats.get(turn.id)).toMatchObject({
			state: 'failed',
			errorCode: 'CLOUD_PROCESSING_NOT_AUTHORIZED',
			retryable: false,
		});
	});

	it('enforces transactional idempotency, validated citations, refusal, failure, and explicit retry', async () => {
		const database = trackedDatabase();
		const episode = insertGroundedEpisode(database);
		let id = 0;
		let timestamp = Date.UTC(2026, 7, 7, 12, 0, 0);
		const chats = new ChatStore(database, () => new Date(timestamp += 100).toISOString(), () => `id-${++id}`);
		const first = chats.enqueue(episode.runId, 'What persists?', 'chat-idempotency-0001');
		const replay = chats.enqueue(episode.runId, 'What persists?', 'chat-idempotency-0001');
		expect(replay).toMatchObject({created: false, turn: {id: first.turn.id}});
		expect(() => chats.enqueue(episode.runId, 'A different question?', 'chat-idempotency-0001')).toThrow(ChatIdempotencyConflictError);

		const calls = vi.fn();
		const worker = new ChatWorker(testConfig({workerId: 'chat-worker'}), chats, supportedProcessor(chats, calls));
		await worker.runOnce();
		expect(calls).toHaveBeenCalledTimes(1);
		expect(chats.get(first.turn.id)).toMatchObject({
			state: 'answered',
			answerKind: 'answer',
			attemptCount: 1,
			claims: [{id: `chat-claim-${first.turn.id}-0`, citations: [{snapshotId: episode.snapshotId, excerpt: episode.excerpt}]}],
			attempts: [{attemptNumber: 1, outcome: 'answered'}],
		});

		const refusal = chats.enqueue(episode.runId, 'What is outside this episode?', 'chat-refusal-0001').turn;
		const refusalWorker = new ChatWorker(testConfig({workerId: 'refusal-worker'}), chats, {
			process: async (turn, workerId) => {
				finalizeSyntheticStage(chats, turn.id, workerId, 'draft', 'draft_refusal');
				chats.completeRefusal(turn.id, workerId);
			},
		});
		await refusalWorker.runOnce();
		expect(chats.get(refusal.id)).toMatchObject({state: 'refused', refusalCode: 'EVIDENCE_INSUFFICIENT', claims: []});

		const failed = chats.enqueue(episode.runId, 'Synthetic retry fixture', 'chat-failure-0001').turn;
		const failedWorker = new ChatWorker(testConfig({workerId: 'failure-worker'}), chats, {
			process: async () => { throw new GenerationError('SYNTHETIC_TIMEOUT', 'The synthetic text provider timed out', true); },
		});
		await failedWorker.runOnce();
		expect(chats.get(failed.id)).toMatchObject({state: 'failed', errorCode: 'SYNTHETIC_TIMEOUT', retryable: true, attemptCount: 1});
		expect(chats.retry(failed.id, 'chat-retry-0001')).toMatchObject({
			state: 'queued',
			acceptedRetry: {idempotencyKey: 'chat-retry-0001', attemptNumber: 2},
		});
		expect(chats.retry(failed.id, 'chat-retry-0001', false)).toMatchObject({
			state: 'queued',
			acceptedRetry: {idempotencyKey: 'chat-retry-0001', attemptNumber: 2},
		});
		expect(() => chats.retry(failed.id, 'chat-retry-concurrent')).toThrow(ChatStateError);
		await new ChatWorker(testConfig({workerId: 'retry-worker'}), chats, supportedProcessor(chats)).runOnce();
		expect(chats.get(failed.id)).toMatchObject({
			state: 'answered',
			attemptCount: 2,
			acceptedRetry: {idempotencyKey: 'chat-retry-0001', attemptNumber: 2},
			attempts: [{outcome: 'failed'}, {outcome: 'answered'}],
		});
		expect(chats.retry(failed.id, 'chat-retry-0001')).toMatchObject({state: 'answered', attemptCount: 2});
		expect(() => chats.retry(failed.id, 'chat-retry-third')).toThrow(ChatStateError);

		const unavailable = chats.enqueue(episode.runId, 'Provider unavailable retry?', 'chat-failure-0002').turn;
		await new ChatWorker(testConfig({workerId: 'unavailable-worker'}), chats, {
			process: async () => { throw new GenerationError('SYNTHETIC_TIMEOUT', 'The synthetic text provider timed out', true); },
		}).runOnce();
		expect(() => chats.retry(unavailable.id, 'chat-retry-unconfigured', false)).toThrow(ChatProviderUnavailableError);
		expect(chats.get(unavailable.id)).toMatchObject({state: 'failed', attemptCount: 1});

		const exhausted = chats.enqueue(episode.runId, 'Attempt cap fixture', 'chat-attempt-cap').turn;
		const providerCalls = vi.fn(async () => {
			throw new GenerationError('SYNTHETIC_TIMEOUT', 'The synthetic text provider timed out', true);
		});
		const exhaustedWorker = new ChatWorker(testConfig({workerId: 'attempt-cap-worker'}), chats, {process: providerCalls});
		await exhaustedWorker.runOnce();
		expect(chats.retry(exhausted.id, 'chat-attempt-cap-retry')).toMatchObject({state: 'queued'});
		await exhaustedWorker.runOnce();
		expect(chats.get(exhausted.id)).toMatchObject({state: 'failed', attemptCount: 2, retryable: false});
		expect(() => chats.retry(exhausted.id, 'chat-attempt-cap-third')).toThrow(ChatStateError);
		expect(providerCalls).toHaveBeenCalledTimes(2);
	});

	it('persists ordered history and retry state across database and worker restarts without replaying an unknown attempt', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localcast-chat-restart-'));
		roots.push(root);
		const databasePath = path.join(root, 'synthetic.sqlite');
		let database = new Database(databasePath);
		database.pragma('foreign_keys = ON');
		applyMigrations(database);
		const episode = insertGroundedEpisode(database);
		let id = 0;
		let timestamp = Date.parse('2026-08-07T12:00:00.000Z');
		let chats = new ChatStore(database, () => new Date(timestamp += 1_000).toISOString(), () => `restart-${++id}`);
		const answered = chats.enqueue(episode.runId, 'First persisted question?', 'chat-restart-0001').turn;
		const claim = chats.claimNext('worker-before-restart', 60_000)!;
		finalizeSyntheticStage(chats, claim.id, 'worker-before-restart', 'draft', 'draft_answer_validated', {
			inputTokens: 120, cachedInputTokens: 20, outputTokens: 30,
			reasoningOutputTokens: 5, providerRequestId: 'resp_restart_synthetic',
		});
		finalizeSyntheticStage(chats, claim.id, 'worker-before-restart', 'support', 'support_validated');
		chats.completeAnswer(claim.id, 'worker-before-restart', [{id: 'ignored', text: episode.excerpt, citations: [{snapshotId: episode.snapshotId, excerpt: episode.excerpt}], supportStatus: 'supported'}]);
		const interrupted = chats.enqueue(episode.runId, 'Second persisted question?', 'chat-restart-0002').turn;
		chats.claimNext('worker-that-stopped', 1_000);
		database.close();

		database = new Database(databasePath);
		database.pragma('foreign_keys = ON');
		chats = new ChatStore(database, () => new Date(timestamp += 2_000).toISOString(), () => `restart-${++id}`);
		expect(chats.recoverStale()).toBe(1);
		expect(chats.listByRun(episode.runId).map(turn => turn.id)).toEqual([answered.id, interrupted.id]);
		expect(chats.get(answered.id)).toMatchObject({state: 'answered', claims: [{text: episode.excerpt}]});
		expect(database.prepare(`
			SELECT stage, model, status, safe_outcome, input_tokens, cached_input_tokens,
				output_tokens, reasoning_output_tokens, provider_request_id
			FROM chat_provider_calls WHERE turn_id = ? ORDER BY stage
		`).all(answered.id)).toEqual([
			{
				stage: 'draft', model: approvedChatModel, status: 'finalized', safe_outcome: 'draft_answer_validated',
				input_tokens: 120, cached_input_tokens: 20, output_tokens: 30,
				reasoning_output_tokens: 5, provider_request_id: 'resp_restart_synthetic',
			},
			{
				stage: 'support', model: approvedChatModel, status: 'finalized', safe_outcome: 'support_validated',
				input_tokens: null, cached_input_tokens: null, output_tokens: null,
				reasoning_output_tokens: null, provider_request_id: null,
			},
		]);
		expect(chats.get(interrupted.id)).toMatchObject({state: 'failed', errorCode: 'CHAT_ATTEMPT_OUTCOME_UNKNOWN', retryable: true, attempts: [{outcome: 'recovered'}]});
		expect(chats.claimNext('automatic-restart', 1_000)).toBeUndefined();
		expect(chats.retry(interrupted.id, 'chat-restart-retry')).toMatchObject({
			state: 'queued',
			acceptedRetry: {idempotencyKey: 'chat-restart-retry', attemptNumber: 2},
		});
		database.close();

		database = new Database(databasePath);
		database.pragma('foreign_keys = ON');
		chats = new ChatStore(database, () => new Date(timestamp += 1_000).toISOString(), () => `restart-${++id}`);
		expect(chats.get(interrupted.id)).toMatchObject({
			state: 'queued',
			attemptCount: 1,
			acceptedRetry: {idempotencyKey: 'chat-restart-retry', attemptNumber: 2},
		});
		expect((database.prepare('SELECT COUNT(*) AS count FROM chat_retry_requests WHERE turn_id = ?').get(interrupted.id) as {count: number}).count).toBe(1);
		chats.claimNext('worker-second-ambiguous-attempt', 1_000);
		database.close();

		database = new Database(databasePath);
		database.pragma('foreign_keys = ON');
		chats = new ChatStore(database, () => new Date(timestamp += 2_000).toISOString(), () => `restart-${++id}`);
		expect(chats.recoverStale()).toBe(1);
		expect(chats.get(interrupted.id)).toMatchObject({
			state: 'failed',
			attemptCount: 2,
			retryable: false,
			attempts: [{outcome: 'recovered'}, {outcome: 'recovered'}],
		});
		expect(() => chats.retry(interrupted.id, 'chat-restart-third')).toThrow(ChatStateError);
		database.close();
	});

	it('uses the same Unicode code-point bounds for accepted retry identities in the store and SQLite', () => {
		const database = trackedDatabase();
		let id = 0;
		const chats = new ChatStore(database, () => '2026-08-07T12:01:00.000Z', () => `unicode-retry-${++id}`);
		const exercise = (suffix: string, key: string, accepted: boolean) => {
			const episode = insertGroundedEpisode(database, {runId: `run-unicode-retry-${suffix}`});
			const turn = chats.enqueue(episode.runId, 'Synthetic Unicode retry bound?', `unicode-initial-${suffix}`).turn;
			const workerId = `unicode-worker-${suffix}`;
			chats.claimNext(workerId, 60_000);
			chats.fail(turn.id, workerId, {code: 'SYNTHETIC_PRE_PROVIDER_FAILURE', message: 'Synthetic retryable failure', retryable: true});
			if (accepted) {
				expect(chats.retry(turn.id, key)).toMatchObject({
					state: 'queued',
					acceptedRetry: {idempotencyKey: key, attemptNumber: 2},
				});
				expect(database.prepare('SELECT idempotency_key FROM chat_retry_requests WHERE turn_id = ?').get(turn.id)).toEqual({idempotency_key: key});
				const claimed = chats.claimNext(`unicode-cleanup-${suffix}`, 60_000)!;
				chats.fail(claimed.id, `unicode-cleanup-${suffix}`, {code: 'SYNTHETIC_FINAL_FAILURE', message: 'Synthetic final failure', retryable: false});
			} else {
				expect(() => chats.retry(turn.id, key)).toThrow(ChatStateError);
			}
		};

		exercise('minimum', '😀'.repeat(8), true);
		exercise('maximum', '😀'.repeat(200), true);
		exercise('short', '😀'.repeat(7), false);
		exercise('long', '😀'.repeat(201), false);
		exercise('nul-start', `\0${'r'.repeat(8)}`, false);
		exercise('nul-middle', 'rrrr\0rrrr', false);
		exercise('nul-end', `${'r'.repeat(8)}\0`, false);
		exercise('high-surrogate', `${'r'.repeat(8)}\ud800`, false);
		exercise('low-surrogate', `${'r'.repeat(8)}\udc00`, false);
	});

	it('rejects malformed initial identities and questions before durable mutation', () => {
		const database = trackedDatabase();
		let id = 0;
		const chats = new ChatStore(database, () => '2026-08-07T12:01:00.000Z', () => `initial-text-${++id}`);
		const invalidIdentities = [
			'a'.repeat(7), 'a'.repeat(201), '😀'.repeat(7), '😀'.repeat(201),
			`\0${'a'.repeat(8)}`, `aaaa\0aaaa`, `${'a'.repeat(8)}\0`,
			`${'a'.repeat(8)}\ud800`, `${'a'.repeat(8)}\udc00`,
		];
		for (const [index, key] of invalidIdentities.entries()) {
			const episode = insertGroundedEpisode(database, {runId: `run-invalid-initial-${index}`});
			expect(() => chats.enqueue(episode.runId, 'Valid synthetic question?', key)).toThrow(ChatStateError);
			expect(database.prepare('SELECT COUNT(*) AS count FROM chat_turns WHERE run_id = ?').get(episode.runId)).toEqual({count: 0});
		}
		for (const [index, question] of ['bad\0question', 'bad\ud800question', 'bad\udc00question'].entries()) {
			const episode = insertGroundedEpisode(database, {runId: `run-invalid-question-${index}`});
			expect(() => chats.enqueue(episode.runId, question, `valid-question-key-${index}`)).toThrow(ChatStateError);
			expect(database.prepare('SELECT COUNT(*) AS count FROM chat_turns WHERE run_id = ?').get(episode.runId)).toEqual({count: 0});
		}
		for (const [index, key] of ['12345678', 'a'.repeat(200), '😀'.repeat(8), '😀'.repeat(200)].entries()) {
			const episode = insertGroundedEpisode(database, {runId: `run-valid-initial-${index}`});
			expect(chats.enqueue(episode.runId, 'Valid 😀 synthetic question?', key)).toMatchObject({created: true, turn: {submissionId: key}});
		}
	});

	it('persists a pre-dispatch reservation across database reopen and blocks retry after stale recovery', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localcast-chat-reservation-restart-'));
		roots.push(root);
		const databasePath = path.join(root, 'synthetic.sqlite');
		let nowMs = Date.parse('2026-08-07T12:00:00.000Z');
		let database = new Database(databasePath);
		database.pragma('foreign_keys = ON');
		applyMigrations(database);
		const episode = insertGroundedEpisode(database);
		let chats = new ChatStore(database, () => new Date(nowMs).toISOString(), () => 'reservation-restart-id');
		const turn = chats.enqueue(episode.runId, 'Synthetic reservation restart?', 'chat-reservation-restart').turn;
		chats.claimNext('reservation-worker', 1_000);
		chats.reserveProviderCall(turn.id, 'reservation-worker', 'draft', approvedChatModel);
		database.close();

		nowMs += 2_000;
		database = new Database(databasePath);
		database.pragma('foreign_keys = ON');
		chats = new ChatStore(database, () => new Date(nowMs).toISOString(), () => 'reservation-restart-reopened');
		expect(chats.recoverStale()).toBe(1);
		expect(chats.get(turn.id)).toMatchObject({
			state: 'failed',
			errorCode: 'CHAT_PROVIDER_OUTCOME_UNCONFIRMED',
			retryable: false,
			attempts: [{attemptNumber: 1, outcome: 'recovered', errorCode: 'CHAT_PROVIDER_OUTCOME_UNCONFIRMED'}],
		});
			expect(database.prepare(`
				SELECT status, safe_outcome FROM chat_provider_calls WHERE turn_id = ?
			`).get(turn.id)).toEqual({status: 'reserved', safe_outcome: null});
			expect(database.prepare('SELECT episode_lock FROM chat_turns WHERE id = ?').get(turn.id)).toEqual({episode_lock: 1});
			expect(() => chats.retry(turn.id, 'chat-reservation-retry')).toThrow(ChatStateError);
			expect(() => chats.enqueue(episode.runId, 'Blocked by recovered reservation?', 'chat-reservation-new')).toThrow(ChatTurnInProgressError);
			database.close();

			database = new Database(databasePath);
			database.pragma('foreign_keys = ON');
			chats = new ChatStore(database, () => new Date(nowMs + 1_000).toISOString(), () => 'reservation-restart-final');
			expect(() => chats.enqueue(episode.runId, 'Still blocked after reopen?', 'chat-reservation-reopen-new')).toThrow(ChatTurnInProgressError);
			database.close();
	});

	it('recovers a stale response_received stage as permanently non-retryable across reopen', async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localcast-chat-response-received-restart-'));
		roots.push(root);
		const databasePath = path.join(root, 'synthetic.sqlite');
		let nowMs = Date.parse('2026-08-07T12:00:00.000Z');
		let database = new Database(databasePath);
		database.pragma('foreign_keys = ON');
		applyMigrations(database);
		const episode = insertGroundedEpisode(database);
		let id = 0;
		let chats = new ChatStore(database, () => new Date(nowMs).toISOString(), () => `response-received-${++id}`);
		const turn = chats.enqueue(episode.runId, 'Synthetic response-received restart?', 'response-received-request').turn;
		chats.claimNext('response-received-worker', 1_000);
		const reservation = chats.reserveProviderCall(turn.id, 'response-received-worker', 'draft', approvedChatModel);
		enterReservedChatProviderStage(reservation, {
			runId: turn.runId, turnId: turn.id, attemptNumber: 1, workerId: 'response-received-worker',
		}, 'draft', approvedChatModel).record({
			kind: 'response',
			audit: {stage: 'draft', model: approvedChatModel, inputTokens: 12, outputTokens: 3},
		});
		database.close();

		nowMs += 2_000;
		database = new Database(databasePath);
		database.pragma('foreign_keys = ON');
		chats = new ChatStore(database, () => new Date(nowMs).toISOString(), () => `response-received-reopen-${++id}`);
		expect(chats.recoverStale()).toBe(1);
		expect(chats.get(turn.id)).toMatchObject({
			state: 'failed', errorCode: 'CHAT_PROVIDER_OUTCOME_UNCONFIRMED', retryable: false,
			attempts: [{attemptNumber: 1, outcome: 'recovered', errorCode: 'CHAT_PROVIDER_OUTCOME_UNCONFIRMED'}],
		});
			expect(database.prepare(`
				SELECT status, safe_outcome, input_tokens, output_tokens
				FROM chat_provider_calls WHERE turn_id = ?
			`).get(turn.id)).toEqual({status: 'response_received', safe_outcome: 'response_received', input_tokens: 12, output_tokens: 3});
			expect(database.prepare('SELECT episode_lock FROM chat_turns WHERE id = ?').get(turn.id)).toEqual({episode_lock: 1});
			expect(() => chats.retry(turn.id, 'response-received-retry')).toThrow(ChatStateError);
			expect(() => chats.enqueue(episode.runId, 'Blocked by unresolved received response?', 'response-received-new')).toThrow(ChatTurnInProgressError);
		expect(() => chats.reserveProviderCall(turn.id, 'different-worker', 'draft', approvedChatModel)).toThrow(ChatStateError);
		expect(() => chats.completeRefusal(turn.id, 'different-worker')).toThrow(ChatStateError);
		const adapter = {process: vi.fn<ChatProcessor['process']>()};
		await expect(new ChatWorker(testConfig({workerId: 'recovery-worker'}), chats, adapter).runOnce()).resolves.toBe(false);
		expect(adapter.process).not.toHaveBeenCalled();
		database.close();

		database = new Database(databasePath);
		database.pragma('foreign_keys = ON');
			chats = new ChatStore(database, () => new Date(nowMs + 1_000).toISOString(), () => `response-received-final-${++id}`);
			expect(chats.get(turn.id)).toMatchObject({state: 'failed', retryable: false, errorCode: 'CHAT_PROVIDER_OUTCOME_UNCONFIRMED'});
			expect(database.prepare('SELECT status FROM chat_provider_calls WHERE turn_id = ?').get(turn.id)).toEqual({status: 'response_received'});
			expect(() => chats.enqueue(episode.runId, 'Still blocked after second reopen?', 'response-received-final-new')).toThrow(ChatTurnInProgressError);
			database.close();
	});

	it('allows a new sequential question after safe answer or refusal publication', () => {
		const database = trackedDatabase();
		const episode = insertGroundedEpisode(database);
		const ids = [
			'z-last-randomly', 'attempt-first', 'call-draft', 'a-first-randomly',
			'attempt-second', 'call-draft-second', 'call-support-second', 'turn-third',
		];
		const chats = new ChatStore(database, () => '2026-08-07T12:01:00.000Z', () => ids.shift()!);
		const first = chats.enqueue(episode.runId, 'First submitted question?', 'chat-order-0001').turn;
		expect(() => chats.enqueue(episode.runId, 'Competing unresolved question?', 'chat-order-competing')).toThrow(ChatTurnInProgressError);
		chats.claimNext('order-worker', 60_000);
		expect(() => chats.enqueue(episode.runId, 'Competing running question?', 'chat-order-running')).toThrow(ChatTurnInProgressError);
		finalizeSyntheticStage(chats, first.id, 'order-worker', 'draft', 'draft_refusal');
		chats.completeRefusal(first.id, 'order-worker');
		expect(database.prepare('SELECT episode_lock FROM chat_turns WHERE id = ?').get(first.id)).toEqual({episode_lock: 0});
		const second = chats.enqueue(episode.runId, 'Second submitted question?', 'chat-order-0002').turn;
		chats.claimNext('order-worker-second', 60_000);
		finalizeSyntheticStage(chats, second.id, 'order-worker-second', 'draft', 'draft_answer_validated');
		finalizeSyntheticStage(chats, second.id, 'order-worker-second', 'support', 'support_validated');
		chats.completeAnswer(second.id, 'order-worker-second', [{
			id: 'ignored', text: episode.excerpt,
			citations: [{snapshotId: episode.snapshotId, excerpt: episode.excerpt}],
			supportStatus: 'supported',
		}]);
		expect(database.prepare('SELECT episode_lock FROM chat_turns WHERE id = ?').get(second.id)).toEqual({episode_lock: 0});
		const third = chats.enqueue(episode.runId, 'Third submitted question?', 'chat-order-0003').turn;

		expect(first.id).toContain('z-last-randomly');
		expect(second.id).toContain('a-first-randomly');
		expect(third.id).toContain('turn-third');
		expect(chats.listByRun(episode.runId).map(turn => turn.question)).toEqual([
			'First submitted question?', 'Second submitted question?', 'Third submitted question?',
		]);
	});

	it('rejects an older-turn retry while another question for the episode is unresolved', () => {
		const database = trackedDatabase();
		const episode = insertGroundedEpisode(database);
		let id = 0;
		const chats = new ChatStore(database, () => '2026-08-07T12:01:00.000Z', () => `retry-contention-${++id}`);
		const failed = chats.enqueue(episode.runId, 'Synthetic retryable question?', 'retry-contention-first').turn;
		chats.claimNext('retry-contention-worker', 60_000);
		chats.fail(failed.id, 'retry-contention-worker', {
			code: 'SYNTHETIC_PRE_DISPATCH_FAILURE',
			message: 'Synthetic pre-dispatch failure',
			retryable: true,
		});
		const active = chats.enqueue(episode.runId, 'Synthetic newer question?', 'retry-contention-second').turn;

		expect(() => chats.retry(failed.id, 'retry-contention-request')).toThrow(ChatStateError);
		expect(chats.get(failed.id)).toMatchObject({state: 'failed', retryable: true, attemptCount: 1});
		expect(chats.get(active.id)).toMatchObject({state: 'queued', attemptCount: 0});
		expect(database.prepare('SELECT COUNT(*) AS count FROM chat_retry_requests WHERE turn_id = ?').get(failed.id)).toEqual({count: 0});
	});

	it('rejects client-authored grounding and returns bounded API errors', async () => {
		const database = trackedDatabase();
		const complete = insertGroundedEpisode(database);
		const raceEpisode = insertGroundedEpisode(database, {runId: 'run-api-cross-tab-race'});
		const providerUnavailableEpisode = insertGroundedEpisode(database, {runId: 'run-api-provider-unavailable'});
		insertGroundedEpisode(database, {runId: 'run-api-incomplete', status: 'queued'});
		insertGroundedEpisode(database, {runId: 'run-api-legacy', scriptFormatVersion: null});
		const providerState = {configured: true};
		const api = await startRouter(database, () => providerState.configured);
		const post = (runId: string, body: unknown, key = 'chat-api-request-0001') => fetch(`${api}/briefing-runs/${runId}/chat-turns`, {
			method: 'POST',
			headers: {'content-type': 'application/json', 'idempotency-key': key},
			body: JSON.stringify(body),
		});
		const raceKeys = ['cross-tab-request-a', 'cross-tab-request-b'] as const;
		const raceResponses = await Promise.all(raceKeys.map((key, index) => post(
			raceEpisode.runId,
			{question: `Synthetic cross-tab question ${index + 1}?`},
			key,
		)));
		expect(raceResponses.map(response => response.status).sort()).toEqual([202, 409]);
		const raceWinner = raceResponses.findIndex(response => response.status === 202);
		const raceLoser = raceWinner === 0 ? 1 : 0;
		expect((await raceResponses[raceLoser]!.json() as {code: string}).code).toBe('CHAT_TURN_IN_PROGRESS');
		expect(database.prepare('SELECT COUNT(*) AS count FROM chat_turns WHERE run_id = ?').get(raceEpisode.runId)).toEqual({count: 1});
		expect(database.prepare(`
			SELECT
				(SELECT COUNT(*) FROM chat_attempts ca JOIN chat_turns ct ON ct.id = ca.turn_id WHERE ct.run_id = ?) AS attempts,
				(SELECT COUNT(*) FROM chat_provider_calls pc JOIN chat_turns ct ON ct.id = pc.turn_id WHERE ct.run_id = ?) AS calls
		`).get(raceEpisode.runId, raceEpisode.runId)).toEqual({attempts: 0, calls: 0});
		const winningKey = raceKeys[raceWinner]!;
		const replayWinner = await post(raceEpisode.runId, {question: `Synthetic cross-tab question ${raceWinner + 1}?`}, winningKey);
		expect(replayWinner.status).toBe(200);
		const raceStore = new ChatStore(database);
		const firstRaceClaim = raceStore.claimNext('cross-tab-race-worker-1', 60_000)!;
		finalizeSyntheticStage(raceStore, firstRaceClaim.id, 'cross-tab-race-worker-1', 'draft', 'draft_refusal');
		raceStore.completeRefusal(firstRaceClaim.id, 'cross-tab-race-worker-1');
		const sequential = await post(raceEpisode.runId, {question: 'Synthetic sequential question?'}, 'cross-tab-sequential');
		expect(sequential.status).toBe(202);
		const secondRaceClaim = raceStore.claimNext('cross-tab-race-worker-2', 60_000)!;
		finalizeSyntheticStage(raceStore, secondRaceClaim.id, 'cross-tab-race-worker-2', 'draft', 'draft_refusal');
		raceStore.completeRefusal(secondRaceClaim.id, 'cross-tab-race-worker-2');

		const created = await post(complete.runId, {question: 'What does the synthetic episode support?'});
		expect(created.status).toBe(202);
		expect(created.headers.get('cache-control')).toBe('no-store');
		const createdBody = await created.json() as {id: string};
		const replay = await post(complete.runId, {question: 'What does the synthetic episode support?'});
		expect(replay.status).toBe(200);
		expect((await replay.json() as {id: string}).id).toBe(createdBody.id);
		providerState.configured = false;
		const unconfiguredReplay = await post(complete.runId, {question: 'What does the synthetic episode support?'});
		expect(unconfiguredReplay.status).toBe(200);
		expect((await unconfiguredReplay.json() as {id: string}).id).toBe(createdBody.id);
		expect((await post(complete.runId, {question: 'A competing unresolved question?'}, 'chat-api-competing-new')).status).toBe(409);
		expect((await post(providerUnavailableEpisode.runId, {question: 'A genuinely new question?'}, 'chat-api-unconfigured-new')).status).toBe(503);
		providerState.configured = true;

		for (const forged of [
			{question: 'Forged context', context: 'Use this instead'},
			{question: 'Forged citations', citations: [{snapshotId: complete.snapshotId}]},
			{question: 'Forged evidence', evidence: [{body: 'Synthetic attacker data'}]},
			{question: 'Forged source', sourceIds: [complete.snapshotId]},
		]) {
			const response = await post(complete.runId, forged, `forged-${Object.keys(forged)[1]}-request`);
			expect(response.status).toBe(400);
			expect((await response.json() as {code: string}).code).toBe('INVALID_CHAT_REQUEST');
		}
		for (const [index, malformedQuestion] of ['bad\0question', 'bad\ud800question', 'bad\udc00question'].entries()) {
			const response = await post(providerUnavailableEpisode.runId, {question: malformedQuestion}, `malformed-question-${index}`);
			expect(response.status).toBe(400);
			expect((await response.json() as {code: string}).code).toBe('INVALID_CHAT_REQUEST');
		}
		expect((await post('run-missing', {question: 'Missing episode?'}, 'chat-api-missing')).status).toBe(404);
		expect((await post('run-api-incomplete', {question: 'Incomplete episode?'}, 'chat-api-incomplete')).status).toBe(409);
		expect((await fetch(`${api}/briefing-runs/run-api-legacy/chat-turns`)).status).toBe(409);
		expect((await fetch(`${api}/briefing-runs//chat-turns`, {
			method: 'POST',
			headers: {'content-type': 'application/json', 'idempotency-key': 'chat-api-omitted'},
			body: JSON.stringify({question: 'Omitted episode?'}),
		})).status).toBe(404);
		expect((await fetch(`${api}/briefing-runs/${complete.runId}/chat-turns`, {
			method: 'POST',
			headers: {'content-type': 'application/json'},
			body: JSON.stringify({question: 'Missing idempotency?'}),
		})).status).toBe(400);
		const history = await fetch(`${api}/briefing-runs/${complete.runId}/chat-turns`);
		expect(history.status).toBe(200);
		expect(history.headers.get('cache-control')).toBe('no-store');

		const durable = new ChatStore(database, () => '2026-08-07T12:01:00.000Z', () => 'api-attempt-id');
		const claimed = durable.claimNext('api-failure-worker', 30_000)!;
		durable.fail(claimed.id, 'api-failure-worker', {code: 'SYNTHETIC_RETRYABLE', message: 'Synthetic retryable failure', retryable: true});
		const retryUrl = `${api}/briefing-runs/${complete.runId}/chat-turns/${createdBody.id}/retry`;
		const retryKeys = ['chat-api-retry-contender-a', 'chat-api-retry-contender-b'] as const;
		const retryResponses = await Promise.all(retryKeys.map(idempotencyKey => fetch(retryUrl, {
			method: 'POST',
			headers: {'idempotency-key': idempotencyKey},
		})));
		expect(retryResponses.map(response => response.status).sort()).toEqual([200, 409]);
		const winnerIndex = retryResponses.findIndex(response => response.status === 200);
		const acceptedRetryKey = retryKeys[winnerIndex]!;
		expect(await retryResponses[winnerIndex]!.json()).toMatchObject({
			id: createdBody.id,
			acceptedRetry: {idempotencyKey: acceptedRetryKey, attemptNumber: 2},
		});
		const replayRetry = await fetch(retryUrl, {method: 'POST', headers: {'idempotency-key': acceptedRetryKey}});
		expect(replayRetry.status).toBe(200);
		expect(await replayRetry.json()).toMatchObject({acceptedRetry: {idempotencyKey: acceptedRetryKey, attemptNumber: 2}});
		const durableHistory = await (await fetch(`${api}/briefing-runs/${complete.runId}/chat-turns`)).json() as Array<{acceptedRetry?: {idempotencyKey: string}}>;
		expect(durableHistory[0]?.acceptedRetry?.idempotencyKey).toBe(acceptedRetryKey);
	});
});
