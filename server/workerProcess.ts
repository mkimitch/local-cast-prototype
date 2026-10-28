import {randomUUID} from 'node:crypto';
import type {ServerConfig} from './config';
import {closeDatabase} from './database/index';
import type {GenerationJobStore} from './jobs/generationJobStore';
import type {GenerationProcessor} from './jobs/generationProcessor';
import type {ChatProcessor} from './jobs/chatProcessor';
import {ApplicationWorker} from './jobs/applicationWorker';
import type {ChatStore} from './services/chatStore';

export const runWorkerProcess = (
	baseConfig: ServerConfig,
	jobs: GenerationJobStore,
	processor: GenerationProcessor,
	chats: ChatStore,
	chatProcessor: ChatProcessor,
): void => {
	if (baseConfig.processRole !== 'worker') {
		throw new Error('LOCALCAST_PROCESS_ROLE must be worker for the worker entrypoint');
	}

	const config = {...baseConfig, workerId: `${baseConfig.workerId}-${randomUUID()}`};
	const worker = new ApplicationWorker(config, jobs, processor, chats, chatProcessor);
	const workerPromise = worker.start();
	let stopping = false;

	const shutdown = async (signal: string): Promise<void> => {
		if (stopping) return;
		stopping = true;
		console.log(`LocalCast worker stopping after ${signal}`);
		const forcedExit = setTimeout(() => {
			console.error('LocalCast worker shutdown deadline exceeded');
			process.exit(1);
		}, config.shutdownMs);

		await worker.stop();
		await workerPromise;
		clearTimeout(forcedExit);
		closeDatabase();
	};

	process.once('SIGTERM', () => void shutdown('SIGTERM'));
	process.once('SIGINT', () => void shutdown('SIGINT'));

	workerPromise.catch(error => {
		console.error(`LocalCast worker stopped unexpectedly: ${error instanceof Error ? error.name : 'unknown error'}`);
		closeDatabase();
		process.exitCode = 1;
	});

	console.log(`LocalCast worker started as ${config.workerId}`);
};
