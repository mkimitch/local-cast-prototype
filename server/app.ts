import express from 'express';
import type {NextFunction, Request, Response} from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {ServerConfig} from './config';
import {briefingRunsRouter} from './routes/briefingRuns';
import {followUpRouter} from './routes/followUp';
import {healthRouter} from './routes/health';
import {settingsRouter} from './routes/settings';
import {sourcesRouter} from './routes/sources';

const isAllowedOrigin = (config: ServerConfig, origin: string): boolean => config.trustedOrigins.includes(new URL(origin).origin);

export const createApp = (config: ServerConfig) => {
	const app = express();
	app.disable('x-powered-by');
	app.use(express.json({limit: '1mb'}));

	app.use((req, res, next) => {
		const correlationId = randomUUID();
		res.locals.correlationId = correlationId;
		res.header('X-Correlation-Id', correlationId);

		const origin = req.headers.origin;
		if (typeof origin === 'string') {
			let allowed = false;
			try {
				allowed = isAllowedOrigin(config, origin);
			} catch {
				allowed = false;
			}

			if (!allowed) {
				res.status(403).json({code: 'ORIGIN_NOT_ALLOWED', error: 'Request origin is not allowed', correlationId});
				return;
			}

			res.header('Access-Control-Allow-Origin', origin);
			res.header('Vary', 'Origin');
		}

		res.header('Access-Control-Allow-Headers', 'Content-Type, Idempotency-Key');
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

	app.use('/api', (_req, res) => {
		res.status(404).json({code: 'NOT_FOUND', error: 'API route not found', correlationId: res.locals.correlationId});
	});

	const indexPath = path.join(config.webDistPath, 'index.html');
	if (fs.existsSync(indexPath)) {
		app.use(express.static(config.webDistPath, {index: false, fallthrough: true}));
		app.get('*', (_req, res) => res.sendFile(indexPath));
	} else {
		app.get('*', (_req, res) => {
			res.status(503).type('text/plain').send('LocalCast web build is unavailable');
		});
	}

	app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
		const correlationId = res.locals.correlationId as string | undefined;
		const errorName = error instanceof Error ? error.name : 'UnknownError';
		console.error(`[request:${correlationId || 'unknown'}] ${errorName}`);
		res.status(500).json({
			code: 'INTERNAL_ERROR',
			error: 'Unexpected server error',
			correlationId,
		});
	});

	return app;
};
