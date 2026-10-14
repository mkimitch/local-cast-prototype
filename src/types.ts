export type SourceType = 'rss' | 'manual_topic';
export type SourceStatus = 'healthy' | 'error' | 'syncing';
export type SourceSyncStatus = 'success' | 'error';
export type FeedNetworkScope = 'public' | 'private' | 'unknown';

export const unicodeCodePointLength = (value: string): number => Array.from(value).length;

export const isWellFormedLocalCastText = (value: string): boolean => {
  if (value.includes('\0') || value.includes('\ufffd')) return false;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
};

export const isBoundedLocalCastText = (value: string, minimum: number, maximum: number): boolean => (
  isWellFormedLocalCastText(value)
  && unicodeCodePointLength(value) >= minimum
  && unicodeCodePointLength(value) <= maximum
);

export interface Source {
  id: string;
  type: SourceType;
  name: string;
  url?: string;
  description?: string;
  category?: string;
  isActive: boolean;
  status?: SourceStatus;
  addedAt: string;
  lastSyncedAt?: string;
  lastSyncStatus?: SourceSyncStatus;
  lastSyncError?: string;
  consecutiveSyncFailures?: number;
  nextSyncAfter?: string;
  lastCheckedAt?: string;
  lastChangedAt?: string;
  feedEtag?: string;
  feedLastModified?: string;
  feedValidatorUrl?: string;
  feedNetworkScope?: FeedNetworkScope;
  feedUrlInvalid?: boolean;
  lastSyncErrorCode?: string;
  itemCount?: number;
}

export interface SourceItem {
  id: string;
  sourceId: string;
  title: string;
  content: string;
  url?: string;
  author?: string;
  publishedAt?: string;
  gatheredAt: string;
  networkScope?: FeedNetworkScope;
}

export interface MaterialSearchResult {
  kind: 'feed' | 'note';
  id: string;
  sourceId?: string;
  sourceName?: string;
  title: string;
  excerpt: string;
  author?: string;
  url?: string;
  publishedAt?: string;
  updatedAt?: string;
  rank: number;
}

export interface Note {
  id: string;
  revision: number;
  title: string;
  body: string;
  author?: string;
  originalUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export type EpisodeMode = 'brief' | 'deep';
export type BriefLengthPreset = 'compact' | 'standard';
export const defaultBriefLengthPreset: BriefLengthPreset = 'standard';

export interface Station {
  id: string;
  revision: number;
  name: string;
  topicInstruction: string;
  defaultMode: EpisodeMode;
  briefLengthPreset: BriefLengthPreset;
  noteIds: string[];
  sourceIds: string[];
  createdAt: string;
  updatedAt: string;
}

export type RunStatus = 'queued' | 'syncing' | 'selecting' | 'drafting' | 'validating' | 'rendering_audio' | 'complete' | 'failed';

export interface BriefingSection {
  id: string;
  title: string;
  type: 'intro' | 'news_summary' | 'deep_dive' | 'outro';
  spokenText: string;
  sourceItemIds: string[];
  importanceScore: number;
  followUpPrompts: string[];
  segments?: TranscriptSegment[];
}

export interface TranscriptCitation {
  snapshotId: string;
  title: string;
  sourceName: string;
  kind: 'note' | 'feed';
  excerpt: string;
  author?: string;
  originalUrl?: string;
  publishedAt?: string;
}

export interface TranscriptSegment {
  id: string;
  kind: 'factual' | 'transition';
  text: string;
  supportStatus: 'supported' | 'not_required';
  speakerRole: 'host';
  speakerLabel?: string;
  voiceProfile?: string;
  citations: TranscriptCitation[];
}

export type ChatCitation = TranscriptCitation;

export interface ChatClaim {
  id: string;
  text: string;
  supportStatus: 'supported';
  citations: ChatCitation[];
}

export interface ChatAttempt {
  attemptNumber: number;
  startedAt: string;
  finishedAt?: string;
  outcome: 'running' | 'answered' | 'refused' | 'failed' | 'interrupted' | 'recovered';
  errorCode?: string;
}

export interface ChatTurn {
  id: string;
  submissionId: string;
  acceptedRetry?: {
    idempotencyKey: string;
    attemptNumber: 2;
    acceptedAt: string;
  };
  runId: string;
  question: string;
  state: 'queued' | 'running' | 'answered' | 'refused' | 'failed';
  answerKind?: 'answer' | 'refusal';
  refusalCode?: 'EVIDENCE_INSUFFICIENT';
  claims: ChatClaim[];
  attemptCount: number;
  errorCode?: string;
  errorMessage?: string;
  retryable: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  attempts: ChatAttempt[];
}

export interface EpisodeWarning {
  code: string;
  message: string;
  kind?: 'source_sync' | 'editorial_length';
  sourceName?: string;
  occurredAt?: string;
  cachedEvidenceUsed?: boolean;
  actualWords?: number;
  preferredMinimumWords?: number;
  preferredMaximumWords?: number;
}

export interface AudioAsset {
  id: string;
  url: string;
  durationMs: number;
  format: string;
  mimeType?: string;
  byteLength?: number;
  sha256?: string;
  validatedAt?: string;
  provider?: string;
  model?: string;
  voice?: string;
  aiGenerated?: boolean;
}

export interface ProviderSummary {
  adapter: string;
  status: 'LIVE VERIFIED' | 'CONTRACT TESTED ONLY' | 'CONFIGURED UNVERIFIED' | 'NOT CONFIGURED';
  reason: string;
  model?: string;
  voice?: string;
  verifiedAt?: string;
}

export interface OpenAiConnectionTestResult {
  verified: true;
  verifiedAt: string;
  capabilities: Array<'text' | 'speech'>;
}

export interface PodcastStatus {
  configured: boolean;
  publicBaseUrl?: string;
  aiGeneratedAudio: true;
  privateFeed: true;
}

export interface AppSettings {
  orbTheme?: string;
  theme: 'system' | 'light' | 'dark';
  contrastMode: 'normal' | 'high';
  colorVisionMode: 'default' | 'protanopia' | 'deuteranopia' | 'tritanopia' | 'achromatopsia';
  textSize: 'small' | 'normal' | 'large' | 'extra-large';
  density: 'compact' | 'normal' | 'comfortable';
  providers: {
    text: ProviderSummary;
    speech: ProviderSummary;
  };
  credentials: {
    openAi: {
      configured: boolean;
      displayHint?: string;
    };
  };
  generationEnabled: boolean;
}

export interface BriefingRun {
  id: string;
  title: string;
  status: RunStatus;
  createdAt: string;
  completedAt?: string;
  summary?: string;
  sections: BriefingSection[];
  audioAsset?: AudioAsset;
  mode?: EpisodeMode;
  station?: {
    id: string;
    name: string;
    revision: number;
  };
  providers?: {
    text: {adapter: string; model: string};
    speech: {adapter: string; model: string; voice?: string};
  };
  aiGenerated?: boolean;
  scriptFormatVersion?: 1;
  warnings?: EpisodeWarning[];
  job?: {
    id: string;
    phase: RunStatus;
    attemptCount: number;
    errorCode?: string;
    errorMessage?: string;
    failedPhase?: 'syncing' | 'selecting' | 'drafting' | 'validating' | 'rendering_audio';
    retryable: boolean;
    evidenceFrozen: boolean;
    diagnosticReference: string;
    attempts: Array<{
      attemptNumber: number;
      startedAt: string;
      finishedAt?: string;
      outcome: 'running' | 'complete' | 'failed' | 'interrupted' | 'recovered';
      errorCode?: string;
    }>;
  };
}
