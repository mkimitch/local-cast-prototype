import type {Server} from 'node:http';
import {createApp} from './app';
import {serverConfig} from './config';
import {closeDatabase} from './database/index';
import {openAiCredentialService} from './services/openAiCredentialService';

if (serverConfig.processRole !== 'app') {
	throw new Error('LOCALCAST_PROCESS_ROLE must be app for the application entrypoint');
}

const app = createApp(serverConfig);
let server: Server;
let stopping = false;

const closeServer = (): Promise<void> => new Promise((resolve, reject) => {
	server.close(error => error ? reject(error) : resolve());
});

const shutdown = async (signal: string): Promise<void> => {
	if (stopping) return;
	stopping = true;
	console.log(`LocalCast application stopping after ${signal}`);
	const forcedExit = setTimeout(() => {
		console.error('LocalCast application shutdown deadline exceeded');
		server.closeAllConnections();
		closeDatabase();
		process.exit(1);
	}, serverConfig.shutdownMs);
	try {
		await closeServer();
	} finally {
		clearTimeout(forcedExit);
		closeDatabase();
	}
};

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

server = app.listen(serverConfig.port, serverConfig.host, () => {
	const providers = openAiCredentialService.providerSummary(serverConfig);
	console.log(`LocalCast listening on http://${serverConfig.host}:${serverConfig.port}`);
	console.log(`Text provider: ${providers.text.status}; speech provider: ${providers.speech.status}`);
});

server.on('error', error => {
	console.error(`LocalCast application failed to listen: ${error.name}`);
	closeDatabase();
	process.exitCode = 1;
});
