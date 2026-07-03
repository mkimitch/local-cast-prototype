import { Source, BriefingRun, AppSettings } from '../../types';

export interface SourceService {
  getSources(): Promise<Source[]>;
  addSource(source: Omit<Source, 'id' | 'addedAt'>): Promise<Source>;
  toggleSource(id: string, isActive: boolean): Promise<void>;
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
