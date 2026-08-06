import type {AppSettings, BriefingRun, EpisodeMode, Note, Source, SourceItem, Station} from '../../types';

export interface SourceService {
  getSources(): Promise<Source[]>;
  getSourceItems(sourceId: string): Promise<SourceItem[]>;
  addSource(source: Omit<Source, 'id' | 'addedAt'>): Promise<Source>;
  toggleSource(id: string, isActive: boolean): Promise<void>;
  syncSource(id: string): Promise<void>;
  deleteSource(id: string): Promise<void>;
}

export interface BriefingService {
  getRuns(): Promise<BriefingRun[]>;
  getRun(id: string): Promise<BriefingRun | undefined>;
  startRun(sourceIds: string[]): Promise<BriefingRun>;
  startStationRun(stationId: string, mode?: EpisodeMode): Promise<BriefingRun>;
}

export interface StationService {
  getNotes(): Promise<Note[]>;
  saveNote(input: Pick<Note, 'title' | 'body' | 'author' | 'originalUrl'>, id?: string): Promise<Note>;
  deleteNote(id: string): Promise<void>;
  getStations(): Promise<Station[]>;
  saveStation(input: Pick<Station, 'name' | 'topicInstruction' | 'defaultMode' | 'noteIds' | 'sourceIds'>, id?: string): Promise<Station>;
  deleteStation(id: string): Promise<void>;
}

export interface ProviderService {
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<void>;
  onSettingsChanged(callback: (settings: AppSettings) => void): () => void;
}

export {ApiBriefingService} from './ApiBriefingService';
export {ApiProviderService} from './ApiProviderService';
export {ApiSourceService} from './ApiSourceService';
export {ApiStationService} from './ApiStationService';
export {apiBaseUrl, getServiceMode, HttpClientError} from './httpClient';
