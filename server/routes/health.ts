import {Router} from 'express';
import fs from 'node:fs';
import {providerSummaryForConfig, serverConfig} from '../config';
import {db} from '../database/index';
import {inspectDatabaseHealth} from '../database/connection';

export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
	try {
		const database = inspectDatabaseHealth(db);
		fs.accessSync(serverConfig.mediaPath, fs.constants.R_OK | fs.constants.W_OK);
		res.json({
			ok: true,
			service: 'local-cast-api',
			timestamp: new Date().toISOString(),
			runtimeMode: serverConfig.runtimeMode,
			providers: providerSummaryForConfig(serverConfig),
			database,
			mediaWritable: true,
		});
	} catch {
		res.status(503).json({ok: false, service: 'local-cast-api', code: 'NOT_READY'});
	}
});
