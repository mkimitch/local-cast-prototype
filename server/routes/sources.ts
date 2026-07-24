import {Router} from 'express';
import {rssIngestionService} from '../services/rssIngestion';
import {sourceStore} from '../services/sourceStore';
import {parseCreateSourceInput, parseUpdateSourceInput} from '../validation';

export const sourcesRouter = Router();

const limitFromQuery = (value: unknown): number => {
  const limit = Number(value || 50);
  return Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 200) : 50;
};

const offsetFromQuery = (value: unknown): number => {
  const offset = Number(value || 0);
  return Number.isFinite(offset) ? Math.max(Math.trunc(offset), 0) : 0;
};

const optionalQueryString = (value: unknown): string | undefined => (
  typeof value === 'string' && value.trim() ? value.trim() : undefined
);

const forceFromQuery = (value: unknown): boolean => value === 'true' || value === '1';

sourcesRouter.get('/sources', (_req, res) => {
  res.json(sourceStore.listSources());
});

sourcesRouter.get('/source-items', (req, res) => {
  res.json(sourceStore.listSourceItems({
    sourceId: typeof req.query.sourceId === 'string' ? req.query.sourceId : undefined,
    limit: limitFromQuery(req.query.limit),
    offset: offsetFromQuery(req.query.offset),
    q: optionalQueryString(req.query.q),
    from: optionalQueryString(req.query.from),
    to: optionalQueryString(req.query.to),
  }));
});

sourcesRouter.get('/sources/:id/items', (req, res) => {
  const source = sourceStore.getSource(req.params.id);
  if (!source) {
    res.status(404).json({error: 'Source not found'});
    return;
  }

  res.json(sourceStore.listSourceItems({
    sourceId: source.id,
    limit: limitFromQuery(req.query.limit),
    offset: offsetFromQuery(req.query.offset),
    q: optionalQueryString(req.query.q),
    from: optionalQueryString(req.query.from),
    to: optionalQueryString(req.query.to),
  }));
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

sourcesRouter.post('/sources/sync', async (req, res) => {
  const result = await rssIngestionService.syncActiveSources({force: forceFromQuery(req.query.force)});
  res.json(result);
});

sourcesRouter.post('/sources/:id/sync', async (req, res) => {
  const source = sourceStore.getSource(req.params.id);
  if (!source) {
    res.status(404).json({error: 'Source not found'});
    return;
  }

  if (source.type !== 'rss') {
    res.status(400).json({error: 'Only RSS sources can be synced'});
    return;
  }

  try {
    res.json(await rssIngestionService.syncSource(source));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown RSS sync error';
    res.status(502).json({error: message});
  }
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
