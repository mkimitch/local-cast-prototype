import {Router} from 'express';
import type {AppSettings} from '../../src/types';
import {settingsStore} from '../services/settingsStore';

export const settingsRouter = Router();

const isSettingsBody = (body: unknown): body is AppSettings => (
  typeof body === 'object' && body !== null && !Array.isArray(body)
);

settingsRouter.get('/settings', (_req, res) => {
  res.json(settingsStore.getSettings());
});

settingsRouter.put('/settings', (req, res) => {
  if (!isSettingsBody(req.body)) {
    res.status(400).json({error: 'settings body is required'});
    return;
  }

  res.json(settingsStore.saveSettings(req.body));
});
