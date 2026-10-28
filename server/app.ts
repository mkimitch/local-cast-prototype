import express from 'express';
import type {NextFunction, Request, Response} from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {ServerConfig} from './config';
import {briefingRunsRouter} from './routes/briefingRuns';
import {chatRouter} from './routes/chat';
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

const contentSecurityPolicy = [
	"default-src 'self'",
	"base-uri 'none'",
	"connect-src 'self'",
	"font-src 'self'",
	"form-action 'self'",
	"frame-ancestors 'none'",
	"frame-src 'none'",
	"img-src 'self' data:",
	"manifest-src 'self'",
	"media-src 'self'",
	"object-src 'none'",
	"script-src 'self'",
	"style-src 'self' 'unsafe-inline'",
	"worker-src 'none'",
].join('; ');

const applySecurityHeaders = (res: Response): void => {
	res.header('Content-Security-Policy', contentSecurityPolicy);
	res.header('Cross-Origin-Opener-Policy', 'same-origin');
	res.header('Cross-Origin-Resource-Policy', 'same-origin');
	res.header('Permissions-Policy', 'camera=(), geolocation=(), microphone=(), payment=(), usb=()');
	res.header('Referrer-Policy', 'no-referrer');
	res.header('X-Content-Type-Options', 'nosniff');
	res.header('X-Frame-Options', 'DENY');
};

const parserErrorStatus = (error: unknown): {status: 400 | 413; code: string; message: string} | undefined => {
	if (!error || typeof error !== 'object') return undefined;
	const value = error as {status?: unknown; type?: unknown};
	if (value.status === 413 || value.type === 'entity.too.large') {
		return {status: 413, code: 'REQUEST_TOO_LARGE', message: 'The request body exceeded the allowed size'};
	}
	if (value.status === 400 && (value.type === 'entity.parse.failed' || error instanceof SyntaxError)) {
		return {status: 400, code: 'INVALID_JSON', message: 'The request body is not valid JSON'};
	}
	return undefined;
};

export const createApp = (config: ServerConfig) => {
	const app = express();
	app.disable('x-powered-by');
	app.set('trust proxy', false);

	app.use((req, res, next) => {
		const correlationId = randomUUID();
		res.locals.correlationId = correlationId;
		res.header('X-Correlation-Id', correlationId);
		applySecurityHeaders(res);

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
	app.use(express.json({limit: '1mb'}));

	app.use('/api', healthRouter);
	app.use('/api', sourcesRouter);
	app.use('/api', stationsRouter);
	app.use('/api', briefingRunsRouter);
	app.use('/api', chatRouter);
	app.use('/api', settingsRouter);
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
		const parserFailure = parserErrorStatus(error);
		if (parserFailure) {
			res.status(parserFailure.status).json({
				code: parserFailure.code,
				error: parserFailure.message,
				correlationId,
			});
			return;
		}
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
