import type {ServerConfig} from '../config';
import {approvedChatModel, type ChatProviderCallFinalOutcome, type ChatProviderCallStage, type ClaimedChatTurn} from '../chat/types';
import type {ChatProcessor} from '../jobs/chatProcessor';
import {GenerationError} from '../jobs/types';
import {enterReservedChatProviderStage, type ChatStore} from '../services/chatStore';

const wait = (milliseconds: number, signal: AbortSignal): Promise<void> => {
	if (milliseconds === 0) return Promise.resolve();
	return new Promise((resolve, reject) => {
		const complete = () => {
			signal.removeEventListener('abort', abort);
			resolve();
		};
		const timeout = setTimeout(complete, milliseconds);
		const abort = () => {
			clearTimeout(timeout);
			signal.removeEventListener('abort', abort);
			reject(new DOMException('Worker stopped', 'AbortError'));
		};
		signal.addEventListener('abort', abort, {once: true});
	});
};

export class DeterministicFakeChatProcessor implements ChatProcessor {
	constructor(
		private readonly config: ServerConfig,
		private readonly chats: ChatStore,
	) {}

	async process(turn: ClaimedChatTurn, workerId: string, signal: AbortSignal): Promise<void> {
		await wait(this.config.fakePhaseDelayMs, signal);
		const normalized = turn.question.toLowerCase();
		if (normalized.includes('ambiguous retry fixture') && turn.attemptCount === 1) {
			const reservation = this.chats.reserveProviderCall(turn.id, workerId, 'draft', approvedChatModel);
			const lifecycle = enterReservedChatProviderStage(reservation, {
				runId: turn.runId,
				turnId: turn.id,
				attemptNumber: turn.attemptCount,
				workerId,
			}, 'draft', approvedChatModel);
			lifecycle.record({kind: 'ambiguous', stage: 'draft', outcome: 'timeout'});
			throw new GenerationError('SYNTHETIC_CHAT_TIMEOUT', 'The synthetic text provider timed out', true);
		}
		if (normalized.includes('retry fixture') && turn.attemptCount === 1) {
			throw new GenerationError('SYNTHETIC_CHAT_TIMEOUT', 'The synthetic text provider timed out', true);
		}

		const context = this.chats.loadGroundingContext(turn.id);
		if (normalized.includes('outside this episode')) {
			this.finalizeSyntheticStage(turn.id, turn.attemptCount, workerId, 'draft', 'draft_refusal');
			this.chats.completeRefusal(turn.id, workerId);
			return;
		}

		const grounded = context.transcript.find(segment => segment.kind === 'factual' && segment.citations.length > 0);
		if (!grounded) throw new GenerationError('CHAT_EVIDENCE_UNAVAILABLE', 'The synthetic episode has no supported factual transcript', false);
		this.finalizeSyntheticStage(turn.id, turn.attemptCount, workerId, 'draft', 'draft_answer_validated');
		this.finalizeSyntheticStage(turn.id, turn.attemptCount, workerId, 'support', 'support_validated');
		this.chats.completeAnswer(turn.id, workerId, [{
			id: 'provider-authored-id-is-replaced',
			text: grounded.text,
			citations: [grounded.citations[0]!],
			supportStatus: 'supported',
		}]);
	}

	private finalizeSyntheticStage(
		turnId: string,
		attemptNumber: number,
		workerId: string,
		stage: ChatProviderCallStage,
		outcome: ChatProviderCallFinalOutcome,
	): void {
		const reservation = this.chats.reserveProviderCall(turnId, workerId, stage, approvedChatModel);
		const lifecycle = enterReservedChatProviderStage(reservation, {
			runId: this.chats.get(turnId)!.runId,
			turnId,
			attemptNumber,
			workerId,
		}, stage, approvedChatModel);
		lifecycle.record({kind: 'response', audit: {stage, model: approvedChatModel}});
		lifecycle.record({kind: 'finalize', stage, outcome});
	}
}
