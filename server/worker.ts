import './workerEnvironment';
import {serverConfig} from './config';
import {generationJobStore} from './jobs/index';
import {createGenerationProcessor} from './jobs/generationProcessor';
import {runWorkerProcess} from './workerProcess';

runWorkerProcess(serverConfig, generationJobStore, createGenerationProcessor(serverConfig, generationJobStore));
