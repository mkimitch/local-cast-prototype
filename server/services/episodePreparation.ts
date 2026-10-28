import {GenerationError} from '../jobs/types';
import {episodeStore, type EpisodeStore} from './episodeStore';
import {FeedSyncError, rssIngestionService, type RssIngestionService} from './rssIngestion';
import {sourceStore, type SourceStore} from './sourceStore';

export interface EpisodePreparationDependencies {
	episodes?: EpisodeStore;
	rss?: RssIngestionService;
	sources?: SourceStore;
	now?: () => string;
}

export const synchronizeRequestSources = async (
	requestId: string,
	signal: AbortSignal,
	dependencies: EpisodePreparationDependencies = {},
): Promise<void> => {
	const episodes = dependencies.episodes || episodeStore;
	const rss = dependencies.rss || rssIngestionService;
	const sources = dependencies.sources || sourceStore;
	const now = dependencies.now || (() => new Date().toISOString());

	for (const captured of episodes.listRequestSources(requestId)) {
		if (signal.aborted) throw new DOMException('Worker stopped', 'AbortError');
		const source = sources.getSource(captured.sourceId);
		if (!source) {
			episodes.recordRequestSourceSync(requestId, captured.sourceId, {
				status: 'error',
				errorCode: 'SOURCE_NOT_FOUND',
				syncedAt: now(),
			});
			continue;
		}

		try {
			const result = await rss.syncSource(source, {force: true, signal, expectedUrl: captured.sourceUrl});
			episodes.recordRequestSourceSync(requestId, captured.sourceId, {
				status: result.notModified ? 'not_modified' : 'success',
				syncedAt: result.source.lastCheckedAt || now(),
				networkScope: result.source.feedNetworkScope || 'unknown',
			});
		} catch (error) {
			if (signal.aborted || error instanceof DOMException && error.name === 'AbortError') throw error;
			const code = error instanceof FeedSyncError ? error.code : 'FEED_CONNECTION_FAILED';
			episodes.recordRequestSourceSync(requestId, captured.sourceId, {
				status: 'error',
				errorCode: code,
				syncedAt: now(),
			});
			if (code === 'SOURCE_SYNC_IN_PROGRESS' || code === 'SOURCE_SYNC_LEASE_LOST') {
				throw new GenerationError('SOURCE_SYNC_IN_PROGRESS', 'A selected source is already synchronizing; retry after it finishes', true);
			}
		}
	}
};
