import { Source, BriefingRun, AppSettings } from './types';
import { getAiProvider } from './ai-providers';

export interface SourceService {
  getSources(): Promise<Source[]>;
  addSource(source: Omit<Source, 'id' | 'addedAt'>): Promise<Source>;
  toggleSource(id: string, isActive: boolean): Promise<void>;
  deleteSource(id: string): Promise<void>;
}

export interface BriefingService {
  getRuns(): Promise<BriefingRun[]>;
  getRun(id: string): Promise<BriefingRun | undefined>;
  startRun(sourceIds: string[]): Promise<BriefingRun>;
}

export interface ProviderService {
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<void>;
}

class MockSourceService implements SourceService {
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

class MockBriefingService implements BriefingService {
  private runs: BriefingRun[] = [
    {
      id: 'run-1',
      title: 'Morning Briefing',
      status: 'complete',
      createdAt: new Date(Date.now() - 86400000).toISOString(),
      completedAt: new Date(Date.now() - 86400000 + 300000).toISOString(),
      summary: "A quick overview of today's top stories in AI and tech startups.",
      audioAsset: { id: 'audio-1', url: '#', durationMs: 270000, format: 'mp3' },
      sections: [
         {
           id: 'sec-1',
           title: 'Technology & Startups',
           type: 'news_summary',
           spokenText: "In today's top news from TechCrunch, several major funding rounds were announced in the autonomous vehicle space. Analysts note that this signals a resurgence in hard-tech investments. Meanwhile, the AI sector continues to dominate headlines with the release of new models focused on reasoning over pure generation.",
           sourceItemIds: ['src-1', 'src-2'],
           importanceScore: 8,
           followUpPrompts: [
             "What were the specific funding rounds mentioned?",
             "Can you elaborate on the new reasoning models?"
           ]
         }
      ]
    }
  ];

  async getRuns() { return [...this.runs]; }
  
  async getRun(id: string) { return this.runs.find(r => r.id === id); }
  
  async startRun(sourceIds: string[]) {
    const runId = `run-${Date.now()}`;
    const newRun: BriefingRun = {
      id: runId,
      title: `Briefing - ${new Date().toLocaleDateString()}`,
      status: 'queued',
      createdAt: new Date().toISOString(),
      sections: []
    };
    this.runs = [newRun, ...this.runs];

    // Simulate background progression
    setTimeout(() => {
      const r = this.runs.find(r => r.id === runId);
      if (r) r.status = 'gathering';
    }, 1500);

    setTimeout(() => {
      const r = this.runs.find(r => r.id === runId);
      if (r) r.status = 'summarizing_sources';
    }, 3000);

    setTimeout(() => {
      const r = this.runs.find(r => r.id === runId);
      if (r) r.status = 'drafting';
    }, 4500);

    setTimeout(async () => {
      const r = this.runs.find(r => r.id === runId);
      if (r) {
        r.status = 'rendering_audio';
        
        const settings = await providerService.getSettings();
        const provider = getAiProvider(settings.aiProvider);
        
        r.summary = await provider.generateSourceSummary([]);
        r.sections = await provider.generateBriefingScript([r.summary]);
      }
    }, 6000);

    setTimeout(() => {
      const r = this.runs.find(r => r.id === runId);
      if (r) {
        r.status = 'complete';
        r.completedAt = new Date().toISOString();
        r.audioAsset = { id: `audio-${Date.now()}`, url: '#', durationMs: 124000, format: 'mp3' };
      }
    }, 9000);

    return newRun;
  }
}

class MockProviderService implements ProviderService {
  private settings: AppSettings = {
    aiProvider: 'mock',
    aiConfig: { model: 'mock-model' },
    ttsProvider: 'local',
    ttsConfig: {},
    scheduleTime: '07:00',
    isScheduleActive: false,
    orbTheme: 'amber'
  };
  
  async getSettings() { return { ...this.settings }; }
  
  async saveSettings(settings: AppSettings) { this.settings = { ...settings }; }
}

export const sourceService = new MockSourceService();
export const briefingService = new MockBriefingService();
export const providerService = new MockProviderService();
