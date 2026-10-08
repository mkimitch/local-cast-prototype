import {z} from 'zod';

export const jobPhases = ['queued', 'syncing', 'selecting', 'drafting', 'validating', 'rendering_audio', 'complete', 'failed'] as const;
export const activeJobPhases = ['syncing', 'selecting', 'drafting', 'validating', 'rendering_audio'] as const;
const legacyGenerationJobPayloadSchema = z.object({
	version: z.literal(1),
	sourceIds: z.array(z.string().min(1)).max(200),
	requestedAt: z.iso.datetime(),
}).strict();

const stationGenerationJobPayloadSchema = z.object({
	version: z.literal(2),
	requestId: z.string().min(1).max(200),
	requestedAt: z.iso.datetime(),
}).strict();

export const generationJobPayloadSchema = z.discriminatedUnion('version', [
	legacyGenerationJobPayloadSchema,
	stationGenerationJobPayloadSchema,
]);

export type JobPhase = typeof jobPhases[number];
export type ActiveJobPhase = typeof activeJobPhases[number];
export type JobState = 'queued' | 'running' | 'complete' | 'failed';
export type GenerationJobPayload = z.infer<typeof generationJobPayloadSchema>;
export type ProviderStatusImpact = 'preserve' | 'failure';

export class GenerationError extends Error {
	constructor(
		public readonly code: string,
		public readonly safeMessage: string,
		public readonly retryable: boolean,
		public readonly providerStatusImpact: ProviderStatusImpact = 'preserve',
	) {
		super(safeMessage);
		this.name = 'GenerationError';
	}
}

export interface GenerationJob {
	id: string;
	runId: string;
	idempotencyKey?: string;
	payload: GenerationJobPayload;
	state: JobState;
	phase: JobPhase;
	attemptCount: number;
	leaseOwner?: string;
	leaseExpiresAt?: string;
	errorCode?: string;
	errorMessage?: string;
	failedPhase?: ActiveJobPhase;
	retryable: boolean;
	createdAt: string;
	updatedAt: string;
	startedAt?: string;
	completedAt?: string;
}

export interface JobAttempt {
	id: string;
	jobId: string;
	attemptNumber: number;
	workerId: string;
	startedAt: string;
	finishedAt?: string;
	outcome: 'running' | 'complete' | 'failed' | 'interrupted' | 'recovered';
	errorCode?: string;
	errorMessage?: string;
}

export interface JobEvent {
	id: number;
	jobId: string;
	attemptNumber?: number;
	phase: JobPhase;
	detail?: string;
	createdAt: string;
}
