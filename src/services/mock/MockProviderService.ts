import { AppSettings } from '../../types';
import { ProviderService } from '../api';

export class MockProviderService implements ProviderService {
  private listeners: ((settings: AppSettings) => void)[] = [];
  
  private settings: AppSettings = {
    aiProvider: 'mock',
    aiConfig: { model: 'mock-model' },
    ttsProvider: 'local',
    ttsConfig: {},
    scheduleTime: '07:00',
    isScheduleActive: false,
    orbTheme: 'amber',
    theme: 'system',
    contrastMode: 'normal',
    colorVisionMode: 'default',
    textSize: 'normal',
    density: 'normal'
  };
  
  async getSettings() { return { ...this.settings }; }
  
  async saveSettings(settings: AppSettings) {
    this.settings = { ...settings };
    this.listeners.forEach(l => l(this.settings));
  }

  onSettingsChanged(callback: (settings: AppSettings) => void) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(l => l !== callback);
    };
  }
}
