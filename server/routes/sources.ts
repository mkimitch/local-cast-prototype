import {Router} from 'express';
import {sourceStore} from '../services/sourceStore';
import {parseCreateSourceInput, parseUpdateSourceInput} from '../validation';

export const sourcesRouter = Router();

sourcesRouter.get('/sources', (_req, res) => {
  res.json(sourceStore.listSources());
});

sourcesRouter.post('/sources', (req, res) => {
  const parsed = parseCreateSourceInput(req.body);
  if (parsed.ok === false) {
    res.status(400).json({error: parsed.error});
    return;
  }

  const source = sourceStore.addSource(parsed.value);
  res.status(201).json(source);
});

sourcesRouter.patch('/sources/:id', (req, res) => {
  const parsed = parseUpdateSourceInput(req.body);
  if (parsed.ok === false) {
    res.status(400).json({error: parsed.error});
    return;
  }

  const source = sourceStore.updateSource(req.params.id, parsed.value);
  if (!source) {
    res.status(404).json({error: 'Source not found'});
    return;
  }

  res.json(source);
});

sourcesRouter.delete('/sources/:id', (req, res) => {
  const deleted = sourceStore.deleteSource(req.params.id);
  if (!deleted) {
    res.status(404).json({error: 'Source not found'});
    return;
  }

  res.status(204).send();
});
