import { Source, SourceItem } from '../../types';
import { SourceService } from '../api';

export class MockSourceService implements SourceService {
  private sources: Source[] = [
    { id: 'src-1', type: 'rss', name: 'TechCrunch', url: 'https://techcrunch.com/feed', category: 'Tech', isActive: true, status: 'healthy', addedAt: new Date(Date.now() - 86400000 * 5).toISOString(), lastSyncedAt: new Date(Date.now() - 3600000).toISOString(), lastSyncStatus: 'success', consecutiveSyncFailures: 0, itemCount: 2 },
    { id: 'src-2', type: 'manual_topic', name: 'AI Agents Research', description: 'Latest breakthroughs in autonomous AI systems', category: 'Tech', isActive: true, status: 'syncing', addedAt: new Date(Date.now() - 86400000 * 2).toISOString(), itemCount: 0 },
    { id: 'src-3', type: 'rss', name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', category: 'News', isActive: false, status: 'error', addedAt: new Date(Date.now() - 86400000 * 10).toISOString(), lastSyncStatus: 'error', lastSyncError: 'Mock feed error', consecutiveSyncFailures: 1, nextSyncAfter: new Date(Date.now() + 900000).toISOString(), itemCount: 0 }
  ];

  private sourceItems: SourceItem[] = [
    {
      id: 'mock-item-1',
      sourceId: 'src-1',
      title: 'TechCrunch latest update',
      content: 'A mock RSS item that represents a stored source item for review mode.',
      url: 'https://techcrunch.com/feed',
      publishedAt: new Date(Date.now() - 7200000).toISOString(),
      gatheredAt: new Date(Date.now() - 3600000).toISOString(),
    },
    {
      id: 'mock-item-2',
      sourceId: 'src-1',
      title: 'AI funding round analysis',
      content: 'Another mock source item used to keep mock mode functional without a backend.',
      publishedAt: new Date(Date.now() - 10800000).toISOString(),
      gatheredAt: new Date(Date.now() - 3600000).toISOString(),
    },
  ];

  async getSources() { return [...this.sources]; }

  async getSourceItems(sourceId: string) {
    return this.sourceItems.filter(item => item.sourceId === sourceId);
  }
  
  async addSource(source: Omit<Source, 'id' | 'addedAt'>) {
    const newSource: Source = { ...source, id: `src-${Date.now()}`, status: 'healthy', addedAt: new Date().toISOString() };
    this.sources = [newSource, ...this.sources];
    return newSource;
  }
  
  async toggleSource(id: string, isActive: boolean) {
    const s = this.sources.find(s => s.id === id);
    if (s) s.isActive = isActive;
  }

  async syncSource(id: string) {
    const s = this.sources.find(s => s.id === id);
    if (s && s.type === 'rss') {
      s.status = 'healthy';
      s.lastSyncedAt = new Date().toISOString();
      s.lastSyncStatus = 'success';
      s.lastSyncError = undefined;
      s.consecutiveSyncFailures = 0;
      s.nextSyncAfter = undefined;
    }
  }
  
  async deleteSource(id: string) {
    this.sources = this.sources.filter(s => s.id !== id);
  }
}
