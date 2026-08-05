import type {AppSettings} from '../../types';
import type {ProviderService} from './index';
import {apiRequest} from './httpClient';

const appearanceSettings = (settings: AppSettings) => ({
  orbTheme: settings.orbTheme,
  theme: settings.theme,
  contrastMode: settings.contrastMode,
  colorVisionMode: settings.colorVisionMode,
  textSize: settings.textSize,
  density: settings.density,
});

export class ApiProviderService implements ProviderService {
  private listeners = new Set<(settings: AppSettings) => void>();

  async getSettings(): Promise<AppSettings> {
    return apiRequest<AppSettings>('/settings');
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    const savedSettings = await apiRequest<AppSettings>('/settings', {
      method: 'PUT',
      body: JSON.stringify(appearanceSettings(settings)),
    });

    this.listeners.forEach(listener => listener(savedSettings));
  }

  onSettingsChanged(callback: (settings: AppSettings) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }
}
