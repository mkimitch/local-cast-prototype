import {Router} from 'express';
import {serverConfig} from '../config';

export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'local-cast-api',
    timestamp: new Date().toISOString(),
    aiProvider: serverConfig.aiProvider,
    aiModel: serverConfig.aiModel,
  });
});
