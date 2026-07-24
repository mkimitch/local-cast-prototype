import type {AppSettings, BriefingRun, Source, SourceItem} from '../../types';

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
}

export interface ProviderService {
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<void>;
  onSettingsChanged(callback: (settings: AppSettings) => void): () => void;
}

export {ApiBriefingService} from './ApiBriefingService';
export {ApiProviderService} from './ApiProviderService';
export {ApiSourceService} from './ApiSourceService';
export {apiBaseUrl, getServiceMode, HttpClientError} from './httpClient';
