import type {EpisodeEvidence} from '../episodes/types';

export const chatLimits = {
	questionCharacters: 1_000,
	providerRequestBytes: 131_072,
	providerStructuralHeadroomTokens: 8_192,
	providerConservativeInputTokens: 139_264,
	maximumClaims: 8,
	claimCharacters: 1_200,
	maximumCitationsPerClaim: 4,
	excerptCharacters: 600,
	maximumOutputTokens: 2_500,
	supportOutputTokens: 750,
	maximumAttempts: 2,
} as const;

export const approvedChatModel = 'gpt-5.4-mini-2026-03-17' as const;

export type ChatProviderCallStage = 'draft' | 'support';

export type ChatProviderCallFinalOutcome =
	| 'draft_refusal'
	| 'draft_answer_validated'
	| 'support_validated'
	| 'support_rejected'
	| 'invalid_response'
	| 'invalid_citations'
	| 'provider_rejected'
	| 'response_too_large'
	| 'empty_response';

export type ChatProviderCallAmbiguousOutcome = 'timeout' | 'network_failure' | 'cancelled';

export interface ChatProviderCallAudit {
	stage: ChatProviderCallStage;
	model: typeof approvedChatModel;
	inputTokens?: number;
	cachedInputTokens?: number;
	outputTokens?: number;
	reasoningOutputTokens?: number;
	providerRequestId?: string;
}

export type ChatProviderCallEvent =
	| {kind: 'response'; audit: ChatProviderCallAudit}
	| {kind: 'finalize'; stage: ChatProviderCallStage; outcome: ChatProviderCallFinalOutcome}
	| {kind: 'ambiguous'; stage: ChatProviderCallStage; outcome: ChatProviderCallAmbiguousOutcome};

export interface ChatProviderStageIdentity {
	runId: string;
	turnId: string;
	attemptNumber: number;
	workerId: string;
}

export interface ChatProviderStageReservation extends ChatProviderStageIdentity {
	id: string;
	stage: ChatProviderCallStage;
	model: typeof approvedChatModel;
}

export interface ChatTranscriptCitation {
	snapshotId: string;
	excerpt: string;
}

export interface ChatTranscriptSegment {
	id: string;
	kind: 'factual' | 'transition';
	text: string;
	citations: ChatTranscriptCitation[];
}

export interface ChatGroundingContext {
	turnId: string;
	runId: string;
	episodeTitle: string;
	question: string;
	transcript: ChatTranscriptSegment[];
	evidence: EpisodeEvidence[];
}

export interface ChatAnswerCitation {
	snapshotId: string;
	excerpt: string;
}

export interface SupportedChatClaim {
	id: string;
	text: string;
	citations: ChatAnswerCitation[];
	supportStatus: 'supported';
}

export interface DraftChatClaim {
	id: string;
	text: string;
	citations: ChatAnswerCitation[];
}

export type ChatProviderDraftResult =
	| {kind: 'answer'; claims: DraftChatClaim[]}
	| {kind: 'refusal'; refusalCode: 'EVIDENCE_INSUFFICIENT'};

export type ChatProviderResult =
	| {kind: 'answer'; claims: SupportedChatClaim[]}
	| {kind: 'refusal'; refusalCode: 'EVIDENCE_INSUFFICIENT'};

export type ChatTurnState = 'queued' | 'running' | 'answered' | 'refused' | 'failed';

export interface ClaimedChatTurn {
	id: string;
	runId: string;
	question: string;
	state: ChatTurnState;
	attemptCount: number;
	leaseOwner?: string;
	leaseExpiresAt?: string;
}
