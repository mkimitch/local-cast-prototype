import './workerEnvironment';
import {serverConfig} from './config';
import {generationJobStore} from './jobs/index';
import {createGenerationProcessor} from './jobs/generationProcessor';
import {createChatProcessor} from './jobs/chatProcessor';
import {runWorkerProcess} from './workerProcess';
import {chatStore} from './services/chatStore';

runWorkerProcess(
	serverConfig,
	generationJobStore,
	createGenerationProcessor(serverConfig, generationJobStore),
	chatStore,
	createChatProcessor(serverConfig, chatStore),
);
