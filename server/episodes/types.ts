import type {EpisodeMode} from '../../src/types';

export interface EpisodeEvidence {
	id: string;
	kind: 'note' | 'feed';
	title: string;
	body: string;
	author?: string;
	originalUrl?: string;
	publishedAt?: string;
	contentSha256: string;
}

export interface EpisodeRequestSnapshot {
	id: string;
	runId: string;
	stationId: string;
	stationRevision: number;
	stationName: string;
	topicInstruction: string;
	mode: EpisodeMode;
	requestHash: string;
	requestedAt: string;
}

export interface GeneratedCitation {
	snapshotId: string;
	excerpt: string;
}

export interface GeneratedSegment {
	id: string;
	kind: 'factual' | 'transition';
	text: string;
	citations: GeneratedCitation[];
	supportStatus: 'supported' | 'not_required';
}

export interface GeneratedSection {
	id: string;
	title: string;
	type: 'intro' | 'news_summary' | 'deep_dive' | 'outro';
	segments: GeneratedSegment[];
}

export interface PublishedAudio {
	id: string;
	storageFilename: string;
	durationMs: number;
	byteLength: number;
	sha256: string;
	mimeType: 'audio/mpeg';
	validatedAt: string;
	provider: 'OpenAI' | 'Deterministic test speech';
	model: string;
	voice: string;
}
