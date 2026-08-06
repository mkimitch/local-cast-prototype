import type Database from 'better-sqlite3';
import {createHash} from 'node:crypto';
import type {ProviderStatus, ProviderSummary, ServerConfig} from '../config';
import {providerSummaryForConfig} from '../config';
import {db} from '../database/index';

type Capability = 'text' | 'speech';

type CheckRow = {
	capability: Capability;
	adapter: string;
	model: string;
	voice: string | null;
	configuration_fingerprint: string;
	status: ProviderStatus;
	reason: string;
	verified_at: string | null;
};

export class ProviderCheckStore {
	constructor(
		private readonly database: Database.Database = db,
		private readonly now: () => string = () => new Date().toISOString(),
	) {}

	summary(config: ServerConfig): {text: ProviderSummary; speech: ProviderSummary; generationEnabled: boolean} {
		const base = providerSummaryForConfig(config);
		if (config.textProvider !== 'openai' || config.speechProvider !== 'openai') return base;
		const text = this.summaryFor('text', config, base.text);
		const speech = this.summaryFor('speech', config, base.speech);
		return {
			text,
			speech,
			generationEnabled: text.status !== 'NOT CONFIGURED' && speech.status !== 'NOT CONFIGURED',
		};
	}

	recordContract(config: ServerConfig): void {
		for (const capability of ['text', 'speech'] as const) {
			this.write(capability, config, 'CONTRACT TESTED ONLY', 'Configured; live verification is pending');
		}
	}

	recordNotConfigured(config: ServerConfig): void {
		this.write('text', config, 'NOT CONFIGURED', 'The worker is missing its server-side OpenAI credential');
		this.write('speech', config, 'NOT CONFIGURED', 'The worker is missing its server-side OpenAI credential');
	}

	recordLive(capability: Capability, config: ServerConfig): void {
		this.write(capability, config, 'LIVE VERIFIED', 'A minimal live request succeeded', this.now());
	}

	recordFailure(capability: Capability, config: ServerConfig, reason: string): void {
		this.write(capability, config, 'CONTRACT TESTED ONLY', reason);
	}

	private summaryFor(capability: Capability, config: ServerConfig, fallback: ProviderSummary): ProviderSummary {
		const row = this.database.prepare('SELECT * FROM provider_checks WHERE capability = ?').get(capability) as CheckRow | undefined;
		if (!row || row.configuration_fingerprint !== this.fingerprint(capability, config)) return fallback;
		return {
			adapter: row.adapter,
			model: row.model,
			voice: row.voice || undefined,
			status: row.status,
			reason: row.reason,
			verifiedAt: row.verified_at || undefined,
		};
	}

	private write(capability: Capability, config: ServerConfig, status: ProviderStatus, reason: string, verifiedAt?: string): void {
		const model = capability === 'text' ? config.openAiTextModel : config.openAiSpeechModel;
		const voice = capability === 'speech' ? config.openAiSpeechVoice : null;
		this.database.prepare(`
			INSERT INTO provider_checks (
				capability, adapter, model, voice, configuration_fingerprint,
				status, reason, verified_at, updated_at
			) VALUES (?, 'OpenAI', ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(capability) DO UPDATE SET
				adapter = excluded.adapter,
				model = excluded.model,
				voice = excluded.voice,
				configuration_fingerprint = excluded.configuration_fingerprint,
				status = excluded.status,
				reason = excluded.reason,
				verified_at = excluded.verified_at,
				updated_at = excluded.updated_at
		`).run(capability, model, voice, this.fingerprint(capability, config), status, reason, verifiedAt ?? null, this.now());
	}

	private fingerprint(capability: Capability, config: ServerConfig): string {
		const value = capability === 'text'
			? `openai|text|${config.openAiTextModel}|${config.openAiReasoningEffort}`
			: `openai|speech|${config.openAiSpeechModel}|${config.openAiSpeechVoice}|${config.openAiSpeechFormat}`;
		return createHash('sha256').update(value).digest('hex');
	}
}

export const providerCheckStore = new ProviderCheckStore();
