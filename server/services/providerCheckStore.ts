import type Database from 'better-sqlite3';
import {createHash} from 'node:crypto';
import type {ProviderDescriptor, ProviderStatus, ProviderSummary, ServerConfig} from '../config';
import {providerDescriptorForConfig, providerSummaryForConfig} from '../config';
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
		const text = this.summaryFor('text', config, base.text);
		const speech = this.summaryFor('speech', config, base.speech);
		return {
			text,
			speech,
			generationEnabled: ['CONTRACT TESTED ONLY', 'LIVE VERIFIED'].includes(text.status)
				&& ['CONTRACT TESTED ONLY', 'LIVE VERIFIED'].includes(speech.status),
		};
	}

	recordContract(config: ServerConfig): void {
		for (const capability of ['text', 'speech'] as const) {
			if (providerDescriptorForConfig(capability, config)) {
				this.write(capability, config, 'CONTRACT TESTED ONLY', 'Deterministic adapter contract passed; live verification is pending');
			}
		}
	}

	recordNotConfigured(config: ServerConfig): void {
		for (const capability of ['text', 'speech'] as const) {
			this.database.prepare('DELETE FROM provider_checks WHERE capability = ?').run(capability);
		}
	}

	recordLive(capability: Capability, config: ServerConfig): void {
		this.write(capability, config, 'LIVE VERIFIED', 'A minimal live request succeeded', this.now());
	}

	recordFailure(capability: Capability, config: ServerConfig, reason: string): void {
		this.write(capability, config, 'CONTRACT TESTED ONLY', reason);
	}

	private summaryFor(capability: Capability, config: ServerConfig, fallback: ProviderSummary): ProviderSummary {
		const descriptor = providerDescriptorForConfig(capability, config);
		if (!descriptor) return fallback;
		const row = this.database.prepare('SELECT * FROM provider_checks WHERE capability = ?').get(capability) as CheckRow | undefined;
		if (!row || row.configuration_fingerprint !== this.fingerprint(descriptor)) return fallback;
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
