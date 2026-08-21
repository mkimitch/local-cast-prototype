import {randomUUID} from 'node:crypto';
import Database from 'better-sqlite3';
import {isBoundedLocalCastText, isWellFormedLocalCastText, type ChatAttempt, type ChatClaim, type ChatTurn} from '../../src/types';
import {assertChatCitations} from '../chat/validation';
import {
	chatLimits,
	type ChatGroundingContext,
	type ChatProviderCallEvent,
	type ChatProviderCallStage,
	type ChatProviderStageIdentity,
	type ChatProviderStageReservation,
	type ChatTranscriptSegment,
	type ClaimedChatTurn,
	type SupportedChatClaim,
} from '../chat/types';
import {db} from '../database/index';
import {EpisodeStore} from './episodeStore';

type ChatTurnRow = {
	id: string;
	run_id: string;
	idempotency_key: string;
	enqueue_order: number;
	question: string;
	state: ChatTurn['state'];
	answer_kind: ChatTurn['answerKind'] | null;
	refusal_code: ChatTurn['refusalCode'] | null;
	episode_lock: number;
	attempt_count: number;
	lease_owner: string | null;
	lease_expires_at: string | null;
	error_code: string | null;
	error_message: string | null;
	retryable: number;
	created_at: string;
	updated_at: string;
	started_at: string | null;
	completed_at: string | null;
};

type ChatAttemptRow = {
	id: string;
	turn_id: string;
	attempt_number: number;
	worker_id: string;
	started_at: string;
	finished_at: string | null;
	outcome: ChatAttempt['outcome'];
	error_code: string | null;
	error_message: string | null;
};

type EvidenceCitationRow = {
	snapshot_id: string;
	excerpt: string;
	title: string;
	kind: 'note' | 'feed';
	source_name_snapshot: string | null;
	author: string | null;
	original_url: string | null;
	published_at: string | null;
};

type ChatProviderCallRow = {
	id: string;
	turn_id: string;
	attempt_number: number;
	stage: ChatProviderCallStage;
	model: string;
	status: 'reserved' | 'response_received' | 'ambiguous' | 'finalized';
	safe_outcome: string | null;
	worker_id: string;
};

type ChatRetryRequestRow = {
	idempotency_key: string;
	requested_attempt_number: 2;
	created_at: string;
};

type ProviderReservationBinding = {
	reservation: ChatProviderStageReservation;
	consumed: boolean;
	assertCurrent: () => void;
	record: (event: ChatProviderCallEvent) => void;
};

export interface ChatProviderStageLifecycle {
	readonly reservation: ChatProviderStageReservation;
	record(event: ChatProviderCallEvent): void;
}

const providerReservationBindings = new WeakMap<object, ProviderReservationBinding>();

export const enterReservedChatProviderStage = (
	grant: ChatProviderStageReservation,
	identity: ChatProviderStageIdentity,
	stage: ChatProviderCallStage,
	model: ChatProviderStageReservation['model'],
): ChatProviderStageLifecycle => {
	const binding = grant && typeof grant === 'object' ? providerReservationBindings.get(grant) : undefined;
	if (
		!binding
		|| binding.consumed
		|| binding.reservation !== grant
		|| grant.turnId !== identity.turnId
		|| grant.runId !== identity.runId
		|| grant.attemptNumber !== identity.attemptNumber
		|| grant.workerId !== identity.workerId
		|| grant.stage !== stage
		|| grant.model !== model
	) throw new ChatStateError('Invalid durable chat provider reservation');
	binding.assertCurrent();
	binding.consumed = true;
	return Object.freeze({
		reservation: grant,
		record: (event: ChatProviderCallEvent) => binding.record(event),
	});
};

const safeText = (value: string, maximum = 240): string => value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, maximum);
const addMilliseconds = (iso: string, milliseconds: number): string => new Date(new Date(iso).getTime() + milliseconds).toISOString();
const boundedIdempotencyKey = (value: string): string => {
	if (value !== value.trim() || !isBoundedLocalCastText(value, 8, 200)) {
		throw new ChatStateError('Chat idempotency key is outside the supported bounds');
	}
	return value;
};
const stageAcceptsOutcome = (stage: ChatProviderCallStage, outcome: string): boolean => stage === 'draft'
	? ['draft_refusal', 'draft_answer_validated', 'invalid_response', 'invalid_citations', 'provider_rejected', 'response_too_large', 'empty_response'].includes(outcome)
	: ['support_validated', 'support_rejected', 'invalid_response', 'provider_rejected', 'response_too_large', 'empty_response'].includes(outcome);
const providerOutcomeUnconfirmed = {
	code: 'CHAT_PROVIDER_OUTCOME_UNCONFIRMED',
	message: 'The external provider outcome could not be confirmed. LocalCast will not retry because doing so could overlap external work.',
} as const;

export class ChatEpisodeNotFoundError extends Error {
	constructor() {
		super('Episode not found');
		this.name = 'ChatEpisodeNotFoundError';
	}
}

export class ChatEpisodeUnavailableError extends Error {
	constructor() {
		super('Follow-up chat requires a completed grounded episode');
		this.name = 'ChatEpisodeUnavailableError';
	}
}

