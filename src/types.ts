export type SourceType = 'rss' | 'manual_topic' | 'local_file' | 'gmail_placeholder' | 'calendar_placeholder';
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

export type RunStatus = 'queued' | 'gathering' | 'summarizing_sources' | 'drafting' | 'rendering_audio' | 'complete' | 'failed';

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

export interface ProviderConfig {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

export interface AppSettings {
  aiProvider: 'mock' | 'openai_placeholder' | 'gemini_placeholder' | 'lmstudio_placeholder' | 'ollama_placeholder';
  aiConfig: ProviderConfig;
  ttsProvider: 'local' | 'openai' | 'elevenlabs';
  ttsConfig: ProviderConfig;
  scheduleTime?: string; // HH:mm format
  isScheduleActive?: boolean;
  orbTheme?: string;
  theme: 'system' | 'light' | 'dark';
  contrastMode: 'normal' | 'high';
  colorVisionMode: 'default' | 'protanopia' | 'deuteranopia' | 'tritanopia' | 'achromatopsia';
  textSize: 'small' | 'normal' | 'large' | 'extra-large';
  density: 'compact' | 'normal' | 'comfortable';
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
}
