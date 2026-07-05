import type {AppSettings} from '../../src/types';
import {serverConfig} from '../config';
import {db} from '../database';

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
	private defaultSettings: AppSettings = {
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

	constructor() {
		this.seedSettingsIfEmpty();
	}

	private seedSettingsIfEmpty(): void {
		const row = db.prepare('SELECT COUNT(*) AS count FROM app_settings').get() as {count: number};
		if (row.count > 0) return;

		this.writeSettings(this.defaultSettings);
	}

	private choose<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
		return typeof value === 'string' && options.includes(value as T) ? value as T : fallback;
	}

	private sanitizeSettings(settings: AppSettings): AppSettings {
		return {
			...this.defaultSettings,
			...settings,
			aiProvider: this.choose(settings.aiProvider, aiProviders, this.defaultSettings.aiProvider),
			aiConfig: {
				model: settings.aiConfig?.model,
				baseUrl: settings.aiConfig?.baseUrl,
			},
			ttsProvider: this.choose(settings.ttsProvider, ttsProviders, this.defaultSettings.ttsProvider),
			ttsConfig: {
				model: settings.ttsConfig?.model,
				baseUrl: settings.ttsConfig?.baseUrl,
			},
			theme: this.choose(settings.theme, themes, this.defaultSettings.theme),
			contrastMode: this.choose(settings.contrastMode, contrastModes, this.defaultSettings.contrastMode),
			colorVisionMode: this.choose(settings.colorVisionMode, colorVisionModes, this.defaultSettings.colorVisionMode),
			textSize: this.choose(settings.textSize, textSizes, this.defaultSettings.textSize),
			density: this.choose(settings.density, densities, this.defaultSettings.density),
		};
	}

	getSettings(): AppSettings {
		const row = db.prepare('SELECT settings_json FROM app_settings WHERE id = ?').get('default') as {settings_json: string} | undefined;
		if (!row) {
			this.writeSettings(this.defaultSettings);
			return this.sanitizeSettings(this.defaultSettings);
		}

		try {
			return this.sanitizeSettings(JSON.parse(row.settings_json) as AppSettings);
		} catch {
			this.writeSettings(this.defaultSettings);
			return this.sanitizeSettings(this.defaultSettings);
		}
	}

	saveSettings(settings: AppSettings): AppSettings {
		this.writeSettings(this.sanitizeSettings(settings));
		return this.getSettings();
	}

	private writeSettings(settings: AppSettings): void {
		db.prepare(`
			INSERT INTO app_settings (id, settings_json, updated_at)
			VALUES (@id, @settingsJson, @updatedAt)
			ON CONFLICT(id) DO UPDATE SET
				settings_json = excluded.settings_json,
				updated_at = excluded.updated_at
		`).run({
			id: 'default',
			settingsJson: JSON.stringify(settings),
			updatedAt: new Date().toISOString(),
		});
	}
}

export const settingsStore = new SettingsStore();
