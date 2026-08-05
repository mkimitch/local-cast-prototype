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

export type RunStatus = 'queued' | 'syncing' | 'selecting' | 'drafting' | 'validating' | 'rendering_audio' | 'complete' | 'failed';

export interface BriefingSection {
  id: string;
  title: string;
  type: 'intro' | 'news_summary' | 'deep_dive' | 'outro';
  spokenText: string;
  sourceItemIds: string[];
  importanceScore: number;
  followUpPrompts: string[];
}

export interface AudioAsset {
  id: string;
  url: string;
  durationMs: number;
  format: string;
}

export interface ProviderSummary {
  adapter: string;
  status: 'LIVE VERIFIED' | 'CONTRACT TESTED ONLY' | 'NOT CONFIGURED';
  reason: string;
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
  job?: {
    id: string;
    phase: RunStatus;
    attemptCount: number;
    errorCode?: string;
    errorMessage?: string;
    retryable: boolean;
  };
}