export class ChatIdempotencyConflictError extends Error {
	constructor() {
		super('The idempotency key was already used with a different chat request');
		this.name = 'ChatIdempotencyConflictError';
	}
}

export class ChatTurnInProgressError extends Error {
	constructor() {
		super('Another question is already in progress for this episode');
		this.name = 'ChatTurnInProgressError';
	}
}

export class ChatProviderUnavailableError extends Error {
	constructor() {
		super('A supported server-side text provider is not configured');
		this.name = 'ChatProviderUnavailableError';
	}
}

export class ChatStateError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ChatStateError';
	}
}

const assertSupportedChatDatabase = (database: Database.Database): void => {
	try {
		if (!(database instanceof Database)) throw new Error('unsupported SQLite object');
		const statement = Reflect.apply(Database.prototype.prepare, database, ['SELECT 1 AS supported']) as Database.Statement;
		if ((statement.get() as {supported?: unknown}).supported !== 1) throw new Error('unsupported SQLite response');
	} catch {
		throw new ChatStateError('Chat persistence requires a supported SQLite database');
	}
};

export class ChatStore {
	private readonly episodes: EpisodeStore;

	constructor(
		private readonly database: Database.Database = db,
		private readonly now: () => string = () => new Date().toISOString(),
		private readonly createId: () => string = randomUUID,
	) {
		assertSupportedChatDatabase(database);
		this.episodes = new EpisodeStore(database);
	}

	enqueue(runId: string, question: string, idempotencyKey: string, providerConfigured = true): {turn: ChatTurn; created: boolean} {
		if (!isWellFormedLocalCastText(question)) throw new ChatStateError('Chat question is outside the supported bounds');
		const normalizedQuestion = question.trim();
		if (!isBoundedLocalCastText(normalizedQuestion, 1, chatLimits.questionCharacters)) throw new ChatStateError('Chat question is outside the supported bounds');
		const normalizedIdempotencyKey = boundedIdempotencyKey(idempotencyKey);
		const enqueue = this.database.transaction(() => {
			const existing = this.database.prepare('SELECT * FROM chat_turns WHERE idempotency_key = ?').get(normalizedIdempotencyKey) as ChatTurnRow | undefined;
			if (existing) {
				if (existing.run_id !== runId || existing.question !== normalizedQuestion) throw new ChatIdempotencyConflictError();
				return {turn: this.fromRow(existing), created: false};
			}
			if (this.database.prepare('SELECT 1 FROM chat_turns WHERE run_id = ? AND episode_lock = 1').get(runId)) {
				throw new ChatTurnInProgressError();
			}

			this.assertCompletedGroundedEpisode(runId);
			if (!providerConfigured) throw new ChatProviderUnavailableError();
			const timestamp = this.now();
			const turnId = `chat-${this.createId()}`;
			const nextOrder = (this.database.prepare('SELECT COALESCE(MAX(enqueue_order), 0) + 1 AS value FROM chat_turns').get() as {value: number}).value;
			this.database.prepare(`
				INSERT INTO chat_turns (
					id, run_id, idempotency_key, enqueue_order, question, state, attempt_count,
					retryable, created_at, updated_at
				) VALUES (?, ?, ?, ?, ?, 'queued', 0, 0, ?, ?)
			`).run(turnId, runId, normalizedIdempotencyKey, nextOrder, normalizedQuestion, timestamp, timestamp);
			return {turn: this.get(turnId)!, created: true};
		});

		try {
			return enqueue.immediate();
		} catch (error) {
			const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
			if (
				code.startsWith('SQLITE_CONSTRAINT')
				&& this.database.prepare('SELECT 1 FROM chat_turns WHERE run_id = ? AND episode_lock = 1').get(runId)
			) throw new ChatTurnInProgressError();
			throw error;
		}
	}

	claimNext(workerId: string, leaseMs: number): ClaimedChatTurn | undefined {
		const claim = this.database.transaction(() => {
			const timestamp = this.now();
			this.recoverStaleWithinTransaction(timestamp);
			if (this.database.prepare("SELECT 1 FROM chat_turns WHERE state = 'running' LIMIT 1").get()) return undefined;

			while (true) {
				const row = this.database.prepare("SELECT * FROM chat_turns WHERE state = 'queued' ORDER BY enqueue_order LIMIT 1").get() as ChatTurnRow | undefined;
				if (!row) return undefined;
				if (row.attempt_count >= chatLimits.maximumAttempts) {
					this.failExhaustedQueuedTurn(row, timestamp);
					continue;
				}
				try {
					this.assertCompletedGroundedEpisode(row.run_id);
				} catch {
					this.failUnavailableQueuedTurn(row, timestamp);
					continue;
				}

				const attemptNumber = row.attempt_count + 1;
				const leaseExpiresAt = addMilliseconds(timestamp, leaseMs);
				const updated = this.database.prepare(`
					UPDATE chat_turns
					SET state = 'running', attempt_count = ?, lease_owner = ?, lease_expires_at = ?,
						started_at = COALESCE(started_at, ?), completed_at = NULL,
						error_code = NULL, error_message = NULL, retryable = 0, updated_at = ?
					WHERE id = ? AND state = 'queued'
				`).run(attemptNumber, workerId, leaseExpiresAt, timestamp, timestamp, row.id);
				if (updated.changes !== 1) continue;
				this.database.prepare(`
					INSERT INTO chat_attempts (id, turn_id, attempt_number, worker_id, started_at, outcome)
					VALUES (?, ?, ?, ?, ?, 'running')
				`).run(`chat-attempt-${this.createId()}`, row.id, attemptNumber, workerId, timestamp);
				return this.claimed(this.requireRow(row.id));
			}
		});

		return claim.immediate();
	}

