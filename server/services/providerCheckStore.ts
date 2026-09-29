import type Database from 'better-sqlite3';
import {createHash} from 'node:crypto';
import type {ProviderDescriptor, ProviderStatus, ProviderSummary, ServerConfig} from '../config';
import {providerDescriptorForConfig, providerSummaryForConfig} from '../config';
import {db} from '../database/index';

export type ProviderCapability = 'text' | 'speech';

interface ProviderSummaryOptions {
	allowAppOpenAiStatusProjection?: boolean;
}

type CheckRow = {
	capability: ProviderCapability;
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

	summary(config: ServerConfig, options: ProviderSummaryOptions = {}): {text: ProviderSummary; speech: ProviderSummary; generationEnabled: boolean} {
		const base = providerSummaryForConfig(config);
		const text = this.summaryFor('text', config, base.text, options);
		const speech = this.summaryFor('speech', config, base.speech, options);
		return {
			text,
			speech,
			generationEnabled: ['CONTRACT TESTED ONLY', 'LIVE VERIFIED'].includes(text.status)
				&& ['CONTRACT TESTED ONLY', 'LIVE VERIFIED'].includes(speech.status),
		};
	}

	recordContract(config: ServerConfig, capabilities: readonly ProviderCapability[] = ['text', 'speech']): void {
		for (const capability of capabilities) {
			if (providerDescriptorForConfig(capability, config)) {
				this.write(capability, config, 'CONTRACT TESTED ONLY', 'Deterministic adapter contract passed; live verification is pending');
			}
		}
	}

	recordNotConfigured(_config: ServerConfig, capabilities: readonly ProviderCapability[] = ['text', 'speech']): void {
		for (const capability of capabilities) {
			this.database.prepare('DELETE FROM provider_checks WHERE capability = ?').run(capability);
		}
	}

	recordLive(capability: ProviderCapability, config: ServerConfig): void {
		this.write(capability, config, 'LIVE VERIFIED', 'A minimal live request succeeded', this.now());
	}

	recordFailure(capability: ProviderCapability, config: ServerConfig, reason: string): void {
		this.write(capability, config, 'CONTRACT TESTED ONLY', reason);
	}

	private summaryFor(capability: ProviderCapability, config: ServerConfig, fallback: ProviderSummary, options: ProviderSummaryOptions): ProviderSummary {
		const descriptor = providerDescriptorForConfig(capability, config);
		const row = this.database.prepare('SELECT * FROM provider_checks WHERE capability = ?').get(capability) as CheckRow | undefined;
		if (!descriptor) {
			if (!options.allowAppOpenAiStatusProjection || !row || config.processRole !== 'app' || row.adapter !== 'OpenAI') return fallback;
			const expectedModel = capability === 'text' && config.textProvider === 'openai'
				? config.openAiTextModel
				: capability === 'speech' && config.speechProvider === 'openai'
					? config.openAiSpeechModel
					: undefined;
			const expectedVoice = capability === 'speech' ? config.openAiSpeechVoice : undefined;
			if (!expectedModel || row.model !== expectedModel || (row.voice || undefined) !== expectedVoice) return fallback;
			return this.projectRow(row);
		}
		if (!row || row.configuration_fingerprint !== this.fingerprint(descriptor)) return fallback;
		return this.projectRow(row);
	}

	private projectRow(row: CheckRow): ProviderSummary {
		return {
			adapter: row.adapter,
			model: row.model,
			voice: row.voice || undefined,
			status: row.status,
			reason: row.reason,
			verifiedAt: row.verified_at || undefined,
		};
	}

	private write(capability: ProviderCapability, config: ServerConfig, status: ProviderStatus, reason: string, verifiedAt?: string): void {
		const descriptor = providerDescriptorForConfig(capability, config);
		if (!descriptor) return;
		this.database.prepare(`
			INSERT INTO provider_checks (
				capability, adapter, model, voice, configuration_fingerprint,
				status, reason, verified_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(capability) DO UPDATE SET
				adapter = excluded.adapter,
				model = excluded.model,
				voice = excluded.voice,
				configuration_fingerprint = excluded.configuration_fingerprint,
				status = excluded.status,
				reason = excluded.reason,
				verified_at = excluded.verified_at,
				updated_at = excluded.updated_at
		`).run(
			capability,
			descriptor.adapter,
			descriptor.model,
			descriptor.voice ?? null,
			this.fingerprint(descriptor),
			status,
			reason,
			verifiedAt ?? null,
			this.now(),
		);
	}

	private fingerprint(descriptor: ProviderDescriptor): string {
		return createHash('sha256').update(descriptor.configurationFingerprintMaterial).digest('hex');
	}
}

export const providerCheckStore = new ProviderCheckStore();
