import type {Source, SourceItem} from '../../src/types';
import {rssIngestionService} from './rssIngestion';
import {sourceStore} from './sourceStore';

const createEphemeralItemId = (sourceId: string): string => `item-${sourceId}-empty-${Date.now()}`;

const emptyRssItem = (source: Source, reason?: string): SourceItem => ({
	id: createEphemeralItemId(source.id),
	sourceId: source.id,
	title: `${source.name} has no available RSS items`,
	content: reason
		? `LocalCast could not gather recent RSS items from ${source.name}: ${reason}`
		: `LocalCast could not find stored RSS items for ${source.name}. Sync this source and try again.`,
	url: source.url,
	gatheredAt: new Date().toISOString(),
});

export const buildBriefingSourceItems = async (sourceIds: string[]): Promise<SourceItem[]> => {
	const selectedSources = sourceIds.length > 0 ? sourceStore.getSourcesByIds(sourceIds) : sourceStore.getActiveSources();
	const sourceItems: SourceItem[] = [];

	for (const source of selectedSources) {
		if (source.type === 'rss') {
			let items = sourceStore.listSourceItems({sourceId: source.id, limit: 5});

			if (items.length === 0) {
				try {
					await rssIngestionService.syncSource(source, {force: false});
					items = sourceStore.listSourceItems({sourceId: source.id, limit: 5});
				} catch (error) {
					const message = error instanceof Error ? error.message : 'Unknown RSS sync error';
					sourceItems.push(emptyRssItem(source, message));
					continue;
				}
			}

			sourceItems.push(...(items.length > 0 ? items : [emptyRssItem(source)]));
			continue;
		}

		if (source.type === 'manual_topic') {
			sourceItems.push(sourceStore.createManualSourceItem(source));
		}
	}

	return sourceItems;
};