	renewLease(turnId: string, workerId: string, leaseMs: number): ClaimedChatTurn {
		const renew = this.database.transaction(() => {
			const timestamp = this.now();
			const current = this.requireOwnedRunningTurn(turnId, workerId, timestamp);
			const updated = this.database.prepare(`
				UPDATE chat_turns SET lease_expires_at = ?, updated_at = ?
				WHERE id = ? AND state = 'running' AND lease_owner = ? AND attempt_count = ?
					AND lease_expires_at > ?
			`).run(addMilliseconds(timestamp, leaseMs), timestamp, turnId, workerId, current.attemptCount, timestamp);
			if (updated.changes !== 1) throw new ChatStateError('Worker lost its chat lease');
			return this.claimed(this.requireRow(turnId));
		});

		return renew.immediate();
	}

	completeAnswer(turnId: string, workerId: string, claims: SupportedChatClaim[]): ChatTurn {
		const complete = this.database.transaction(() => {
			const timestamp = this.now();
			const current = this.requireOwnedRunningTurn(turnId, workerId, timestamp);
			this.assertProviderCallsReadyForPublication(turnId, current.attemptCount, workerId, 'answer');
			const evidence = this.episodes.listEvidence(current.runId);
			const locallyOwnedClaims = claims.map((claim, index) => ({
				...claim,
				id: `chat-claim-${turnId}-${index}`,
				supportStatus: 'supported' as const,
			}));
			assertChatCitations(evidence, locallyOwnedClaims);

			this.database.prepare('DELETE FROM chat_claims WHERE turn_id = ?').run(turnId);
			const insertClaim = this.database.prepare(`
				INSERT INTO chat_claims (id, turn_id, run_id, text, support_status, sort_order)
				VALUES (?, ?, ?, ?, 'supported', ?)
			`);
			const insertCitation = this.database.prepare(`
				INSERT INTO chat_citations (claim_id, run_id, snapshot_id, excerpt, sort_order)
				VALUES (?, ?, ?, ?, ?)
			`);
			for (const [claimIndex, claim] of locallyOwnedClaims.entries()) {
				insertClaim.run(claim.id, turnId, current.runId, claim.text, claimIndex);
				claim.citations.forEach((citation, citationIndex) => {
					insertCitation.run(claim.id, current.runId, citation.snapshotId, citation.excerpt, citationIndex);
				});
			}

			this.database.prepare(`
				UPDATE chat_turns
				SET state = 'answered', answer_kind = 'answer', refusal_code = NULL,
					episode_lock = 0,
					lease_owner = NULL, lease_expires_at = NULL, retryable = 0,
					error_code = NULL, error_message = NULL, updated_at = ?, completed_at = ?
				WHERE id = ?
			`).run(timestamp, timestamp, turnId);
			this.finishAttempt(current, 'answered', timestamp);
			return this.get(turnId)!;
		});

		return complete.immediate();
	}

	completeRefusal(turnId: string, workerId: string): ChatTurn {
		const complete = this.database.transaction(() => {
			const timestamp = this.now();
			const current = this.requireOwnedRunningTurn(turnId, workerId, timestamp);
			this.assertProviderCallsReadyForPublication(turnId, current.attemptCount, workerId, 'refusal');
			this.database.prepare('DELETE FROM chat_claims WHERE turn_id = ?').run(turnId);
			this.database.prepare(`
				UPDATE chat_turns
				SET state = 'refused', answer_kind = 'refusal', refusal_code = 'EVIDENCE_INSUFFICIENT',
					episode_lock = 0,
					lease_owner = NULL, lease_expires_at = NULL, retryable = 0,
					error_code = NULL, error_message = NULL, updated_at = ?, completed_at = ?
				WHERE id = ?
			`).run(timestamp, timestamp, turnId);
			this.finishAttempt(current, 'refused', timestamp);
			return this.get(turnId)!;
		});

		return complete.immediate();
	}

	fail(turnId: string, workerId: string, failure: {code: string; message: string; retryable: boolean}): ChatTurn {
		const fail = this.database.transaction(() => {
			const timestamp = this.now();
			const current = this.requireOwnedRunningTurn(turnId, workerId, timestamp);
			const unresolvedProviderCall = this.hasUnresolvedProviderCall(turnId, current.attemptCount);
			const providerLifecycleStarted = this.hasProviderCallLifecycle(turnId);
			const code = unresolvedProviderCall
				? providerOutcomeUnconfirmed.code
				: safeText(failure.code).replace(/[^A-Z0-9_]/g, '_') || 'CHAT_FAILED';
			const message = unresolvedProviderCall ? providerOutcomeUnconfirmed.message : safeText(failure.message);
			const retryable = !unresolvedProviderCall && failure.retryable && current.attemptCount < chatLimits.maximumAttempts;
			this.database.prepare(`
				UPDATE chat_turns
				SET state = 'failed', answer_kind = NULL, refusal_code = NULL,
					episode_lock = ?,
					lease_owner = NULL, lease_expires_at = NULL,
					error_code = ?, error_message = ?, retryable = ?, updated_at = ?, completed_at = ?
				WHERE id = ?
			`).run(providerLifecycleStarted ? 1 : 0, code, message, retryable ? 1 : 0, timestamp, timestamp, turnId);
			this.finishAttempt(current, 'failed', timestamp, code, message);
			return this.get(turnId)!;
		});

		return fail.immediate();
	}

