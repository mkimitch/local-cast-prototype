import type {AppSettings} from '../../types';
import type {ProviderService} from './index';
import {apiRequest} from './httpClient';

const stripSecrets = (settings: AppSettings): AppSettings => ({
  ...settings,
  aiConfig: {
    model: settings.aiConfig.model,
    baseUrl: settings.aiConfig.baseUrl,
  },
  ttsConfig: {
    model: settings.ttsConfig.model,
    baseUrl: settings.ttsConfig.baseUrl,
  },
});

export class ApiProviderService implements ProviderService {
  private listeners = new Set<(settings: AppSettings) => void>();

  async getSettings(): Promise<AppSettings> {
    return stripSecrets(await apiRequest<AppSettings>('/settings'));
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    const savedSettings = await apiRequest<AppSettings>('/settings', {
      method: 'PUT',
      body: JSON.stringify(stripSecrets(settings)),
    });

    const sanitizedSettings = stripSecrets(savedSettings);
    this.listeners.forEach(listener => listener(sanitizedSettings));
  }

  onSettingsChanged(callback: (settings: AppSettings) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }
}
