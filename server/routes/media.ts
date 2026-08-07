import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {Router} from 'express';
import type {Request, Response} from 'express';
import type {ServerConfig} from '../config';
import {episodeStore} from '../services/episodeStore';
import type {PublishedMediaRecord} from '../services/episodeStore';

type PublishedMediaStore = Pick<typeof episodeStore, 'getPublishedMedia'>;

interface ByteRange {
	start: number;
	end: number;
}

interface OpenedMedia {
	absolutePath: string;
	fd: number;
	lastModified: Date;
}

export interface MediaFailureHandlers {
	notFound: () => void;
	unavailable: () => void;
}

const closeFile = (fd: number): void => {
	try {
		fs.closeSync(fd);
	} catch {
		// The response path is already terminal.
	}
};

const hashFileDescriptor = (fd: number, byteLength: number): string => {
	const hash = createHash('sha256');
	const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, Math.max(1, byteLength)));
	let position = 0;
	while (position < byteLength) {
		const read = fs.readSync(fd, buffer, 0, Math.min(buffer.byteLength, byteLength - position), position);
		if (read <= 0) throw new Error('Published media ended before its persisted byte length');
		hash.update(buffer.subarray(0, read));
		position += read;
	}
	return hash.digest('hex');
};

const openValidatedMedia = (
	config: ServerConfig,
	asset: PublishedMediaRecord,
	failures: MediaFailureHandlers,
): OpenedMedia | undefined => {
	if (
		path.basename(asset.storageFilename) !== asset.storageFilename
		|| asset.storageFilename.startsWith('.')
		|| !asset.storageFilename.endsWith('.mp3')
		|| asset.mimeType !== 'audio/mpeg'
		|| !Number.isSafeInteger(asset.byteLength)
		|| asset.byteLength <= 0
		|| !/^[a-f0-9]{64}$/.test(asset.sha256)
	) {
		failures.notFound();
		return undefined;
	}
	const absolutePath = path.resolve(config.mediaPath, asset.storageFilename);
	const relative = path.relative(config.mediaPath, absolutePath);
	if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
		failures.notFound();
		return undefined;
	}

	let fd: number;
	try {
		fd = fs.openSync(absolutePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
	} catch (error) {
		if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') failures.notFound();
		else failures.unavailable();
		return undefined;
	}

	try {
		const stat = fs.fstatSync(fd);
		if (!stat.isFile() || stat.size !== asset.byteLength || hashFileDescriptor(fd, asset.byteLength) !== asset.sha256) {
			closeFile(fd);
			failures.unavailable();
			return undefined;
		}
		const validatedAt = new Date(asset.validatedAt);
		return {
			absolutePath,
			fd,
			lastModified: Number.isFinite(validatedAt.getTime()) ? validatedAt : stat.mtime,
		};
	} catch {
		closeFile(fd);
		failures.unavailable();
		return undefined;
	}
};

const parseSingleRange = (value: string, byteLength: number): ByteRange | undefined => {
	if (!value.startsWith('bytes=') || value.includes(',')) return undefined;
	const match = /^bytes=(\d*)-(\d*)$/.exec(value);
	if (!match || (!match[1] && !match[2])) return undefined;

	if (!match[1]) {
		const suffixLength = Number(match[2]);
		if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return undefined;
		return {start: Math.max(0, byteLength - suffixLength), end: byteLength - 1};
	}

	const start = Number(match[1]);
	if (!Number.isSafeInteger(start) || start < 0 || start >= byteLength) return undefined;
	if (!match[2]) return {start, end: byteLength - 1};

	const requestedEnd = Number(match[2]);
	if (!Number.isSafeInteger(requestedEnd) || requestedEnd < start) return undefined;
	return {start, end: Math.min(requestedEnd, byteLength - 1)};
};

const weakEtag = (value: string): string => value.startsWith('W/') ? value.slice(2) : value;

