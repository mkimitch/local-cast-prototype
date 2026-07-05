import {Router} from 'express';
import type {Source, SourceStatus, SourceType} from '../../src/types';
import {sourceStore} from '../services/sourceStore';
import type {CreateSourceInput, UpdateSourceInput} from '../services/sourceStore';

export const sourcesRouter = Router();

const sourceTypes: SourceType[] = ['rss', 'manual_topic', 'local_file', 'gmail_placeholder', 'calendar_placeholder'];
const sourceStatuses: SourceStatus[] = ['healthy', 'error', 'syncing'];

const optionalString = (value: unknown): string | undefined => (
  typeof value === 'string' && value.trim() ? value.trim() : undefined
);

const isSourceType = (value: unknown): value is SourceType => (
  typeof value === 'string' && sourceTypes.includes(value as SourceType)
);

const isSourceStatus = (value: unknown): value is SourceStatus => (
  typeof value === 'string' && sourceStatuses.includes(value as SourceStatus)
);

const asSourceBody = (body: unknown): Partial<Source> => (
  typeof body === 'object' && body !== null && !Array.isArray(body) ? body as Partial<Source> : {}
);

const createSourceInput = (body: Partial<Source>): CreateSourceInput => ({
  type: isSourceType(body.type) ? body.type : 'manual_topic',
  name: optionalString(body.name) || 'Untitled Source',
  url: optionalString(body.url),
  description: optionalString(body.description),
  category: optionalString(body.category),
  isActive: typeof body.isActive === 'boolean' ? body.isActive : true,
  status: isSourceStatus(body.status) ? body.status : 'healthy',
});

const updateSourceInput = (body: Partial<Source>): UpdateSourceInput => {
  const input: UpdateSourceInput = {};

  if (isSourceType(body.type)) input.type = body.type;
  if (typeof body.name === 'string') input.name = body.name.trim() || 'Untitled Source';
  if ('url' in body) input.url = optionalString(body.url);
  if ('description' in body) input.description = optionalString(body.description);
  if ('category' in body) input.category = optionalString(body.category);
  if (typeof body.isActive === 'boolean') input.isActive = body.isActive;
  if (isSourceStatus(body.status)) input.status = body.status;

  return input;
};

sourcesRouter.get('/sources', (_req, res) => {
  res.json(sourceStore.listSources());
});

sourcesRouter.post('/sources', (req, res) => {
  const source = sourceStore.addSource(createSourceInput(asSourceBody(req.body)));
  res.status(201).json(source);
});

sourcesRouter.patch('/sources/:id', (req, res) => {
  const source = sourceStore.updateSource(req.params.id, updateSourceInput(asSourceBody(req.body)));
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
