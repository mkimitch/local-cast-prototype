import express from 'express';
import type {NextFunction, Request, Response} from 'express';
import {serverConfig} from './config';
import {briefingRunsRouter} from './routes/briefingRuns';
import {followUpRouter} from './routes/followUp';
import {healthRouter} from './routes/health';
import {settingsRouter} from './routes/settings';
import {sourcesRouter} from './routes/sources';

const app = express();

app.use(express.json({limit: '1mb'}));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(204).send();
    return;
  }

  next();
});

app.use('/api', healthRouter);
app.use('/api', sourcesRouter);
app.use('/api', briefingRunsRouter);
app.use('/api', settingsRouter);
app.use('/api', followUpRouter);

app.use((_req, res) => {
  res.status(404).json({error: 'Not found'});
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = error instanceof Error ? error.message : 'Unexpected server error';
  console.error(message);
  res.status(500).json({error: message});
});

app.listen(serverConfig.port, () => {
  console.log(`LocalCast API listening on http://localhost:${serverConfig.port}/api`);
  console.log(`AI provider: ${serverConfig.aiProvider}`);
});
