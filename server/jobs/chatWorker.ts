import type {ServerConfig} from '../config';
import type {ChatStore} from '../services/chatStore';
import type {ClaimedChatTurn} from '../chat/types';
import type {ChatProcessor} from './chatProcessor';
import {GenerationError} from './types';

export class ChatWorker {
	private stopping = false;
	private currentTurn?: ClaimedChatTurn;
	private currentAbort?: AbortController;

	constructor(
		private readonly config: ServerConfig,
		private readonly chats: ChatStore,
		private readonly processor: ChatProcessor,
	) {}

	async runOnce(): Promise<boolean> {
		if (this.stopping) return false;
		const turn = this.chats.claimNext(this.config.workerId, this.config.leaseMs);
		if (!turn) return false;

		this.currentTurn = turn;
		this.currentAbort = new AbortController();
		let leaseLost = false;
		const heartbeat = setInterval(() => {
			try {
				this.chats.renewLease(turn.id, this.config.workerId, this.config.leaseMs);
			} catch {
				leaseLost = true;
				this.currentAbort?.abort();
			}
		}, Math.max(250, Math.floor(this.config.leaseMs / 3)));
		heartbeat.unref();

		try {
			await this.processor.process(turn, this.config.workerId, this.currentAbort.signal);
		} catch (error) {
			const stillOwned = this.chats.isOwnedRunning(turn.id, this.config.workerId);
			if (this.currentAbort.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
				if (stillOwned) this.chats.interrupt(turn.id, this.config.workerId);
				if (leaseLost) console.error(`[chat-turn:${turn.id}] LEASE_LOST`);
			} else if (error instanceof GenerationError && stillOwned) {
				this.chats.fail(turn.id, this.config.workerId, {
					code: error.code,
					message: error.safeMessage,
					retryable: error.retryable,
				});
			} else if (stillOwned) {
				this.chats.fail(turn.id, this.config.workerId, {
					code: 'CHAT_FAILED',
					message: 'The follow-up request failed safely; retry when the provider is available',
					retryable: true,
				});
				console.error(`[chat-turn:${turn.id}] CHAT_FAILED`);
			}
		} finally {
			clearInterval(heartbeat);
			this.currentTurn = undefined;
			this.currentAbort = undefined;
		}

		return true;
	}

	async stop(): Promise<void> {
		this.stopping = true;
		this.currentAbort?.abort();
	}

	get activeTurnId(): string | undefined {
		return this.currentTurn?.id;
	}
}
