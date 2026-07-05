import type {AppSettings} from '../../src/types';
import {serverConfig} from '../config';

const aiProviders: AppSettings['aiProvider'][] = ['mock', 'openai_placeholder', 'gemini_placeholder', 'lmstudio_placeholder', 'ollama_placeholder'];
const ttsProviders: AppSettings['ttsProvider'][] = ['local', 'openai', 'elevenlabs'];
const themes: AppSettings['theme'][] = ['system', 'light', 'dark'];
const contrastModes: AppSettings['contrastMode'][] = ['normal', 'high'];
const colorVisionModes: AppSettings['colorVisionMode'][] = ['default', 'protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia'];
const textSizes: AppSettings['textSize'][] = ['small', 'normal', 'large', 'extra-large'];
const densities: AppSettings['density'][] = ['compact', 'normal', 'comfortable'];

const frontendProviderFromBackend = (): AppSettings['aiProvider'] => {
  if (serverConfig.aiProvider === 'gemini') return 'gemini_placeholder';
  if (serverConfig.aiProvider === 'openai_compatible') return 'lmstudio_placeholder';
  return 'mock';
};

class SettingsStore {
  private settings: AppSettings = {
    aiProvider: frontendProviderFromBackend(),
    aiConfig: {
      model: serverConfig.aiModel,
      baseUrl: serverConfig.aiBaseUrl || undefined,
    },
    ttsProvider: 'local',
    ttsConfig: {},
    scheduleTime: '07:00',
    isScheduleActive: false,
    orbTheme: 'amber',
    theme: 'system',
    contrastMode: 'normal',
    colorVisionMode: 'default',
    textSize: 'normal',
    density: 'normal',
  };

  private choose<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
    return typeof value === 'string' && options.includes(value as T) ? value as T : fallback;
  }

  private sanitizeSettings(settings: AppSettings): AppSettings {
    return {
      ...this.settings,
      ...settings,
      aiProvider: this.choose(settings.aiProvider, aiProviders, this.settings.aiProvider),
      aiConfig: {
        model: settings.aiConfig?.model,
        baseUrl: settings.aiConfig?.baseUrl,
      },
      ttsProvider: this.choose(settings.ttsProvider, ttsProviders, this.settings.ttsProvider),
      ttsConfig: {
        model: settings.ttsConfig?.model,
        baseUrl: settings.ttsConfig?.baseUrl,
      },
      theme: this.choose(settings.theme, themes, this.settings.theme),
      contrastMode: this.choose(settings.contrastMode, contrastModes, this.settings.contrastMode),
      colorVisionMode: this.choose(settings.colorVisionMode, colorVisionModes, this.settings.colorVisionMode),
      textSize: this.choose(settings.textSize, textSizes, this.settings.textSize),
      density: this.choose(settings.density, densities, this.settings.density),
    };
  }

  getSettings(): AppSettings {
    return this.sanitizeSettings(this.settings);
  }

  saveSettings(settings: AppSettings): AppSettings {
    this.settings = this.sanitizeSettings(settings);
    return this.getSettings();
  }
}

export const settingsStore = new SettingsStore();
