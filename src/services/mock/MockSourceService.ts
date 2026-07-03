import { Source } from '../../types';
import { SourceService } from '../api';

export class MockSourceService implements SourceService {
  private sources: Source[] = [
    { id: 'src-1', type: 'rss', name: 'TechCrunch', url: 'https://techcrunch.com/feed', category: 'Tech', isActive: true, status: 'healthy', addedAt: new Date(Date.now() - 86400000 * 5).toISOString() },
    { id: 'src-2', type: 'manual_topic', name: 'AI Agents Research', description: 'Latest breakthroughs in autonomous AI systems', category: 'Tech', isActive: true, status: 'syncing', addedAt: new Date(Date.now() - 86400000 * 2).toISOString() },
    { id: 'src-3', type: 'rss', name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', category: 'News', isActive: false, status: 'error', addedAt: new Date(Date.now() - 86400000 * 10).toISOString() }
  ];

  async getSources() { return [...this.sources]; }
  
  async addSource(source: Omit<Source, 'id' | 'addedAt'>) {
    const newSource: Source = { ...source, id: `src-${Date.now()}`, status: 'healthy', addedAt: new Date().toISOString() };
    this.sources = [newSource, ...this.sources];
    return newSource;
  }
  
  async toggleSource(id: string, isActive: boolean) {
    const s = this.sources.find(s => s.id === id);
    if (s) s.isActive = isActive;
  }
  
  async deleteSource(id: string) {
    this.sources = this.sources.filter(s => s.id !== id);
  }
}
