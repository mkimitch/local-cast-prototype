import type {ServerConfig} from '../config';
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

export const createGenerationProcessor = (_config: ServerConfig, _jobs: GenerationJobStore): GenerationProcessor => (
	new UnconfiguredGenerationProcessor()
);
