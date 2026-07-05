import {Router} from 'express';
import {settingsStore} from '../services/settingsStore';
import {parseSettingsBody} from '../validation';

export const settingsRouter = Router();

settingsRouter.get('/settings', (_req, res) => {
  res.json(settingsStore.getSettings());
});

settingsRouter.put('/settings', (req, res) => {
  const parsed = parseSettingsBody(req.body);
  if (parsed.ok === false) {
    res.status(400).json({error: parsed.error});
    return;
  }

  res.json(settingsStore.saveSettings(parsed.value));
});
