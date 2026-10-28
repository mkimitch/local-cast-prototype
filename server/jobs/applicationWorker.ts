import type {ServerConfig} from '../config';
import type {ChatStore} from '../services/chatStore';
import type {GenerationJobStore} from './generationJobStore';
import type {GenerationProcessor} from './generationProcessor';
import {GenerationWorker} from './generationWorker';
import type {ChatProcessor} from './chatProcessor';
import {ChatWorker} from './chatWorker';

const delay = (milliseconds: number, signal: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
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

export class ApplicationWorker {
	private readonly generation: GenerationWorker;
	private readonly chat: ChatWorker;
	private stopping = false;
	private loopAbort?: AbortController;
	private preferChat = false;

	constructor(
		private readonly config: ServerConfig,
		private readonly jobs: GenerationJobStore,
		generationProcessor: GenerationProcessor,
		private readonly chats: ChatStore,
		chatProcessor: ChatProcessor,
	) {
		this.generation = new GenerationWorker(config, this.jobs, generationProcessor);
		this.chat = new ChatWorker(config, chats, chatProcessor);
	}

	async runOnce(): Promise<boolean> {
		const first = this.preferChat ? this.chat : this.generation;
		const second = this.preferChat ? this.generation : this.chat;
		this.preferChat = !this.preferChat;
		return await first.runOnce() || second.runOnce();
	}

	async start(): Promise<void> {
		this.jobs.recoverStale();
		this.chats.recoverStale();
		this.loopAbort = new AbortController();
		try {
			while (!this.stopping) {
				const worked = await this.runOnce();
				if (!worked && !this.stopping) {
					try {
						await delay(this.config.workerPollMs, this.loopAbort.signal);
					} catch {
						// Stop requested while idle.
					}
				}
			}
		} finally {
			this.loopAbort = undefined;
		}
	}

	async stop(): Promise<void> {
		this.stopping = true;
		this.loopAbort?.abort();
		await this.generation.stop();
		await this.chat.stop();
	}
}