	interrupt(turnId: string, workerId: string): ChatTurn {
		const interrupt = this.database.transaction(() => {
			const timestamp = this.now();
			const current = this.requireOwnedRunningTurn(turnId, workerId, timestamp);
			const unresolvedProviderCall = this.hasUnresolvedProviderCall(turnId, current.attemptCount);
			const providerLifecycleStarted = this.hasProviderCallLifecycle(turnId);
			const retryable = !unresolvedProviderCall && current.attemptCount < chatLimits.maximumAttempts;
			const code = unresolvedProviderCall ? providerOutcomeUnconfirmed.code : 'CHAT_ATTEMPT_INTERRUPTED';
			const message = unresolvedProviderCall
				? providerOutcomeUnconfirmed.message
				: 'The follow-up attempt was interrupted before LocalCast could publish a validated result';
			this.database.prepare(`
				UPDATE chat_turns
				SET state = 'failed', lease_owner = NULL, lease_expires_at = NULL,
					episode_lock = ?,
					error_code = ?, error_message = ?,
					retryable = ?, updated_at = ?, completed_at = ?
				WHERE id = ?
			`).run(providerLifecycleStarted ? 1 : 0, code, message, retryable ? 1 : 0, timestamp, timestamp, turnId);
			this.finishAttempt(current, 'interrupted', timestamp, code, message);
			return this.get(turnId)!;
		});

		return interrupt.immediate();
	}

	retry(turnId: string, idempotencyKey: string, providerConfigured = true): ChatTurn {
		const normalizedIdempotencyKey = boundedIdempotencyKey(idempotencyKey);
		const retry = this.database.transaction(() => {
			const current = this.get(turnId);
			if (!current) throw new ChatStateError('Chat turn not found');
			const replay = this.database.prepare('SELECT 1 FROM chat_retry_requests WHERE turn_id = ? AND idempotency_key = ?').get(turnId, normalizedIdempotencyKey);
			if (replay) return current;
			if (this.database.prepare('SELECT 1 FROM chat_retry_requests WHERE turn_id = ?').get(turnId)) {
				throw new ChatStateError('A retry was already requested for this chat turn');
			}
			if (current.attemptCount >= chatLimits.maximumAttempts) throw new ChatStateError('The chat attempt limit has been reached');
			if (current.state !== 'failed' || !current.retryable) throw new ChatStateError('Chat turn is not retryable');
			if (this.database.prepare(`
				SELECT 1 FROM chat_turns
				WHERE run_id = ? AND id <> ? AND episode_lock = 1
			`).get(current.runId, current.id)) {
				throw new ChatStateError('Another question is already in progress for this episode');
			}
			if (this.hasUnresolvedProviderCall(turnId, current.attemptCount)) {
				throw new ChatStateError('Chat turn has an unresolved external-provider outcome');
			}

			this.assertCompletedGroundedEpisode(current.runId);
			if (!providerConfigured) throw new ChatProviderUnavailableError();
			const timestamp = this.now();
			this.insertRetryRequest(turnId, normalizedIdempotencyKey, current.attemptCount + 1, timestamp);
			this.database.prepare(`
				UPDATE chat_turns
				SET state = 'queued', answer_kind = NULL, refusal_code = NULL,
					episode_lock = 1,
					error_code = NULL, error_message = NULL, retryable = 0,
					completed_at = NULL, updated_at = ?
				WHERE id = ?
			`).run(timestamp, turnId);
			return this.get(turnId)!;
		});

		try {
			return retry.immediate();
		} catch (error) {
			const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
			if (code.startsWith('SQLITE_CONSTRAINT')) {
				throw new ChatStateError('Another question is already in progress for this episode');
			}
			throw error;
		}
	}

