import {serverConfig} from '../config';
import {generationJobStore} from '../jobs/index';
import {runWorkerProcess} from '../workerProcess';
import {DeterministicFakeGenerationProcessor} from './fakeGenerationProcessor';

if (serverConfig.runtimeMode !== 'test' || !serverConfig.allowFakeProviders) {
	throw new Error('The deterministic worker entrypoint requires explicit test mode and fake-provider opt-in');
}

runWorkerProcess(serverConfig, generationJobStore, new DeterministicFakeGenerationProcessor(serverConfig, generationJobStore));
