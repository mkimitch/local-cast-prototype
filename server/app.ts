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
import {stationsRouter} from './routes/stations';
import {createMediaRouter} from './routes/media';
import {createPodcastRouter, sendPodcastNotFound} from './routes/podcast';

const isAllowedOrigin = (config: ServerConfig, origin: string): boolean => {
	const url = new URL(origin);
	return origin === url.origin && !url.username && !url.password && config.trustedOrigins.includes(url.origin);
};

const optionalExactHeader = (req: Request, name: string, expected: string): boolean => {
	const value = req.headers[name];
	if (value === undefined) return true;
	return typeof value === 'string' && !value.includes(',') && value.trim().toLowerCase() === expected.toLowerCase();
};

const isCanonicalProxyRequest = (config: ServerConfig, req: Request): boolean => {
	if (!config.publicBaseUrl) return true;
	const publicUrl = new URL(config.publicBaseUrl);
	const host = req.headers.host;
	if (typeof host !== 'string' || host.toLowerCase() !== publicUrl.host.toLowerCase()) return false;
	if (req.headers.forwarded !== undefined) return false;
	if (!optionalExactHeader(req, 'x-forwarded-host', publicUrl.host)) return false;
	if (!optionalExactHeader(req, 'x-forwarded-proto', publicUrl.protocol.slice(0, -1))) return false;
	const expectedPort = publicUrl.port || (publicUrl.protocol === 'https:' ? '443' : '80');
	if (!optionalExactHeader(req, 'x-forwarded-port', expectedPort)) return false;
	return true;
};

const isPodcastTarget = (req: Request): boolean => {
	const pathname = req.originalUrl.split('?', 1)[0];
	return pathname === '/podcast' || pathname.startsWith('/podcast/');
};

export const createApp = (config: ServerConfig) => {
	const app = express();
	app.disable('x-powered-by');
	app.set('trust proxy', false);
	app.use(express.json({limit: '1mb'}));

	app.use((req, res, next) => {
		const correlationId = randomUUID();
		res.locals.correlationId = correlationId;
		res.header('X-Correlation-Id', correlationId);
		res.header('Referrer-Policy', 'no-referrer');

		if (!isCanonicalProxyRequest(config, req)) {
			if (isPodcastTarget(req)) sendPodcastNotFound(res);
			else res.status(421).json({code: 'MISDIRECTED_REQUEST', error: 'Request host is not accepted', correlationId});
			return;
		}

		const origin = req.headers.origin;
		if (typeof origin === 'string') {
			let allowed = false;
			try {
				allowed = isAllowedOrigin(config, origin);
			} catch {
				allowed = false;
			}

			if (!allowed) {
				if (isPodcastTarget(req)) sendPodcastNotFound(res);
				else res.status(403).json({code: 'ORIGIN_NOT_ALLOWED', error: 'Request origin is not allowed', correlationId});
				return;
			}

			res.header('Access-Control-Allow-Origin', origin);
			res.header('Vary', 'Origin');
		}

		res.header('Access-Control-Allow-Headers', 'Content-Type, Idempotency-Key');
		res.header('Access-Control-Allow-Methods', 'GET,HEAD,POST,PATCH,PUT,DELETE,OPTIONS');
		if (req.method === 'OPTIONS') {
			res.status(204).send();
			return;
		}

		next();
	});

	app.use('/api', healthRouter);
	app.use('/api', sourcesRouter);
	app.use('/api', stationsRouter);
	app.use('/api', briefingRunsRouter);
	app.use('/api', settingsRouter);
	app.use('/api', followUpRouter);
	app.use(createPodcastRouter(config));
	app.use(createMediaRouter(config));

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

	app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
		if (isPodcastTarget(req)) {
			sendPodcastNotFound(res);
			return;
		}
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
