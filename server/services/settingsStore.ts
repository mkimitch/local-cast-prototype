import type {AppSettings} from '../../src/types';
import {serverConfig} from '../config';
import {db} from '../database/index';
import {providerCheckStore} from './providerCheckStore';

type AppearanceSettings = Omit<AppSettings, 'providers' | 'generationEnabled'>;

const themes: AppearanceSettings['theme'][] = ['system', 'light', 'dark'];
const contrastModes: AppearanceSettings['contrastMode'][] = ['normal', 'high'];
const colorVisionModes: AppearanceSettings['colorVisionMode'][] = ['default', 'protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia'];
const textSizes: AppearanceSettings['textSize'][] = ['small', 'normal', 'large', 'extra-large'];
const densities: AppearanceSettings['density'][] = ['compact', 'normal', 'comfortable'];

class SettingsStore {
	private readonly defaultAppearance: AppearanceSettings = {
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

	private sanitizeAppearance(settings: Partial<AppearanceSettings>): AppearanceSettings {
		return {
			orbTheme: typeof settings.orbTheme === 'string' ? settings.orbTheme : this.defaultAppearance.orbTheme,
			theme: this.choose(settings.theme, themes, this.defaultAppearance.theme),
			contrastMode: this.choose(settings.contrastMode, contrastModes, this.defaultAppearance.contrastMode),
			colorVisionMode: this.choose(settings.colorVisionMode, colorVisionModes, this.defaultAppearance.colorVisionMode),
			textSize: this.choose(settings.textSize, textSizes, this.defaultAppearance.textSize),
			density: this.choose(settings.density, densities, this.defaultAppearance.density),
		};
	}

	private withProviderStatus(appearance: AppearanceSettings): AppSettings {
		const status = providerCheckStore.summary(serverConfig);
		return {
			...appearance,
			providers: {text: status.text, speech: status.speech},
			generationEnabled: status.generationEnabled,
		};
	}

	getSettings(): AppSettings {
		const row = db.prepare('SELECT settings_json FROM app_settings WHERE id = ?').get('default') as {settings_json: string} | undefined;
		let appearance = this.defaultAppearance;

		if (row) {
			try {
				appearance = this.sanitizeAppearance(JSON.parse(row.settings_json) as Partial<AppearanceSettings>);
			} catch {
				appearance = this.defaultAppearance;
			}
		}

		this.writeAppearance(appearance);
		return this.withProviderStatus(appearance);
	}

	saveSettings(settings: Partial<AppSettings>): AppSettings {
		const appearance = this.sanitizeAppearance(settings);
		this.writeAppearance(appearance);
		return this.withProviderStatus(appearance);
	}

	private writeAppearance(settings: AppearanceSettings): void {
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