	reserveProviderCall(
		turnId: string,
		workerId: string,
		stage: ChatProviderCallStage,
		model: ChatProviderStageReservation['model'],
	): ChatProviderStageReservation {
		const reserve = this.database.transaction(() => {
			const timestamp = this.now();
			const current = this.requireOwnedRunningTurn(turnId, workerId, timestamp);
			const existing = this.listProviderCalls(turnId, current.attemptCount);
			if (existing.length >= 2) throw new ChatStateError('The provider-call attempt ceiling has been reached');
			const turnCallCount = (this.database.prepare('SELECT COUNT(*) AS count FROM chat_provider_calls WHERE turn_id = ?').get(turnId) as {count: number}).count;
			if (turnCallCount >= chatLimits.maximumAttempts * 2) throw new ChatStateError('The provider-call turn ceiling has been reached');

			if (stage === 'draft') {
				if (existing.length > 0) throw new ChatStateError('The draft provider-call stage is already reserved');
			} else {
				const draft = existing.find(call => call.stage === 'draft');
				if (!draft || draft.status !== 'finalized' || draft.safe_outcome !== 'draft_answer_validated') {
					throw new ChatStateError('The support provider-call stage is not permitted');
				}
				if (existing.some(call => call.stage === 'support')) throw new ChatStateError('The support provider-call stage is already reserved');
			}

			const reservationFields: ChatProviderStageReservation = {
				id: `chat-provider-call-${this.createId()}`,
				runId: current.runId,
				turnId,
				attemptNumber: current.attemptCount,
				stage,
				model,
				workerId,
			};
			this.database.prepare(`
				INSERT INTO chat_provider_calls (
					id, turn_id, attempt_number, stage, model, worker_id, status,
					reserved_at, updated_at
				) VALUES (?, ?, ?, ?, ?, ?, 'reserved', ?, ?)
			`).run(
				reservationFields.id,
				reservationFields.turnId,
				reservationFields.attemptNumber,
				reservationFields.stage,
				reservationFields.model,
				reservationFields.workerId,
				timestamp,
				timestamp,
			);
			return reservationFields;
		});
		const committedReservation = reserve.immediate();
		const grant = Object.freeze({...committedReservation});
		providerReservationBindings.set(grant, {
			reservation: grant,
			consumed: false,
			assertCurrent: () => this.#assertProviderReservationCurrent(grant),
			record: event => this.#recordProviderCallEvent(grant, event),
		});
		return grant;
	}

