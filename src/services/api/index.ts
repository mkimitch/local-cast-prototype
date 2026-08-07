import type {AppSettings, BriefingRun, EpisodeMode, MaterialSearchResult, Note, PodcastStatus, Source, SourceItem, Station} from '../../types';

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
