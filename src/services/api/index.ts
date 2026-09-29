import type {AppSettings, BriefingRun, ChatTurn, EpisodeMode, MaterialSearchResult, Note, OpenAiConnectionTestResult, PodcastStatus, Source, SourceItem, Station} from '../../types';

export interface SourceService {
  getSources(): Promise<Source[]>;
  getSourceItems(sourceId: string): Promise<SourceItem[]>;
  addSource(source: Pick<Source, 'type' | 'name' | 'url' | 'description' | 'category' | 'isActive'>): Promise<Source>;
  updateSource(id: string, source: Partial<Pick<Source, 'name' | 'url'>> & {description?: string | null; category?: string | null}): Promise<Source>;
  toggleSource(id: string, isActive: boolean): Promise<void>;
  syncSource(id: string): Promise<{insertedCount: number; updatedCount: number; notModified?: boolean; message?: string}>;
  searchMaterials(query: string): Promise<MaterialSearchResult[]>;
  deleteSource(id: string): Promise<void>;
}

export interface BriefingService {
  getRuns(): Promise<BriefingRun[]>;
  getRun(id: string): Promise<BriefingRun | undefined>;
  startStationRun(stationId: string, mode?: EpisodeMode): Promise<BriefingRun>;
  retryRun(id: string): Promise<BriefingRun>;
  getChatTurns(runId: string, signal?: AbortSignal): Promise<ChatTurn[]>;
  askEpisodeQuestion(runId: string, question: string, idempotencyKey: string, signal?: AbortSignal): Promise<ChatTurn>;
  retryEpisodeQuestion(runId: string, turnId: string, idempotencyKey: string, signal?: AbortSignal): Promise<ChatTurn>;
}

export interface StationService {
  getNotes(): Promise<Note[]>;
  saveNote(input: Pick<Note, 'title' | 'body' | 'author' | 'originalUrl'>, id?: string): Promise<Note>;
  deleteNote(id: string): Promise<void>;
  getStations(): Promise<Station[]>;
  getStation(id: string): Promise<Station | undefined>;
  saveStation(input: Pick<Station, 'name' | 'topicInstruction' | 'defaultMode' | 'noteIds' | 'sourceIds'>, id?: string): Promise<Station>;
  deleteStation(id: string): Promise<void>;
}

export interface ProviderService {
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<void>;
  replaceOpenAiApiKey(apiKey: string): Promise<void>;
  testOpenAiConnection(): Promise<OpenAiConnectionTestResult>;
  onSettingsChanged(callback: (settings: AppSettings) => void): () => void;
}

export interface PodcastService {
  getStatus(): Promise<PodcastStatus>;
  copySubscriptionUrlToClipboard(): Promise<void>;
}

export {ApiBriefingService} from './ApiBriefingService';
export {ApiProviderService} from './ApiProviderService';
export {ApiPodcastService} from './ApiPodcastService';
export {ApiSourceService} from './ApiSourceService';
export {ApiStationService} from './ApiStationService';
export {apiBaseUrl, getServiceMode, HttpClientError} from './httpClient';
