import { BriefingRun } from '../../types';
import { BriefingService } from '../api';
import { getAiProvider } from './MockAiProvider';
import { MockProviderService } from './MockProviderService';

// We need a way to get settings here, in a real app this would be injected
// For mock, we'll just use a singleton pattern in the index.ts
let providerServiceInstance: MockProviderService;
export function setProviderService(service: MockProviderService) {
  providerServiceInstance = service;
}

export class MockBriefingService implements BriefingService {
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
        
        const settings = await providerServiceInstance.getSettings();
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
