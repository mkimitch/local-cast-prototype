import type {ServerConfig} from '../config';
import {OpenAiSpeechProvider, OpenAiTextProvider} from '../providers/openai';
import {episodeStore} from '../services/episodeStore';
import {synchronizeRequestSources} from '../services/episodePreparation';
import {providerCheckStore} from '../services/providerCheckStore';
import {GenerationError} from './types';
import type {GenerationJob} from './types';
import type {GenerationJobStore} from './generationJobStore';
import type {EpisodeEvidence, PublishedAudio} from '../episodes/types';
import type {ProviderCheckStore} from '../services/providerCheckStore';

export const recordSpeechProviderSuccess = (
	audio: Pick<PublishedAudio, 'liveRequestPerformed'>,
	config: ServerConfig,
	checks: Pick<ProviderCheckStore, 'recordLive'> = providerCheckStore,
): void => {
	if (audio.liveRequestPerformed) checks.recordLive('speech', config);
};

export interface GenerationProcessor {
	process(job: GenerationJob, workerId: string, signal: AbortSignal): Promise<void>;
}

export const assertOpenAiEvidenceAuthorized = (evidence: EpisodeEvidence[]): void => {
	if (evidence.some(item => item.kind === 'feed' && item.networkScope !== 'public')) {
		throw new GenerationError(
			'CLOUD_PROCESSING_NOT_AUTHORIZED',
			'Private or unverified feed material is not authorized for OpenAI processing',
			false,
		);
	}
};

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

		const request = episodeStore.getRequest(job.payload.requestId);
		if (!request || request.runId !== job.runId) throw new GenerationError('INVALID_JOB_PAYLOAD', 'The persisted generation request is invalid', false);
		if (episodeStore.listEvidence(job.runId).length === 0) await synchronizeRequestSources(request.id, signal);
		this.jobs.updatePhase(job.id, workerId, 'selecting', this.config.leaseMs);
		const evidence = episodeStore.finalizeEvidence(request.id, job.runId);
		assertOpenAiEvidenceAuthorized(evidence);

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
			audio = await this.speech.render(job.runId, generated.script, signal, () => {
				this.jobs.renewLease(job.id, workerId, this.config.leaseMs);
			});
			this.jobs.renewLease(job.id, workerId, this.config.leaseMs);
			recordSpeechProviderSuccess(audio, this.config);
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
