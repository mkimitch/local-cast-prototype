import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localcast-e2e-'));
const port = process.env.E2E_PORT || '43179';
const environment = {
	...process.env,
	NODE_ENV: 'production',
	LOCALCAST_RUNTIME_MODE: 'production',
	LOCALCAST_HOST: '127.0.0.1',
	PORT: port,
	DATABASE_PATH: path.join(root, 'data', 'localcast.sqlite'),
	MEDIA_PATH: path.join(root, 'media'),
	LOCALCAST_WEB_DIST_PATH: path.resolve('dist'),
	LOCALCAST_INSTALLATION_ID: `localcast-e2e-installation-${process.pid}`,
	LOCALCAST_TRUSTED_ORIGINS: `http://127.0.0.1:${port}`,
	TEXT_PROVIDER: 'not_configured',
	SPEECH_PROVIDER: 'not_configured',
	LOCALCAST_ALLOW_FAKE_PROVIDERS: 'false',
};

const runInitialization = () => new Promise((resolve, reject) => {
	const child = spawn(process.execPath, ['dist-server/storageInit.js'], {
		env: {...environment, LOCALCAST_PROCESS_ROLE: 'storage-init'},
		stdio: 'inherit',
	});
	child.once('error', reject);
	child.once('exit', code => code === 0 ? resolve() : reject(new Error(`E2E storage initialization exited ${code}`)));
});

await runInitialization();
const application = spawn(process.execPath, ['dist-server/index.js'], {
	env: {...environment, LOCALCAST_PROCESS_ROLE: 'app'},
	stdio: 'inherit',
});

let stopping = false;
const stop = signal => {
	if (stopping) return;
	stopping = true;
	if (application.exitCode === null) application.kill(signal);
};

process.once('SIGTERM', () => stop('SIGTERM'));
process.once('SIGINT', () => stop('SIGINT'));

const exitCode = await new Promise((resolve, reject) => {
	application.once('error', reject);
	application.once('exit', code => resolve(code ?? 1));
});

fs.rmSync(root, {recursive: true, force: true});
process.exitCode = stopping ? 0 : exitCode;
