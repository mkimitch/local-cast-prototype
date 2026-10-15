import {captureTrace, captureTraceGap, traceEnabled, traceRootForDatabase, withGenerationTrace} from '../debug/generationTrace';
import type {ServerConfig} from '../config';
import {OpenAiSpeechProvider, OpenAiTextProvider} from '../providers/openai';
import {OpenAiCompatibleTextProvider} from '../providers/openAiCompatible';
import {assertPiperConfiguration, PiperSpeechProvider} from '../providers/piper';
import {episodeStore} from '../services/episodeStore';
import {synchronizeRequestSources} from '../services/episodePreparation';
import {providerCheckStore, type ProviderCapability, type ProviderCheckStore} from '../services/providerCheckStore';
import {GenerationError} from './types';
import type {GenerationJob} from './types';
import type {GenerationJobStore} from './generationJobStore';
import type {EpisodeEvidence, GeneratedEpisodeScript, GeneratedSection, PublishedAudio} from '../episodes/types';
import {editorialLengthWarningForScript} from '../episodes/validation';
import {openAiCredentialStore} from '../credentials/index';
import {configWithResolvedOpenAiCredential, type OpenAiCredentialStore} from '../credentials/openAiCredentialStore';

export const recordSpeechProviderSuccess = (
	audio: Pick<PublishedAudio, 'liveRequestPerformed'>,
	config: ServerConfig,
	checks: Pick<ProviderCheckStore, 'recordLive'> = providerCheckStore,
): void => {
	if (audio.liveRequestPerformed) checks.recordLive('speech', config);
};

export const recordTextProviderFailure = (
	error: unknown,
	config: ServerConfig,
	checks: Pick<ProviderCheckStore, 'recordFailure'> = providerCheckStore,
): void => {
	if (error instanceof GenerationError && error.providerStatusImpact === 'failure') {
		checks.recordFailure('text', config, `Live request failed: ${error.code}`);
	}
};

export const recordSpeechProviderFailure = (
	error: unknown,
	config: ServerConfig,
	checks: Pick<ProviderCheckStore, 'recordFailure'> = providerCheckStore,
): void => {
	if (error instanceof GenerationError && error.providerStatusImpact === 'failure') {
		checks.recordFailure('speech', config, `Live request failed: ${error.code}`);
	}
};

export interface GenerationProcessor {
	process(job: GenerationJob, workerId: string, signal: AbortSignal): Promise<void>;
}

interface TextGenerationProvider {
	generateEpisode(
		request: Parameters<OpenAiTextProvider['generateEpisode']>[0],
		evidence: EpisodeEvidence[],
		signal: AbortSignal,
		onDraftComplete?: () => void,
	): Promise<{script: GeneratedEpisodeScript; sections: GeneratedSection[]; narration: string}>;
}

interface SpeechGenerationProvider {
	render: OpenAiSpeechProvider['render'];
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

export const assertGenerationEvidenceAuthorized = (config: ServerConfig, evidence: EpisodeEvidence[]): void => {
	if (config.textProvider === 'openai' || config.speechProvider === 'openai') {
		assertOpenAiEvidenceAuthorized(evidence);
	}
};

class UnconfiguredGenerationProcessor implements GenerationProcessor {
	async process(): Promise<void> {
		throw new GenerationError('PROVIDER_NOT_CONFIGURED', 'Text and speech providers are not configured', false);
	}
}

class ConfiguredGenerationProcessor implements GenerationProcessor {

	constructor(
		private readonly config: ServerConfig,
		private readonly jobs: GenerationJobStore,
		private readonly text: TextGenerationProvider,
		private readonly speech: SpeechGenerationProvider,
		private readonly textProviderName: 'OpenAI' | 'Ollama' | 'LM Studio',
		private readonly textModel: string,
		private readonly checks: Pick<ProviderCheckStore, 'recordFailure' | 'recordLive'>,
	) {}

