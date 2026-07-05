import {Router} from 'express';
import {createAiProvider} from '../ai/providerFactory';
import {briefingStore} from '../services/briefingStore';
import {parseFollowUpRequest} from '../validation';

export const followUpRouter = Router();

followUpRouter.post('/follow-up', async (req, res, next) => {
  try {
    const parsed = parseFollowUpRequest(req.body);
    if (parsed.ok === false) {
      res.status(400).json({error: parsed.error});
      return;
    }

    const {question, context, runId} = parsed.value;

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
