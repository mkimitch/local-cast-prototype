import {Router} from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import type {ServerConfig} from '../config';
import {episodeStore} from '../services/episodeStore';

type PublishedMediaStore = Pick<typeof episodeStore, 'getPublishedMedia'>;

export const createMediaRouter = (config: ServerConfig, mediaStore: PublishedMediaStore = episodeStore): Router => {
	const router = Router();
	router.get('/media/:assetId', (req, res) => {
		const asset = mediaStore.getPublishedMedia(req.params.assetId);
		if (!asset || path.basename(asset.storageFilename) !== asset.storageFilename) {
			res.status(404).json({code: 'MEDIA_NOT_FOUND', error: 'Published audio was not found'});
			return;
		}
		const absolutePath = path.resolve(config.mediaPath, asset.storageFilename);
		const relative = path.relative(config.mediaPath, absolutePath);
		if (relative.startsWith('..') || path.isAbsolute(relative)) {
			res.status(404).json({code: 'MEDIA_NOT_FOUND', error: 'Published audio was not found'});
			return;
		}
		let stat: fs.Stats;
		try {
			stat = fs.lstatSync(absolutePath);
		} catch {
			res.status(404).json({code: 'MEDIA_NOT_FOUND', error: 'Published audio was not found'});
			return;
		}
		if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== asset.byteLength) {
			res.status(503).json({code: 'MEDIA_UNAVAILABLE', error: 'Published audio failed its storage check'});
			return;
		}
		let sha256: string;
		try {
			sha256 = createHash('sha256').update(fs.readFileSync(absolutePath)).digest('hex');
		} catch {
			res.status(503).json({code: 'MEDIA_UNAVAILABLE', error: 'Published audio failed its storage check'});
			return;
		}
		if (sha256 !== asset.sha256) {
			res.status(503).json({code: 'MEDIA_UNAVAILABLE', error: 'Published audio failed its storage check'});
			return;
		}
		res.status(200);
		res.setHeader('Content-Type', asset.mimeType);
		res.setHeader('Content-Length', String(asset.byteLength));
		res.setHeader('ETag', `"${asset.sha256}"`);
		res.setHeader('Cache-Control', 'private, no-store');
		res.setHeader('X-Content-Type-Options', 'nosniff');
		fs.createReadStream(absolutePath).on('error', () => {
			if (!res.headersSent) res.status(503).end();
			else res.destroy();
		}).pipe(res);
	});
	return router;
};