	async process(job: GenerationJob, workerId: string, signal: AbortSignal): Promise<void> {
		if (job.payload.version !== 2) {
			throw new GenerationError('INVALID_JOB_PAYLOAD', 'This generation request is not supported by the configured provider', false);
		}

		const request = episodeStore.getRequest(job.payload.requestId);
		if (!request || request.runId !== job.runId) throw new GenerationError('INVALID_JOB_PAYLOAD', 'The persisted generation request is invalid', false);
		return withGenerationTrace(traceRootForDatabase(this.config.databasePath), request.stationId, {jobId: job.id, runId: job.runId, attemptNumber: job.attemptCount}, [this.config.openAiApiKey ?? ''], async () => {
			captureTrace('request', 'immutable generation_requests row', 'raw', request);
			if (traceEnabled()) {
				try {
					captureTrace('request.sources', 'generation_request_sources', 'raw', episodeStore.listRequestSources(request.id));
					captureTrace('request.notes', 'immutable generation_request_notes', 'raw', episodeStore.listRequestNotes(request.id));
				} catch { captureTraceGap('request.details', 'snapshot inspection', 'snapshot_read_failed'); }
			}
			captureTrace('stage', 'generation processor', 'derived', 'syncing');
			if (episodeStore.listEvidence(job.runId).length === 0) await synchronizeRequestSources(request.id, signal);
			this.jobs.updatePhase(job.id, workerId, 'selecting', this.config.leaseMs);
			captureTrace('stage', 'generation processor', 'derived', 'selecting');
			const evidence = episodeStore.finalizeEvidence(request.id, job.runId);
			captureTrace('evidence', 'committed episode_evidence_snapshots in selection order', 'raw', evidence);
			assertGenerationEvidenceAuthorized(this.config, evidence);

			this.jobs.updatePhase(job.id, workerId, 'drafting', this.config.leaseMs);
			captureTrace('stage', 'generation processor', 'derived', 'drafting');
			let generated;
			try {
				generated = await this.text.generateEpisode(request, evidence, signal, () => {
					this.jobs.updatePhase(job.id, workerId, 'validating', this.config.leaseMs);
					captureTrace('stage', 'generation processor', 'derived', 'validating');
				});
				this.checks.recordLive('text', this.config);
			} catch (error) {
				recordTextProviderFailure(error, this.config, this.checks);
				throw error;
			}
			const editorialLengthWarning = editorialLengthWarningForScript(request, evidence, generated.script);
			if (editorialLengthWarning) this.jobs.recordEditorialLengthWarning(job.id, workerId, editorialLengthWarning);

			this.jobs.updatePhase(job.id, workerId, 'rendering_audio', this.config.leaseMs);
			captureTrace('stage', 'generation processor', 'derived', 'rendering_audio');
			let audio;
			try {
				audio = await this.speech.render(job.runId, generated.script, signal, () => {
					this.jobs.renewLease(job.id, workerId, this.config.leaseMs);
				});
				this.jobs.renewLease(job.id, workerId, this.config.leaseMs);
				recordSpeechProviderSuccess(audio, this.config, this.checks);
			} catch (error) {
				recordSpeechProviderFailure(error, this.config, this.checks);
				throw error;
			}

			captureTrace('stage', 'generation processor', 'derived', 'publishing');
			this.jobs.complete(job.id, workerId, () => episodeStore.publishEpisode({
				runId: job.runId,
				request,
				sections: generated.sections,
				audio,
				textProvider: this.textProviderName,
				textModel: this.textModel,
			}));
			captureTrace('stage', 'committed job and episode transaction', 'derived', 'published');
		});
	}
}

type ProviderRuntimeChecks = Pick<ProviderCheckStore, 'recordContract' | 'recordFailure' | 'recordLive' | 'recordNotConfigured'>;

const configuredGenerationProcessor = (
	config: ServerConfig,
	jobs: GenerationJobStore,
	checks: ProviderRuntimeChecks,
): GenerationProcessor | undefined => {
	let text: TextGenerationProvider | undefined;
	let textProviderName: 'OpenAI' | 'Ollama' | 'LM Studio' | undefined;
	let textModel: string | undefined;
	if (config.textProvider === 'openai' && config.openAiApiKey) {
		text = new OpenAiTextProvider(config.openAiApiKey, config.openAiTextModel);
		textProviderName = 'OpenAI';
		textModel = config.openAiTextModel;
	} else if (config.textProvider === 'ollama' && config.ollamaBaseUrl && config.ollamaTextModel) {
		text = new OpenAiCompatibleTextProvider('Ollama', config.ollamaBaseUrl, config.ollamaTextModel);
		textProviderName = 'Ollama';
		textModel = config.ollamaTextModel;
	} else if (config.textProvider === 'lm_studio' && config.lmStudioBaseUrl && config.lmStudioTextModel) {
		text = new OpenAiCompatibleTextProvider('LM Studio', config.lmStudioBaseUrl, config.lmStudioTextModel);
		textProviderName = 'LM Studio';
		textModel = config.lmStudioTextModel;
	}

	let speech: SpeechGenerationProvider | undefined;
	if (config.speechProvider === 'openai' && config.openAiApiKey) {
		speech = new OpenAiSpeechProvider(config.openAiApiKey, config);
	} else if (config.speechProvider === 'piper' && config.piperExecutable && config.piperModelPath) {
		try {
			assertPiperConfiguration(config.piperExecutable, config.piperModelPath);
			speech = new PiperSpeechProvider(config);
		} catch {
			// An unsafe or unavailable configured executable/model is categorically not configured.
		}
	}

	if (!text || !speech || !textProviderName || !textModel) {
		return undefined;
	}
	return new ConfiguredGenerationProcessor(config, jobs, text, speech, textProviderName, textModel, checks);
};

type ProviderConfigurationChecks = Pick<ProviderRuntimeChecks, 'recordContract' | 'recordNotConfigured'>;

const configuredCapabilities = (config: ServerConfig): ProviderCapability[] => {
	const capabilities: ProviderCapability[] = [];
	if ((config.textProvider === 'openai' && config.openAiApiKey)
		|| (config.textProvider === 'ollama' && config.ollamaBaseUrl && config.ollamaTextModel)
		|| (config.textProvider === 'lm_studio' && config.lmStudioBaseUrl && config.lmStudioTextModel)) {
		capabilities.push('text');
	}
	if (config.speechProvider === 'openai' && config.openAiApiKey) capabilities.push('speech');
	if (config.speechProvider === 'piper' && config.piperExecutable && config.piperModelPath) {
		try {
			assertPiperConfiguration(config.piperExecutable, config.piperModelPath);
			capabilities.push('speech');
		} catch {
			// Unsafe or unavailable Piper assets remain categorically not configured.
		}
	}
	return capabilities;
};

const refreshProviderConfiguration = (config: ServerConfig, checks: ProviderConfigurationChecks): void => {
	const configured = configuredCapabilities(config);
	const unavailable = (['text', 'speech'] as const).filter(capability => !configured.includes(capability));
	checks.recordContract(config, configured);
	checks.recordNotConfigured(config, unavailable);
};

class RuntimeCredentialGenerationProcessor implements GenerationProcessor {
	constructor(
		private readonly config: ServerConfig,
		private readonly jobs: GenerationJobStore,
		private readonly credentials: Pick<OpenAiCredentialStore, 'resolve'>,
		private readonly checks: ProviderRuntimeChecks,
	) {}

