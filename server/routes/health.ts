import {Router} from 'express';
import fs from 'node:fs';
import {serverConfig} from '../config';
import {db} from '../database/index';
import {inspectDatabaseHealth} from '../database/connection';
import {openAiCredentialService} from '../services/openAiCredentialService';
import {createHealthDiagnostics, type HealthStage} from './healthDiagnostics';

const defaultDependencies = {
	inspectDatabase: () => inspectDatabaseHealth(db),
	checkMediaAccess: () => fs.accessSync(serverConfig.mediaPath, fs.constants.R_OK | fs.constants.W_OK),
	providerSummary: () => openAiCredentialService.providerSummary(serverConfig),
};

export const createHealthRouter = (
	dependencies = defaultDependencies,
	diagnostics = createHealthDiagnostics(),
): Router => {
	const router = Router();
	router.get('/health', (_req, res) => {
		let stage: HealthStage = 'database_audit';
		try {
			const database = dependencies.inspectDatabase();
			stage = 'media_access';
			dependencies.checkMediaAccess();
			stage = 'response';
			const timestamp = new Date().toISOString();
			stage = 'provider_summary';
			const providers = dependencies.providerSummary();
			stage = 'response';
			res.json({
				ok: true,
				service: 'local-cast-api',
				timestamp,
				runtimeMode: serverConfig.runtimeMode,
				providers,
				database,
				mediaWritable: true,
			});
			diagnostics.recovery();
		} catch (error) {
			diagnostics.failure(stage, error);
			res.status(503).json({ok: false, service: 'local-cast-api', code: 'NOT_READY'});
		}
	});
	return router;
};

export const healthRouter = createHealthRouter();
