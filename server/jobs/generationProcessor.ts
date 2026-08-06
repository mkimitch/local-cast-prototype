import type {ServerConfig} from '../config';
import {OpenAiSpeechProvider, OpenAiTextProvider} from '../providers/openai';
import {episodeStore} from '../services/episodeStore';
import {providerCheckStore} from '../services/providerCheckStore';
import {GenerationError} from './types';
import type {GenerationJob} from './types';
import type {GenerationJobStore} from './generationJobStore';

export interface GenerationProcessor {
	process(job: GenerationJob, workerId: string, signal: AbortSignal): Promise<void>;
}

class UnconfiguredGenerationProcessor implements GenerationProcessor {
	async process(): Promise<void> {
		throw new GenerationError('PROVIDER_NOT_CONFIGURED', 'Text and speech providers are not configured', false);
	}
}

class OpenAiGenerationProcessor implements GenerationProcessor {
	private readonly text: OpenAiTextProvider;
	private readonly speech: OpenAiSpeechProvider;

	constructor(
		private readonly config: ServerConfig,
		private readonly jobs: GenerationJobStore,
		apiKey: string,
	) {
		this.text = new OpenAiTextProvider(apiKey, config.openAiTextModel);
		this.speech = new OpenAiSpeechProvider(apiKey, config);
	}

	async process(job: GenerationJob, workerId: string, signal: AbortSignal): Promise<void> {
		if (job.payload.version !== 2) {
			throw new GenerationError('INVALID_JOB_PAYLOAD', 'This generation request is not supported by the configured provider', false);
		}

		this.jobs.updatePhase(job.id, workerId, 'selecting', this.config.leaseMs);
		const request = episodeStore.getRequest(job.payload.requestId);
		if (!request || request.runId !== job.runId) throw new GenerationError('INVALID_JOB_PAYLOAD', 'The persisted generation request is invalid', false);
		const evidence = episodeStore.finalizeEvidence(request.id, job.runId);

		this.jobs.updatePhase(job.id, workerId, 'drafting', this.config.leaseMs);
		let generated;
		try {
			generated = await this.text.generateEpisode(request, evidence, signal, () => {
				this.jobs.updatePhase(job.id, workerId, 'validating', this.config.leaseMs);
			});
			providerCheckStore.recordLive('text', this.config);
		} catch (error) {
			if (error instanceof GenerationError) providerCheckStore.recordFailure('text', this.config, `Live request failed: ${error.code}`);
			throw error;
		}

		this.jobs.updatePhase(job.id, workerId, 'rendering_audio', this.config.leaseMs);
		let audio;
		try {
			audio = await this.speech.render(job.runId, generated.narration, signal);
			providerCheckStore.recordLive('speech', this.config);
		} catch (error) {
			if (error instanceof GenerationError) providerCheckStore.recordFailure('speech', this.config, `Live request failed: ${error.code}`);
			throw error;
		}

		this.jobs.complete(job.id, workerId, () => episodeStore.publishEpisode({
			runId: job.runId,
			request,
			sections: generated.sections,
			audio,
			textProvider: 'OpenAI',
			textModel: this.config.openAiTextModel,
		}));
	}
}

export const createGenerationProcessor = (config: ServerConfig, jobs: GenerationJobStore): GenerationProcessor => {
	if (config.textProvider === 'openai' && config.speechProvider === 'openai') {
		if (!config.openAiApiKey) {
			providerCheckStore.recordNotConfigured(config);
			return new UnconfiguredGenerationProcessor();
		}
		providerCheckStore.recordContract(config);
		return new OpenAiGenerationProcessor(config, jobs, config.openAiApiKey);
	}

	return new UnconfiguredGenerationProcessor();
};