	async process(job: GenerationJob, workerId: string, signal: AbortSignal): Promise<void> {
		let effective: ServerConfig;
		try {
			effective = configWithResolvedOpenAiCredential(this.config, this.credentials);
		} catch {
			refreshProviderConfiguration({...this.config, openAiApiKey: undefined}, this.checks);
			throw new GenerationError('PROVIDER_CREDENTIAL_UNAVAILABLE', 'The stored provider credential is unavailable', false);
		}
		const processor = configuredGenerationProcessor(effective, this.jobs, this.checks);
		if (!processor) {
			refreshProviderConfiguration(effective, this.checks);
			return new UnconfiguredGenerationProcessor().process();
		}
		return processor.process(job, workerId, signal);
	}
}

export const createGenerationProcessor = (
	config: ServerConfig,
	jobs: GenerationJobStore,
	credentials: Pick<OpenAiCredentialStore, 'resolve'> = openAiCredentialStore,
	checks: ProviderRuntimeChecks = providerCheckStore,
): GenerationProcessor => {
	try {
		const effective = configWithResolvedOpenAiCredential(config, credentials);
		refreshProviderConfiguration(effective, checks);
	} catch {
		refreshProviderConfiguration({...config, openAiApiKey: undefined}, checks);
	}
	return new RuntimeCredentialGenerationProcessor(config, jobs, credentials, checks);
};
