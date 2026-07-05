import {Router} from 'express';
import {createAiProvider} from '../ai/providerFactory';
import {briefingStore} from '../services/briefingStore';

export const followUpRouter = Router();

followUpRouter.post('/follow-up', async (req, res, next) => {
  try {
    const body = req.body as {question?: unknown; context?: unknown; runId?: unknown};
    const question = typeof body.question === 'string' ? body.question.trim() : '';
    const context = typeof body.context === 'string' ? body.context : undefined;
    const runId = typeof body.runId === 'string' ? body.runId : undefined;

    if (!question) {
      res.status(400).json({error: 'question is required'});
      return;
    }

    const run = runId ? briefingStore.getRun(runId) : undefined;
    if (runId && !run) {
      res.status(404).json({error: 'Briefing run not found'});
      return;
    }

    const answer = await createAiProvider().answerFollowUpQuestion({question, context, run});
    res.json({answer});
  } catch (error) {
    next(error);
  }
});
