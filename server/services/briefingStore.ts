import type {BriefingRun, RunStatus} from '../../src/types';

const cloneRun = (run: BriefingRun): BriefingRun => ({
  ...run,
  sections: run.sections.map(section => ({...section, followUpPrompts: [...section.followUpPrompts], sourceItemIds: [...section.sourceItemIds]})),
  audioAsset: run.audioAsset ? {...run.audioAsset} : undefined,
});

class BriefingStore {
  private runSourceIds = new Map<string, string[]>();

  private runs: BriefingRun[] = [
    {
      id: 'run-1',
      title: 'Morning Briefing',
      status: 'complete',
      createdAt: new Date(Date.now() - 86400000).toISOString(),
      completedAt: new Date(Date.now() - 86400000 + 300000).toISOString(),
      summary: "A quick overview of today's top stories in AI and tech startups.",
      audioAsset: {id: 'audio-1', url: '#', durationMs: 270000, format: 'mp3'},
      sections: [
        {
          id: 'sec-1',
          title: 'Technology & Startups',
          type: 'news_summary',
          spokenText:
            "In today's top news from TechCrunch, several major funding rounds were announced in the autonomous vehicle space. Analysts note that this signals a resurgence in hard-tech investments. Meanwhile, the AI sector continues to dominate headlines with the release of new models focused on reasoning over pure generation.",
          sourceItemIds: ['src-1', 'src-2'],
          importanceScore: 8,
          followUpPrompts: ['What were the specific funding rounds mentioned?', 'Can you elaborate on the new reasoning models?'],
        },
      ],
    },
  ];

  listRuns(): BriefingRun[] {
    return this.runs.map(cloneRun);
  }

  getRun(id: string): BriefingRun | undefined {
    const run = this.runs.find(item => item.id === id);
    return run ? cloneRun(run) : undefined;
  }

  createRun(sourceIds: string[]): BriefingRun {
    const run: BriefingRun = {
      id: `run-${Date.now()}`,
      title: `Briefing - ${new Date().toLocaleDateString()}`,
      status: 'queued',
      createdAt: new Date().toISOString(),
      sections: [],
    };

    this.runSourceIds.set(run.id, [...sourceIds]);
    this.runs = [run, ...this.runs];
    return cloneRun(run);
  }

  updateRun(id: string, patch: Partial<BriefingRun>): BriefingRun | undefined {
    const run = this.runs.find(item => item.id === id);
    if (!run) return undefined;

    Object.assign(run, patch);
    return cloneRun(run);
  }

  updateStatus(id: string, status: RunStatus): BriefingRun | undefined {
    return this.updateRun(id, {status});
  }

  getRunSourceIds(id: string): string[] {
    return [...(this.runSourceIds.get(id) || [])];
  }
}

export const briefingStore = new BriefingStore();
