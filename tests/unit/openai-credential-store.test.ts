import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {CredentialStoreError, OpenAiCredentialStore} from '../../server/credentials/openAiCredentialStore';

const roots: string[] = [];
const makeStore = () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localcast-credential-store-'));
	fs.chmodSync(root, 0o700);
	roots.push(root);
	const directory = path.join(root, '.credentials');
	return {root, directory, store: new OpenAiCredentialStore(directory)};
};

afterEach(() => {
	while (roots.length > 0) fs.rmSync(roots.pop()!, {recursive: true, force: true});
});

describe('installation-private OpenAI credential store', () => {
	it('persists an atomic private credential and takes precedence over the environment fallback', () => {
		const {directory, store} = makeStore();
		const apiKey = 'sk-localcast-persistent-credential-1234';
		const metadata = store.replace(apiKey);

		expect(metadata).toMatchObject({configured: true});
		expect(metadata.displayHint).toMatch(/1234$/);
		expect(JSON.stringify(metadata)).not.toContain(apiKey);
		expect(store.resolve('sk-environment-fallback-credential-9999')).toBe(apiKey);
		expect(new OpenAiCredentialStore(directory).resolve()).toBe(apiKey);
		expect(fs.statSync(directory).mode & 0o777).toBe(0o700);
		expect(fs.statSync(path.join(directory, 'openai-api-key')).mode & 0o777).toBe(0o600);
		expect(fs.readdirSync(directory)).toEqual(['openai-api-key']);
	});

	it('uses the environment credential only when no installation credential exists', () => {
		const {store} = makeStore();
		expect(store.resolve('sk-environment-fallback-credential-9999')).toBe('sk-environment-fallback-credential-9999');
		expect(store.metadata('sk-environment-fallback-credential-9999')).toMatchObject({configured: true, displayHint: expect.stringMatching(/9999$/)});
	});

	it('rejects masked and malformed replacements without changing the prior credential', () => {
		const {store} = makeStore();
		const original = 'sk-localcast-original-credential-1234';
		store.replace(original);

		for (const invalid of ['••••1234', '********************1234', ' sk-localcast-replacement-credential-5678']) {
			expect(() => store.replace(invalid)).toThrow(CredentialStoreError);
			expect(store.resolve()).toBe(original);
		}
	});

	it('fails closed for linked, broad-mode, executable-mode, and invalid persistent files', () => {
		for (const kind of ['symlink', 'hardlink', 'mode', 'executable-mode', 'invalid'] as const) {
			const {root, directory, store} = makeStore();
			fs.mkdirSync(directory, {mode: 0o700});
			const target = path.join(directory, 'openai-api-key');
			const source = path.join(root, `source-${kind}`);
			fs.writeFileSync(source, 'sk-localcast-linked-credential-1234', {mode: 0o600});
			if (kind === 'symlink') fs.symlinkSync(source, target);
			if (kind === 'hardlink') fs.linkSync(source, target);
			if (kind === 'mode') fs.writeFileSync(target, 'sk-localcast-broad-credential-1234', {mode: 0o644});
			if (kind === 'executable-mode') fs.writeFileSync(target, 'sk-localcast-executable-credential-1234', {mode: 0o700});
			if (kind === 'invalid') fs.writeFileSync(target, 'masked-placeholder-value-****', {mode: 0o600});

			expect(() => store.resolve('sk-environment-fallback-credential-9999')).toThrow(CredentialStoreError);
		}
	});

	it.each(['symlink', 'mode'] as const)('fails closed for an unsafe %s credential directory', kind => {
		const {root, directory, store} = makeStore();
		const actualDirectory = kind === 'symlink' ? path.join(root, 'actual-credentials') : directory;
		fs.mkdirSync(actualDirectory, {mode: kind === 'mode' ? 0o755 : 0o700});
		fs.writeFileSync(path.join(actualDirectory, 'openai-api-key'), 'sk-localcast-directory-credential-1234', {mode: 0o600});
		if (kind === 'symlink') fs.symlinkSync(actualDirectory, directory);

		expect(() => store.resolve('sk-environment-fallback-credential-9999')).toThrow(CredentialStoreError);
	});
});
