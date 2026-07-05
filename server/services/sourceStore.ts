import type {Source, SourceItem} from '../../src/types';

export type CreateSourceInput = Omit<Source, 'id' | 'addedAt'>;
export type UpdateSourceInput = Partial<Omit<Source, 'id' | 'addedAt'>>;

const cloneSource = (source: Source): Source => ({...source});

class SourceStore {
  private sources: Source[] = [
    {
      id: 'src-1',
      type: 'rss',
      name: 'TechCrunch',
      url: 'https://techcrunch.com/feed',
      category: 'Tech',
      isActive: true,
      status: 'healthy',
      addedAt: new Date(Date.now() - 86400000 * 5).toISOString(),
    },
    {
      id: 'src-2',
      type: 'manual_topic',
      name: 'AI Agents Research',
      description: 'Latest breakthroughs in autonomous AI systems',
      category: 'Tech',
      isActive: true,
      status: 'syncing',
      addedAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    },
    {
      id: 'src-3',
      type: 'rss',
      name: 'The Verge',
      url: 'https://www.theverge.com/rss/index.xml',
      category: 'News',
      isActive: false,
      status: 'error',
      addedAt: new Date(Date.now() - 86400000 * 10).toISOString(),
    },
  ];

  listSources(): Source[] {
    return this.sources.map(cloneSource);
  }

  addSource(input: CreateSourceInput): Source {
    const source: Source = {
      ...input,
      id: `src-${Date.now()}`,
      status: input.status || 'healthy',
      addedAt: new Date().toISOString(),
    };

    this.sources = [source, ...this.sources];
    return cloneSource(source);
  }

  updateSource(id: string, input: UpdateSourceInput): Source | undefined {
    const source = this.sources.find(item => item.id === id);
    if (!source) return undefined;

    Object.assign(source, input);
    return cloneSource(source);
  }

  deleteSource(id: string): boolean {
    const before = this.sources.length;
    this.sources = this.sources.filter(source => source.id !== id);
    return this.sources.length !== before;
  }

  getSourcesByIds(sourceIds: string[]): Source[] {
    const sourceIdSet = new Set(sourceIds);
    return this.sources.filter(source => sourceIdSet.has(source.id)).map(cloneSource);
  }

  getActiveSources(): Source[] {
    return this.sources.filter(source => source.isActive).map(cloneSource);
  }

  buildSourceItems(sourceIds: string[]): SourceItem[] {
    const selectedSources = sourceIds.length > 0 ? this.getSourcesByIds(sourceIds) : this.getActiveSources();
    const now = new Date().toISOString();

    return selectedSources.map((source, index) => ({
      id: `item-${source.id}-${index + 1}`,
      sourceId: source.id,
      title: source.type === 'rss' ? `${source.name} latest update` : source.name,
      content: source.description || source.url || `Mock gathered item from ${source.name}`,
      url: source.url,
      publishedAt: now,
      gatheredAt: now,
    }));
  }
}

export const sourceStore = new SourceStore();
