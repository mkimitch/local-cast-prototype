import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it, vi} from 'vitest';
import {createSmokeChildEnvironment, resolveSmokeEntry} from '../../scripts/smoke-environment.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('smoke child environment isolation', () => {
	it('constructs a minimal environment without inherited credentials or secret paths', () => {
		const syntheticParent = fs.mkdtempSync(path.join(os.tmpdir(), 'localcast-smoke-env-test-'));
		const syntheticEnvFile = path.join(syntheticParent, '.env');
		fs.writeFileSync(syntheticEnvFile, 'OPENAI_API_KEY=synthetic-value-that-must-not-be-read\n');
		const readFile = vi.spyOn(fs, 'readFileSync');
		const environment = createSmokeChildEnvironment({
			HOME: syntheticParent,
			TMPDIR: syntheticParent,
			NODE_ENV: 'test',
			LOCALCAST_RUNTIME_MODE: 'test',
			LOCALCAST_PROCESS_ROLE: 'worker',
			DATABASE_PATH: '/tmp/localcast-synthetic.sqlite',
			MEDIA_PATH: '/tmp/localcast-synthetic-media',
			TEXT_PROVIDER: 'fake',
			SPEECH_PROVIDER: 'fake',
			LOCALCAST_ALLOW_FAKE_PROVIDERS: 'true',
		});

		try {
			expect(environment).toEqual({
				PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
				LANG: 'C.UTF-8',
				LC_ALL: 'C.UTF-8',
				TZ: 'UTC',
				HOME: syntheticParent,
				TMPDIR: syntheticParent,
				NODE_ENV: 'test',
				LOCALCAST_RUNTIME_MODE: 'test',
				LOCALCAST_PROCESS_ROLE: 'worker',
				DATABASE_PATH: '/tmp/localcast-synthetic.sqlite',
				MEDIA_PATH: '/tmp/localcast-synthetic-media',
				TEXT_PROVIDER: 'fake',
				SPEECH_PROVIDER: 'fake',
				LOCALCAST_ALLOW_FAKE_PROVIDERS: 'true',
			});
			expect(environment).not.toHaveProperty('OPENAI_API_KEY');
			expect(environment).not.toHaveProperty('OPENAI_CHAT_MODEL');
			expect(environment).not.toHaveProperty('DOTENV_CONFIG_PATH');
			expect(environment).not.toHaveProperty('LOCALCAST_PODCAST_TOKEN_FILE');
			expect(environment).not.toHaveProperty('SSL_CERT_FILE');
			expect(environment).not.toHaveProperty('NODE_OPTIONS');
			expect(readFile).not.toHaveBeenCalled();
			expect(() => createSmokeChildEnvironment({OPENAI_API_KEY: 'synthetic-sentinel'})).toThrow(/not allowlisted: OPENAI_API_KEY/);
			expect(() => createSmokeChildEnvironment({DOTENV_CONFIG_PATH: syntheticEnvFile})).toThrow(/not allowlisted: DOTENV_CONFIG_PATH/);
		} finally {
			readFile.mockRestore();
			fs.rmSync(syntheticParent, {recursive: true, force: true});
		}
	});

	it('uses absolute repository entries and keeps dotenv-capable production probes in the temporary cwd', () => {
		const apiScript = fs.readFileSync(path.join(repoRoot, 'scripts/smoke-api.mjs'), 'utf8');
		const productionScript = fs.readFileSync(path.join(repoRoot, 'scripts/smoke-production.mjs'), 'utf8');
		const apiEntry = fs.readFileSync(path.join(repoRoot, 'server/index.ts'), 'utf8');
		const fakeWorkerEntry = fs.readFileSync(path.join(repoRoot, 'server/testing/worker.ts'), 'utf8');

		expect(apiScript).not.toContain('...process.env');
		expect(productionScript).not.toContain('...process.env');
		expect(apiEntry).not.toMatch(/dotenv|workerEnvironment/);
		expect(fakeWorkerEntry).not.toMatch(/dotenv|workerEnvironment/);
		expect(productionScript).toContain('cwd: temporaryRoot');
		expect(productionScript).toContain("resolveSmokeEntry(repoRoot, 'dist-server/index.js')");
		expect(productionScript).not.toContain('cwd: repoRoot');
		expect(resolveSmokeEntry(repoRoot, 'dist-server/worker.js')).toBe(path.join(repoRoot, 'dist-server/worker.js'));
		expect(() => resolveSmokeEntry(repoRoot, '../outside.js')).toThrow(/escaped/);
	});
});
