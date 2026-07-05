import {Router} from 'express';
import type {RunStatus} from '../../src/types';
import {createAiProvider} from '../ai/providerFactory';
import {briefingStore} from '../services/briefingStore';
import {sourceStore} from '../services/sourceStore';

export const briefingRunsRouter = Router();

const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

const progressRun = async (runId: string): Promise<void> => {
  const setStatus = (status: RunStatus) => briefingStore.updateStatus(runId, status);

  try {
    await delay(500);
    setStatus('gathering');

    const sourceIds = briefingStore.getRunSourceIds(runId);
    const sourceItems = sourceStore.buildSourceItems(sourceIds);
    const aiProvider = createAiProvider();

    await delay(700);
    setStatus('summarizing_sources');
    const summary = await aiProvider.generateSourceSummary(sourceItems);

    await delay(700);
    setStatus('drafting');
    const sections = await aiProvider.generateBriefingScript({
      sourceItems,
      sourceSummaries: [summary],
      sourceIds,
      requestedAt: new Date().toISOString(),
    });

    await delay(700);
    setStatus('rendering_audio');

    await delay(700);
    briefingStore.updateRun(runId, {
      status: 'complete',
      completedAt: new Date().toISOString(),
      summary,
      sections,
      audioAsset: {id: `audio-${Date.now()}`, url: '#', durationMs: 124000, format: 'mp3'},
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown briefing generation error';
    console.error(`[briefing-run:${runId}] ${message}`);
    briefingStore.updateRun(runId, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      summary: message,
      sections: [],
    });
  }
};

briefingRunsRouter.get('/briefing-runs', (_req, res) => {
  res.json(briefingStore.listRuns());
});

briefingRunsRouter.post('/briefing-runs', (req, res) => {
  const body = req.body as {sourceIds?: unknown};
  const sourceIds = Array.isArray(body.sourceIds) ? body.sourceIds.filter((id): id is string => typeof id === 'string') : [];
  const run = briefingStore.createRun(sourceIds);

  void progressRun(run.id);

  res.status(201).json(run);
});

briefingRunsRouter.get('/briefing-runs/:id', (req, res) => {
  const run = briefingStore.getRun(req.params.id);
  if (!run) {
    res.status(404).json({error: 'Briefing run not found'});
    return;
  }

  res.json(run);
});
