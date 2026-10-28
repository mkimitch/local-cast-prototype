import {Router} from 'express';
import type {Request, Response} from 'express';
import type {ServerConfig} from '../config';
import {PodcastAccess} from '../podcast/token';
import {serializePodcastFeed} from '../podcast/feed';
import {episodeStore} from '../services/episodeStore';
import {podcastStore} from '../services/podcastStore';
import {servePublishedMedia} from './media';

type PodcastStore = Pick<typeof podcastStore, 'listPublishedEpisodes'>;
type PodcastMediaStore = Pick<typeof episodeStore, 'getPublishedMediaByRunId'>;

export interface PodcastRouterDependencies {
	access?: PodcastAccess;
	podcastEpisodes?: PodcastStore;
	media?: PodcastMediaStore;
}

const noStore = (res: Response): void => {
	res.setHeader('Cache-Control', 'private, no-store');
	res.setHeader('Pragma', 'no-cache');
	res.setHeader('Referrer-Policy', 'no-referrer');
	res.setHeader('X-Content-Type-Options', 'nosniff');
};

export const sendPodcastNotFound = (res: Response): void => {
	noStore(res);
	res.status(404).type('text/plain').send('Not found\n');
};

const sendPodcastUnavailable = (res: Response): void => {
	noStore(res);
	res.status(503).type('text/plain').send('Media unavailable\n');
};

const weakEtag = (value: string): string => value.startsWith('W/') ? value.slice(2) : value;

const isNotModified = (req: Request, etag: string, lastModified?: Date): boolean => {
	const ifNoneMatch = req.get('If-None-Match');
	if (ifNoneMatch !== undefined) {
		return ifNoneMatch.split(',').some(value => value.trim() === '*' || weakEtag(value.trim()) === weakEtag(etag));
	}
	if (!lastModified) return false;
	const ifModifiedSince = req.get('If-Modified-Since');
	if (!ifModifiedSince) return false;
	const timestamp = Date.parse(ifModifiedSince);
	return Number.isFinite(timestamp) && Math.floor(lastModified.getTime() / 1_000) <= Math.floor(timestamp / 1_000);
};

export const createPodcastRouter = (
	config: ServerConfig,
	dependencies: PodcastRouterDependencies = {},
): Router => {
	const router = Router();
	const access = dependencies.access ?? PodcastAccess.load(config);
	const episodes = dependencies.podcastEpisodes ?? podcastStore;
	const media = dependencies.media ?? episodeStore;

	router.get('/api/podcast/status', (_req, res) => {
		noStore(res);
		res.json({
			configured: Boolean(access),
			publicBaseUrl: access?.publicBaseUrl,
			aiGeneratedAudio: true,
			privateFeed: true,
		});
	});

	router.post('/api/podcast/subscription-url', (req, res) => {
		noStore(res);
		if (!access) {
			res.status(503).json({code: 'PODCAST_NOT_CONFIGURED', error: 'Private podcast delivery is not configured'});
			return;
		}
		if (req.get('Origin') !== access.publicBaseUrl) {
			res.status(403).json({code: 'ORIGIN_NOT_ALLOWED', error: 'Request origin is not allowed'});
			return;
		}
		res.json({subscriptionUrl: access.feedUrl()});
	});

	const feedHandler = (req: Request, res: Response): void => {
		if (!access?.isAuthorized(req.params.token)) {
			sendPodcastNotFound(res);
			return;
		}
		const feed = serializePodcastFeed(episodes.listPublishedEpisodes(), access);
		noStore(res);
		res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
		res.setHeader('ETag', feed.etag);
		if (feed.lastModified) res.setHeader('Last-Modified', feed.lastModified.toUTCString());
		if (isNotModified(req, feed.etag, feed.lastModified)) {
			res.status(304).end();
			return;
		}
		res.status(200).setHeader('Content-Length', String(feed.body.byteLength));
		if (req.method === 'HEAD') res.end();
		else res.end(feed.body);
	};

	const enclosureHandler = (req: Request, res: Response): void => {
		if (!access?.isAuthorized(req.params.token)) {
			sendPodcastNotFound(res);
			return;
		}
		servePublishedMedia(config, media.getPublishedMediaByRunId(req.params.runId), req, res, {
			notFound: () => sendPodcastNotFound(res),
			unavailable: () => sendPodcastUnavailable(res),
		});
	};

	router.route('/podcast/:token/feed.xml').get(feedHandler).head(feedHandler);
	router.route('/podcast/:token/episodes/:runId.mp3').get(enclosureHandler).head(enclosureHandler);
	router.all('/podcast', (_req, res) => sendPodcastNotFound(res));
	router.all('/podcast/*', (_req, res) => sendPodcastNotFound(res));
	return router;
};