	#recordProviderCallEvent(reservation: ChatProviderStageReservation, event: ChatProviderCallEvent): void {
		const record = this.database.transaction(() => {
			const timestamp = this.now();
			const current = this.requireOwnedRunningTurn(reservation.turnId, reservation.workerId, timestamp);
			if (current.runId !== reservation.runId) throw new ChatStateError('Provider-call reservation belongs to another episode');
			if (current.attemptCount !== reservation.attemptNumber) throw new ChatStateError('Provider-call reservation belongs to another attempt');
			const stage = event.kind === 'response' ? event.audit.stage : event.stage;
			if (stage !== reservation.stage) throw new ChatStateError('Provider-call event does not match its reservation stage');
			const row = this.database.prepare(`
				SELECT id, turn_id, attempt_number, stage, model, status, safe_outcome, worker_id
				FROM chat_provider_calls
				WHERE id = ? AND turn_id = ? AND attempt_number = ? AND stage = ? AND model = ?
			`).get(
				reservation.id,
				reservation.turnId,
				reservation.attemptNumber,
				reservation.stage,
				reservation.model,
			) as ChatProviderCallRow | undefined;
			if (!row || row.worker_id !== reservation.workerId) throw new ChatStateError('Worker does not own this provider-call reservation');

			if (event.kind === 'response') {
				if (row.status !== 'reserved') throw new ChatStateError('Provider-call response cannot be recorded from this state');
				const audit = event.audit;
				if (audit.model !== reservation.model) throw new ChatStateError('Provider-call response model does not match its reservation');
				const updated = this.database.prepare(`
					UPDATE chat_provider_calls
					SET status = 'response_received', safe_outcome = 'response_received',
						input_tokens = ?, cached_input_tokens = ?, output_tokens = ?, reasoning_output_tokens = ?,
						provider_request_id = ?, response_received_at = ?, updated_at = ?
					WHERE id = ? AND turn_id = ? AND attempt_number = ? AND stage = ?
						AND worker_id = ? AND status = 'reserved' AND model = ?
				`).run(
					audit.inputTokens ?? null,
					audit.cachedInputTokens ?? null,
					audit.outputTokens ?? null,
					audit.reasoningOutputTokens ?? null,
					audit.providerRequestId ?? null,
					timestamp,
					timestamp,
					reservation.id,
					reservation.turnId,
					reservation.attemptNumber,
					stage,
					reservation.workerId,
					audit.model,
				);
				if (updated.changes !== 1) throw new ChatStateError('Provider-call response reservation changed unexpectedly');
				return;
			}

			if (event.kind === 'ambiguous') {
				if (row.status !== 'reserved') throw new ChatStateError('Provider-call ambiguity cannot be recorded from this state');
				const updated = this.database.prepare(`
					UPDATE chat_provider_calls
					SET status = 'ambiguous', safe_outcome = ?, completed_at = ?, updated_at = ?
					WHERE id = ? AND turn_id = ? AND attempt_number = ? AND stage = ?
						AND worker_id = ? AND status = 'reserved'
				`).run(event.outcome, timestamp, timestamp, reservation.id, reservation.turnId, reservation.attemptNumber, stage, reservation.workerId);
				if (updated.changes !== 1) throw new ChatStateError('Provider-call reservation changed before ambiguity was recorded');
				return;
			}

			if (row.status !== 'response_received') throw new ChatStateError('Provider-call response cannot be finalized from this state');
			if (!stageAcceptsOutcome(stage, event.outcome)) throw new ChatStateError('Provider-call outcome is not permitted for this stage');
			const updated = this.database.prepare(`
				UPDATE chat_provider_calls
				SET status = 'finalized', safe_outcome = ?, completed_at = ?, updated_at = ?
				WHERE id = ? AND turn_id = ? AND attempt_number = ? AND stage = ?
					AND worker_id = ? AND status = 'response_received'
			`).run(event.outcome, timestamp, timestamp, reservation.id, reservation.turnId, reservation.attemptNumber, stage, reservation.workerId);
			if (updated.changes !== 1) throw new ChatStateError('Provider-call response changed before it was finalized');
		});
		record.immediate();
	}

	recoverStale(): number {
		const recover = this.database.transaction(() => this.recoverStaleWithinTransaction(this.now()));
		return recover.immediate();
	}

	get(id: string): ChatTurn | undefined {
		const row = this.database.prepare('SELECT * FROM chat_turns WHERE id = ?').get(id) as ChatTurnRow | undefined;
		return row ? this.fromRow(row) : undefined;
	}

	isOwnedRunning(turnId: string, workerId: string): boolean {
		const timestamp = this.now();
		return Boolean(this.database.prepare(`
			SELECT 1 FROM chat_turns
			WHERE id = ? AND state = 'running' AND lease_owner = ? AND lease_expires_at > ?
		`).get(turnId, workerId, timestamp));
	}

	assertEpisodeAvailable(runId: string): void {
		this.assertCompletedGroundedEpisode(runId);
	}

	listByRun(runId: string): ChatTurn[] {
		const rows = this.database.prepare('SELECT * FROM chat_turns WHERE run_id = ? ORDER BY enqueue_order').all(runId) as ChatTurnRow[];
		return rows.map(row => this.fromRow(row));
	}

	loadGroundingContext(turnId: string): ChatGroundingContext {
		const row = this.requireRow(turnId);
		const run = this.assertCompletedGroundedEpisode(row.run_id);
		const transcriptRows = this.database.prepare(`
			SELECT tc.id, tc.kind, tc.text
			FROM transcript_claims tc
			JOIN briefing_sections bs ON bs.id = tc.section_id
			WHERE tc.run_id = ?
			ORDER BY bs.sort_order, tc.sort_order, tc.id
		`).all(row.run_id) as Array<{id: string; kind: ChatTranscriptSegment['kind']; text: string}>;
		const transcript = transcriptRows.map(segment => ({
			...segment,
			citations: (this.database.prepare(`
				SELECT snapshot_id, excerpt FROM episode_citations
				WHERE claim_id = ? ORDER BY sort_order
			`).all(segment.id) as Array<{snapshot_id: string; excerpt: string}>).map(citation => ({
				snapshotId: citation.snapshot_id,
				excerpt: citation.excerpt,
			})),
		}));

		return {
			turnId: row.id,
			runId: row.run_id,
			episodeTitle: run.title,
			question: row.question,
			transcript,
			evidence: this.episodes.listEvidence(row.run_id),
		};
	}

	private fromRow(row: ChatTurnRow): ChatTurn {
		const acceptedRetry = this.database.prepare(`
			SELECT idempotency_key, requested_attempt_number, created_at
			FROM chat_retry_requests WHERE turn_id = ?
		`).get(row.id) as ChatRetryRequestRow | undefined;
		const claimRows = this.database.prepare(`
			SELECT id, text, support_status FROM chat_claims
			WHERE turn_id = ? ORDER BY sort_order
		`).all(row.id) as Array<{id: string; text: string; support_status: 'supported'}>;
		const claims: ChatClaim[] = claimRows.map(claim => ({
			id: claim.id,
			text: claim.text,
			supportStatus: claim.support_status,
			citations: (this.database.prepare(`
				SELECT cc.snapshot_id, cc.excerpt, ees.title, ees.kind, ees.source_name_snapshot,
					ees.author, ees.original_url, ees.published_at
				FROM chat_citations cc
				JOIN episode_evidence_snapshots ees
					ON ees.run_id = cc.run_id AND ees.id = cc.snapshot_id
				WHERE cc.claim_id = ? ORDER BY cc.sort_order
			`).all(claim.id) as EvidenceCitationRow[]).map(citation => ({
				snapshotId: citation.snapshot_id,
				title: citation.title,
				sourceName: citation.source_name_snapshot || (citation.kind === 'note' ? 'Pasted note' : 'RSS/Atom source'),
				kind: citation.kind,
				excerpt: citation.excerpt,
				author: citation.author || undefined,
				originalUrl: citation.original_url || undefined,
				publishedAt: citation.published_at || undefined,
			})),
		}));

		return {
			id: row.id,
			submissionId: row.idempotency_key,
			...(acceptedRetry ? {
				acceptedRetry: {
					idempotencyKey: acceptedRetry.idempotency_key,
					attemptNumber: acceptedRetry.requested_attempt_number,
					acceptedAt: acceptedRetry.created_at,
				},
			} : {}),
			runId: row.run_id,
			question: row.question,
			state: row.state,
			answerKind: row.answer_kind || undefined,
			refusalCode: row.refusal_code || undefined,
			claims,
			attemptCount: row.attempt_count,
			errorCode: row.error_code || undefined,
			errorMessage: row.error_message || undefined,
			retryable: row.retryable === 1,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
			completedAt: row.completed_at || undefined,
			attempts: this.listAttempts(row.id),
		};
	}

	private listAttempts(turnId: string): ChatAttempt[] {
		const rows = this.database.prepare('SELECT * FROM chat_attempts WHERE turn_id = ? ORDER BY attempt_number').all(turnId) as ChatAttemptRow[];
		return rows.map(row => ({
			attemptNumber: row.attempt_number,
			startedAt: row.started_at,
			finishedAt: row.finished_at || undefined,
			outcome: row.outcome,
			errorCode: row.error_code || undefined,
		}));
	}

	private assertCompletedGroundedEpisode(runId: string): {title: string} {
		const run = this.database.prepare('SELECT title, status, script_format_version FROM briefing_runs WHERE id = ?').get(runId) as {
			title: string;
			status: string;
			script_format_version: number | null;
		} | undefined;
		if (!run) throw new ChatEpisodeNotFoundError();
		if (run.status !== 'complete' || run.script_format_version !== 1) throw new ChatEpisodeUnavailableError();
		const hasEvidence = Boolean(this.database.prepare('SELECT 1 FROM episode_evidence_snapshots WHERE run_id = ? LIMIT 1').get(runId));
		const hasGroundedTranscript = Boolean(this.database.prepare(`
			SELECT 1 FROM transcript_claims tc
			WHERE tc.run_id = ? AND tc.kind = 'factual' AND tc.support_status = 'supported'
				AND EXISTS (SELECT 1 FROM episode_citations ec WHERE ec.claim_id = tc.id)
			LIMIT 1
		`).get(runId));
		const hasInvalidGrounding = Boolean(this.database.prepare(`
			SELECT 1
			FROM transcript_claims tc
			WHERE tc.run_id = ? AND (
				(tc.kind = 'factual' AND (
					tc.support_status <> 'supported'
					OR NOT EXISTS (SELECT 1 FROM episode_citations ec WHERE ec.claim_id = tc.id)
				))
				OR EXISTS (
					SELECT 1
					FROM episode_citations ec
					LEFT JOIN episode_evidence_snapshots ees ON ees.id = ec.snapshot_id
					WHERE ec.claim_id = tc.id AND (
						ees.id IS NULL OR ees.run_id <> tc.run_id
						OR ec.excerpt <> trim(ec.excerpt)
						OR length(ec.excerpt) < 5 OR length(ec.excerpt) > 600
						OR instr(ees.body, ec.excerpt) = 0
					)
				)
			)
			LIMIT 1
		`).get(runId));
		if (!hasEvidence || !hasGroundedTranscript || hasInvalidGrounding) throw new ChatEpisodeUnavailableError();
		return {title: run.title};
	}

	private requireRow(turnId: string): ChatTurnRow {
		const row = this.database.prepare('SELECT * FROM chat_turns WHERE id = ?').get(turnId) as ChatTurnRow | undefined;
		if (!row) throw new ChatStateError('Chat turn not found');
		return row;
	}

	private requireOwnedRunningTurn(turnId: string, workerId: string, timestamp: string): ClaimedChatTurn {
		const row = this.requireRow(turnId);
		if (
			row.state !== 'running'
			|| row.lease_owner !== workerId
			|| !row.lease_expires_at
			|| row.lease_expires_at <= timestamp
		) throw new ChatStateError('Worker does not own a current chat lease');
		return this.claimed(row);
	}

	private listProviderCalls(turnId: string, attemptNumber: number): ChatProviderCallRow[] {
		return this.database.prepare(`
			SELECT id, turn_id, attempt_number, stage, model, status, safe_outcome, worker_id
			FROM chat_provider_calls
			WHERE turn_id = ? AND attempt_number = ?
			ORDER BY stage
		`).all(turnId, attemptNumber) as ChatProviderCallRow[];
	}

	#assertProviderReservationCurrent(reservation: ChatProviderStageReservation): void {
		const timestamp = this.now();
		const current = this.requireOwnedRunningTurn(reservation.turnId, reservation.workerId, timestamp);
		if (current.runId !== reservation.runId) throw new ChatStateError('Provider-call reservation belongs to another episode');
		if (current.attemptCount !== reservation.attemptNumber) throw new ChatStateError('Provider-call reservation belongs to another attempt');
		const row = this.database.prepare(`
			SELECT id, turn_id, attempt_number, stage, model, status, safe_outcome, worker_id
			FROM chat_provider_calls
			WHERE id = ? AND turn_id = ? AND attempt_number = ? AND stage = ? AND model = ?
		`).get(
			reservation.id,
			reservation.turnId,
			reservation.attemptNumber,
			reservation.stage,
			reservation.model,
		) as ChatProviderCallRow | undefined;
		if (!row || row.worker_id !== reservation.workerId || row.status !== 'reserved') {
			throw new ChatStateError('Provider-call reservation is not current');
		}
	}

	private hasUnresolvedProviderCall(turnId: string, attemptNumber: number): boolean {
		return Boolean(this.database.prepare(`
			SELECT 1 FROM chat_provider_calls
			WHERE turn_id = ? AND attempt_number = ? AND status <> 'finalized'
			LIMIT 1
		`).get(turnId, attemptNumber));
	}

	private hasProviderCallLifecycle(turnId: string): boolean {
		return Boolean(this.database.prepare(`
			SELECT 1 FROM chat_provider_calls
			WHERE turn_id = ?
			LIMIT 1
		`).get(turnId));
	}

	private assertProviderCallsReadyForPublication(
		turnId: string,
		attemptNumber: number,
		workerId: string,
		kind: 'answer' | 'refusal',
	): void {
		const calls = this.listProviderCalls(turnId, attemptNumber);
		const draft = calls.find(call => call.stage === 'draft');
		const support = calls.find(call => call.stage === 'support');
		const owned = calls.every(call => call.worker_id === workerId);
		const ready = owned && (kind === 'refusal'
			? calls.length === 1 && draft?.status === 'finalized' && draft.safe_outcome === 'draft_refusal'
			: calls.length === 2
				&& draft?.status === 'finalized' && draft.safe_outcome === 'draft_answer_validated'
				&& support?.status === 'finalized' && support.safe_outcome === 'support_validated');
		if (!ready) throw new ChatStateError('Provider-call lifecycle is not ready for publication');
	}

	private claimed(row: ChatTurnRow): ClaimedChatTurn {
		return {
			id: row.id,
			runId: row.run_id,
			question: row.question,
			state: row.state,
			attemptCount: row.attempt_count,
			leaseOwner: row.lease_owner || undefined,
			leaseExpiresAt: row.lease_expires_at || undefined,
		};
	}

	private finishAttempt(
		turn: ClaimedChatTurn,
		outcome: ChatAttempt['outcome'],
		timestamp: string,
		errorCode?: string,
		errorMessage?: string,
	): void {
		this.database.prepare(`
			UPDATE chat_attempts
			SET finished_at = ?, outcome = ?, error_code = ?, error_message = ?
			WHERE turn_id = ? AND attempt_number = ? AND outcome = 'running'
		`).run(timestamp, outcome, errorCode ?? null, errorMessage ?? null, turn.id, turn.attemptCount);
	}

	private insertRetryRequest(turnId: string, idempotencyKey: string, attemptNumber: number, timestamp: string): void {
		this.database.prepare(`
			INSERT INTO chat_retry_requests (turn_id, idempotency_key, requested_attempt_number, created_at)
			VALUES (?, ?, ?, ?)
		`).run(turnId, idempotencyKey, attemptNumber, timestamp);
	}

	private recoverStaleWithinTransaction(timestamp: string): number {
		const rows = this.database.prepare(`
			SELECT * FROM chat_turns
			WHERE state = 'running' AND lease_expires_at <= ?
			ORDER BY created_at, id
		`).all(timestamp) as ChatTurnRow[];
		for (const row of rows) {
			const current = this.claimed(row);
			const unresolvedProviderCall = this.hasUnresolvedProviderCall(row.id, current.attemptCount);
			const providerLifecycleStarted = this.hasProviderCallLifecycle(row.id);
			const retryable = !unresolvedProviderCall && current.attemptCount < chatLimits.maximumAttempts;
			const code = unresolvedProviderCall ? providerOutcomeUnconfirmed.code : 'CHAT_ATTEMPT_OUTCOME_UNKNOWN';
			const message = unresolvedProviderCall
				? providerOutcomeUnconfirmed.message
				: 'The prior follow-up attempt ended without a validated result';
			this.database.prepare(`
				UPDATE chat_turns
				SET state = 'failed', lease_owner = NULL, lease_expires_at = NULL,
					episode_lock = ?,
					error_code = ?, error_message = ?,
					retryable = ?, updated_at = ?, completed_at = ?
				WHERE id = ?
			`).run(providerLifecycleStarted ? 1 : 0, code, message, retryable ? 1 : 0, timestamp, timestamp, row.id);
			this.finishAttempt(current, 'recovered', timestamp, code, message);
		}
		return rows.length;
	}

	private failUnavailableQueuedTurn(row: ChatTurnRow, timestamp: string): void {
		const providerLifecycleStarted = this.hasProviderCallLifecycle(row.id);
		this.database.prepare(`
			UPDATE chat_turns
			SET state = 'failed', error_code = 'EPISODE_NOT_AVAILABLE',
				error_message = 'Follow-up chat requires a completed grounded episode',
				episode_lock = ?, retryable = 0, updated_at = ?, completed_at = ?
			WHERE id = ?
		`).run(providerLifecycleStarted ? 1 : 0, timestamp, timestamp, row.id);
	}

	private failExhaustedQueuedTurn(row: ChatTurnRow, timestamp: string): void {
		const providerLifecycleStarted = this.hasProviderCallLifecycle(row.id);
		this.database.prepare(`
			UPDATE chat_turns
			SET state = 'failed', error_code = 'CHAT_ATTEMPT_LIMIT_REACHED',
				error_message = 'The follow-up attempt limit has been reached',
				episode_lock = ?, retryable = 0, updated_at = ?, completed_at = ?
			WHERE id = ?
		`).run(providerLifecycleStarted ? 1 : 0, timestamp, timestamp, row.id);
	}
}

export const chatStore = new ChatStore();
