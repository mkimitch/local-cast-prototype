export type SourceType = 'rss' | 'manual_topic';
export type SourceStatus = 'healthy' | 'error' | 'syncing';
export type SourceSyncStatus = 'success' | 'error';

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

export interface Station {
  id: string;
  revision: number;
  name: string;
  topicInstruction: string;
  defaultMode: EpisodeMode;
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
  citations: TranscriptCitation[];
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
  status: 'LIVE VERIFIED' | 'CONTRACT TESTED ONLY' | 'NOT CONFIGURED';
  reason: string;
  model?: string;
  voice?: string;
  verifiedAt?: string;
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
  job?: {
    id: string;
    phase: RunStatus;
    attemptCount: number;
    errorCode?: string;
    errorMessage?: string;
    failedPhase?: 'syncing' | 'selecting' | 'drafting' | 'validating' | 'rendering_audio';
    retryable: boolean;
  };
}