const matchesEtag = (header: string | undefined, etag: string): boolean => (
	Boolean(header?.split(',').some(value => value.trim() === '*' || weakEtag(value.trim()) === weakEtag(etag)))
);

const matchesModifiedSince = (header: string | undefined, lastModified: Date): boolean => {
	if (!header) return false;
	const timestamp = Date.parse(header);
	if (!Number.isFinite(timestamp)) return false;
	return Math.floor(lastModified.getTime() / 1_000) <= Math.floor(timestamp / 1_000);
};

const allowsRange = (header: string | undefined, etag: string, lastModified: Date): boolean => {
	if (!header) return true;
	if (header.startsWith('"')) return header === etag;
	return matchesModifiedSince(header, lastModified);
};

export const servePublishedMedia = (
	config: ServerConfig,
	asset: PublishedMediaRecord | undefined,
	req: Request,
	res: Response,
	failures: MediaFailureHandlers,
): void => {
	if (!asset) {
		failures.notFound();
		return;
	}
	const opened = openValidatedMedia(config, asset, failures);
	if (!opened) return;

	const etag = `"${asset.sha256}"`;
	const lastModified = opened.lastModified.toUTCString();
	res.setHeader('Accept-Ranges', 'bytes');
	res.setHeader('Cache-Control', 'private, no-store');
	res.setHeader('Content-Type', 'audio/mpeg');
	res.setHeader('ETag', etag);
	res.setHeader('Last-Modified', lastModified);
	res.setHeader('X-Content-Type-Options', 'nosniff');

	const requestedRange = req.get('Range');
	const ifNoneMatch = req.get('If-None-Match');
	const notModified = ifNoneMatch !== undefined
		? matchesEtag(ifNoneMatch, etag)
		: matchesModifiedSince(req.get('If-Modified-Since'), opened.lastModified);
	if (notModified) {
		closeFile(opened.fd);
		res.status(304).end();
		return;
	}

	let range: ByteRange | undefined;
	if (requestedRange && allowsRange(req.get('If-Range'), etag, opened.lastModified)) {
		range = parseSingleRange(requestedRange, asset.byteLength);
		if (!range) {
			closeFile(opened.fd);
			res.status(416);
			res.setHeader('Content-Range', `bytes */${asset.byteLength}`);
			res.setHeader('Content-Length', '0');
			res.end();
			return;
		}
	}

	const start = range?.start ?? 0;
	const end = range?.end ?? asset.byteLength - 1;
	const responseLength = end - start + 1;
	res.status(range ? 206 : 200);
	res.setHeader('Content-Length', String(responseLength));
	if (range) res.setHeader('Content-Range', `bytes ${start}-${end}/${asset.byteLength}`);

	if (req.method === 'HEAD') {
		closeFile(opened.fd);
		res.end();
		return;
	}

	const stream = fs.createReadStream(opened.absolutePath, {
		autoClose: true,
		fd: opened.fd,
		start,
		end,
	});
	const stopOnClientClose = (): void => {
		if (!stream.destroyed) stream.destroy();
	};
	res.once('close', stopOnClientClose);
	stream.once('close', () => res.off('close', stopOnClientClose));
	stream.once('error', () => {
		if (!res.headersSent) failures.unavailable();
		else res.destroy();
	});
	stream.pipe(res);
};

export const createMediaRouter = (config: ServerConfig, mediaStore: PublishedMediaStore = episodeStore): Router => {
	const router = Router();
	const handler = (req: Request, res: Response): void => servePublishedMedia(
		config,
		mediaStore.getPublishedMedia(req.params.assetId),
		req,
		res,
		{
			notFound: () => res.status(404).json({code: 'MEDIA_NOT_FOUND', error: 'Published audio was not found'}),
			unavailable: () => res.status(503).json({code: 'MEDIA_UNAVAILABLE', error: 'Published audio failed its storage check'}),
		},
	);
	router.route('/media/:assetId').get(handler).head(handler);
	return router;
};
