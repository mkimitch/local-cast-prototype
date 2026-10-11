import type {ServerConfig} from '../config';
import type {GenerationJobStore} from './generationJobStore';
import type {GenerationProcessor} from './generationProcessor';
import {GenerationError} from './types';
import type {GenerationJob} from './types';

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

export class GenerationWorker {
	private stopping = false;
	private currentJob?: GenerationJob;
	private currentAbort?: AbortController;
	private loopAbort?: AbortController;

	constructor(
		private readonly config: ServerConfig,
		private readonly jobs: GenerationJobStore,
		private readonly processor: GenerationProcessor,
	) {}

	async runOnce(): Promise<boolean> {
		if (this.stopping) return false;
		const job = this.jobs.claimNext(this.config.workerId, this.config.leaseMs);
		if (!job) return false;

		this.currentJob = job;
		this.currentAbort = new AbortController();
		let leaseLost = false;
		const heartbeat = setInterval(() => {
			try {
				this.jobs.renewLease(job.id, this.config.workerId, this.config.leaseMs);
			} catch {
				leaseLost = true;
				this.currentAbort?.abort();
			}
		}, Math.max(250, Math.floor(this.config.leaseMs / 3)));
		heartbeat.unref();
		try {
			await this.processor.process(job, this.config.workerId, this.currentAbort.signal);
		} catch (error) {
			const current = this.jobs.get(job.id);
			const stillOwned = current?.state === 'running' && current.leaseOwner === this.config.workerId;
			if (this.currentAbort.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
				if (stillOwned) this.jobs.interrupt(job.id, this.config.workerId);
				if (leaseLost) console.error(`[generation-job:${job.id}] LEASE_LOST`);
			} else if (error instanceof GenerationError && stillOwned) {
				this.jobs.fail(job.id, this.config.workerId, {
					code: error.code,
					message: error.safeMessage,
					retryable: error.retryable,
					diagnostic: error.diagnostic,
				});
			} else if (stillOwned) {
				this.jobs.fail(job.id, this.config.workerId, {
					code: 'GENERATION_FAILED',
					message: 'Generation failed safely; use the diagnostic reference for server review',
					retryable: true,
				});
				console.error(`[generation-job:${job.id}] GENERATION_FAILED`);
			}
		} finally {
			clearInterval(heartbeat);
			this.currentJob = undefined;
			this.currentAbort = undefined;
		}

		return true;
	}

	async start(): Promise<void> {
		this.jobs.recoverStale();
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
		this.currentAbort?.abort();
	}

	get activeJobId(): string | undefined {
		return this.currentJob?.id;
	}
}
