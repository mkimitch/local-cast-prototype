import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {ServerConfig} from '../config';

const credentialFileName = 'openai-api-key';
const maximumCredentialBytes = 512;
const unsafeCredentialFileMode = 0o7177;

export const openAiApiKeySchema = z.string()
	.min(20, 'OpenAI API key must contain at least 20 characters')
	.max(maximumCredentialBytes, `OpenAI API key must contain at most ${maximumCredentialBytes} characters`)
	.refine(value => value === value.trim(), 'OpenAI API key must not contain surrounding whitespace')
	.refine(value => /^[\x21-\x7e]+$/.test(value), 'OpenAI API key must contain only non-space ASCII characters')
	.refine(value => !/[\u2022*]/.test(value), 'Enter the complete OpenAI API key, not a masked value');

export class CredentialStoreError extends Error {
	constructor(readonly code: 'CREDENTIAL_STORAGE_UNAVAILABLE' | 'CREDENTIAL_VALUE_INVALID') {
		super(code === 'CREDENTIAL_VALUE_INVALID'
			? 'The stored OpenAI credential is invalid'
			: 'The LocalCast credential store is unavailable');
		this.name = 'CredentialStoreError';
	}
}

export interface OpenAiCredentialMetadata {
	configured: boolean;
	displayHint?: string;
}

const displayHint = (value: string): string => `••••${value.slice(-4)}`;

const entryExists = (filePath: string): boolean => {
	try {
		fs.lstatSync(filePath);
		return true;
	} catch (error) {
		return !(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
			? true
			: false;
	}
};

export class OpenAiCredentialStore {
	private readonly filePath: string;

	constructor(private readonly directory: string) {
		this.filePath = path.join(directory, credentialFileName);
	}

	resolve(environmentFallback?: string): string | undefined {
		if (entryExists(this.filePath)) return this.readPersistent();
		return environmentFallback;
	}

	metadata(environmentFallback?: string): OpenAiCredentialMetadata {
		const value = this.resolve(environmentFallback);
		return value ? {configured: true, displayHint: displayHint(value)} : {configured: false};
	}

	replace(value: string): OpenAiCredentialMetadata {
		const parsed = openAiApiKeySchema.safeParse(value);
		if (!parsed.success) throw new CredentialStoreError('CREDENTIAL_VALUE_INVALID');
		this.ensureDirectory();
		this.assertExistingTargetSafe();

		const temporary = path.join(this.directory, `.${credentialFileName}.${randomUUID()}.tmp`);
		let created = false;
		try {
			const descriptor = fs.openSync(
				temporary,
				fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0),
				0o600,
			);
			created = true;
			try {
				fs.writeFileSync(descriptor, parsed.data, {encoding: 'utf8'});
				fs.fsyncSync(descriptor);
			} finally {
				fs.closeSync(descriptor);
			}
			fs.renameSync(temporary, this.filePath);
			created = false;
			fs.chmodSync(this.filePath, 0o600);
			const directoryDescriptor = fs.openSync(this.directory, fs.constants.O_RDONLY);
			try { fs.fsyncSync(directoryDescriptor); } finally { fs.closeSync(directoryDescriptor); }
			return {configured: true, displayHint: displayHint(parsed.data)};
		} catch (error) {
			if (created) {
				try { fs.unlinkSync(temporary); } catch { /* exact temporary file is already absent */ }
			}
			if (error instanceof CredentialStoreError) throw error;
			throw new CredentialStoreError('CREDENTIAL_STORAGE_UNAVAILABLE');
		}
	}

	private ensureDirectory(): void {
		try {
			if (!fs.existsSync(this.directory)) fs.mkdirSync(this.directory, {mode: 0o700});
			const stat = fs.lstatSync(this.directory);
			if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('unsafe credential directory');
			fs.chmodSync(this.directory, 0o700);
			fs.accessSync(this.directory, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
		} catch {
			throw new CredentialStoreError('CREDENTIAL_STORAGE_UNAVAILABLE');
		}
	}

	private assertExistingTargetSafe(): void {
		if (!entryExists(this.filePath)) return;
		try {
			const stat = fs.lstatSync(this.filePath);
			if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & unsafeCredentialFileMode) !== 0) {
				throw new Error('unsafe credential target');
			}
		} catch {
			throw new CredentialStoreError('CREDENTIAL_STORAGE_UNAVAILABLE');
		}
	}

	private assertDirectorySafeForRead(): void {
		try {
			const stat = fs.lstatSync(this.directory);
			if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
				throw new Error('unsafe credential directory');
			}
		} catch {
			throw new CredentialStoreError('CREDENTIAL_STORAGE_UNAVAILABLE');
		}
	}

	private readPersistent(): string {
		let descriptor: number | undefined;
		try {
			this.assertDirectorySafeForRead();
			const before = fs.lstatSync(this.filePath);
			if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || (before.mode & unsafeCredentialFileMode) !== 0) {
				throw new CredentialStoreError('CREDENTIAL_STORAGE_UNAVAILABLE');
			}
			if (before.size < 20 || before.size > maximumCredentialBytes) throw new CredentialStoreError('CREDENTIAL_VALUE_INVALID');
			descriptor = fs.openSync(this.filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
			const opened = fs.fstatSync(descriptor);
			if (opened.dev !== before.dev || opened.ino !== before.ino || opened.nlink !== 1) {
				throw new CredentialStoreError('CREDENTIAL_STORAGE_UNAVAILABLE');
			}
			const value = fs.readFileSync(descriptor, 'utf8');
			const parsed = openAiApiKeySchema.safeParse(value);
			if (!parsed.success) throw new CredentialStoreError('CREDENTIAL_VALUE_INVALID');
			return parsed.data;
		} catch (error) {
			if (error instanceof CredentialStoreError) throw error;
			throw new CredentialStoreError('CREDENTIAL_STORAGE_UNAVAILABLE');
		} finally {
			if (descriptor !== undefined) fs.closeSync(descriptor);
		}
	}
}

export const configWithResolvedOpenAiCredential = (
	config: ServerConfig,
	store: Pick<OpenAiCredentialStore, 'resolve'>,
): ServerConfig => (
	config.textProvider === 'openai' || config.speechProvider === 'openai'
		? {...config, openAiApiKey: store.resolve(config.openAiApiKey)}
		: config
);
