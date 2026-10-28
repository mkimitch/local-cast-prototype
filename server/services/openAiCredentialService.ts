import type {ServerConfig} from '../config';
import {configWithResolvedOpenAiCredential, CredentialStoreError, type OpenAiCredentialMetadata, type OpenAiCredentialStore} from '../credentials/openAiCredentialStore';
import {openAiCredentialStore} from '../credentials/index';
import {OpenAiVerificationError, verifyOpenAiModelAccess, type OpenAiVerificationOptions} from '../providers/openAiVerification';
import {providerCheckStore, type ProviderCapability, type ProviderCheckStore} from './providerCheckStore';

type OpenAiCapability = 'text' | 'speech';

export class OpenAiCredentialOperationError extends Error {
	constructor(
		readonly code: 'OPENAI_CREDENTIAL_NOT_MANAGED' | 'OPENAI_CREDENTIAL_STORAGE_FAILED' | OpenAiVerificationError['code'],
		message: string,
		readonly httpStatus: 400 | 409 | 429 | 500 | 502 | 503,
	) {
		super(message);
		this.name = 'OpenAiCredentialOperationError';
	}
}

export interface OpenAiConnectionTestResult {
	verified: true;
	verifiedAt: string;
	capabilities: OpenAiCapability[];
}

export class OpenAiCredentialService {
	constructor(
		private readonly credentials: Pick<OpenAiCredentialStore, 'resolve' | 'metadata' | 'replace'> = openAiCredentialStore,
		private readonly checks: Pick<ProviderCheckStore, 'recordContract' | 'recordFailure' | 'recordLive' | 'summary'> = providerCheckStore,
		private readonly verify: typeof verifyOpenAiModelAccess = verifyOpenAiModelAccess,
		private readonly now: () => string = () => new Date().toISOString(),
		private readonly verificationOptions: OpenAiVerificationOptions = {},
	) {}

	metadata(config: ServerConfig): OpenAiCredentialMetadata {
		try {
			return this.credentials.metadata(config.openAiApiKey);
		} catch {
			return {configured: false};
		}
	}

	effectiveConfig(config: ServerConfig): ServerConfig {
		return configWithResolvedOpenAiCredential(config, this.credentials);
	}

	providerSummary(config: ServerConfig): ReturnType<ProviderCheckStore['summary']> {
		try {
			const effective = this.effectiveConfig(config);
			return this.checks.summary(effective, {
				allowAppOpenAiStatusProjection: effective.processRole === 'app' && !effective.openAiApiKey,
			});
		} catch {
			return this.checks.summary({...config, openAiApiKey: undefined});
		}
	}

	replace(config: ServerConfig, apiKey: string): OpenAiCredentialMetadata {
		let metadata: OpenAiCredentialMetadata;
		try {
			metadata = this.credentials.replace(apiKey);
		} catch (error) {
			if (error instanceof CredentialStoreError && error.code === 'CREDENTIAL_VALUE_INVALID') {
				throw new OpenAiCredentialOperationError('OPENAI_CREDENTIAL_STORAGE_FAILED', 'Enter a complete valid OpenAI API key.', 400);
			}
			throw new OpenAiCredentialOperationError('OPENAI_CREDENTIAL_STORAGE_FAILED', 'LocalCast could not store the OpenAI API key safely.', 500);
		}

		try {
			const effective = {...config, openAiApiKey: apiKey};
			const openAiCapabilities = (['text', 'speech'] as const).filter(capability => (
				capability === 'text' ? effective.textProvider === 'openai' : effective.speechProvider === 'openai'
			)) as ProviderCapability[];
			this.checks.recordContract(effective, openAiCapabilities);
		} catch {
			// The credential replacement is already durable. Its fingerprint prevents stale status projection.
		}
		return metadata;
	}

	async testConnection(config: ServerConfig): Promise<OpenAiConnectionTestResult> {
		const targets: Array<{capability: OpenAiCapability; model: string}> = [];
		if (config.textProvider === 'openai') targets.push({capability: 'text', model: config.openAiTextModel});
		if (config.speechProvider === 'openai') targets.push({capability: 'speech', model: config.openAiSpeechModel});
		if (targets.length === 0) {
			throw new OpenAiCredentialOperationError('OPENAI_CREDENTIAL_NOT_MANAGED', 'OpenAI is not selected for text or speech generation.', 409);
		}

		let effective: ServerConfig;
		try {
			effective = this.effectiveConfig(config);
		} catch {
			throw new OpenAiCredentialOperationError('OPENAI_CREDENTIAL_STORAGE_FAILED', 'LocalCast could not read the stored OpenAI API key safely.', 500);
		}
		if (!effective.openAiApiKey || !this.hasPersistentCredential()) {
			throw new OpenAiCredentialOperationError(
				'OPENAI_CREDENTIAL_NOT_MANAGED',
				'Replace the deployment-managed OpenAI API key in LocalCast before testing it here.',
				409,
			);
		}

		const verified: OpenAiCapability[] = [];
		for (const target of targets) {
			try {
				await this.verify(effective.openAiApiKey, target.model, this.verificationOptions);
				this.checks.recordLive(target.capability, effective);
				verified.push(target.capability);
			} catch (error) {
				const failure = error instanceof OpenAiVerificationError
					? error
					: new OpenAiVerificationError('OPENAI_PROVIDER_UNAVAILABLE', 'OpenAI could not be reached.', 503);
				this.checks.recordFailure(target.capability, effective, `Connection test failed: ${failure.code}`);
				throw new OpenAiCredentialOperationError(failure.code, failure.message, failure.httpStatus);
			}
		}

		return {verified: true, verifiedAt: this.now(), capabilities: verified};
	}

	private hasPersistentCredential(): boolean {
		try {
			return this.credentials.metadata().configured;
		} catch {
			return false;
		}
	}
}

export const openAiCredentialService = new OpenAiCredentialService();
