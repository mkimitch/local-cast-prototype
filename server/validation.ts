import type {AppSettings, Source, SourceStatus, SourceType} from '../src/types';
import type {CreateSourceInput, UpdateSourceInput} from './services/sourceStore';

type ValidationResult<T> = {ok: true; value: T} | {ok: false; error: string};

const sourceTypes: SourceType[] = ['rss', 'manual_topic', 'local_file', 'gmail_placeholder', 'calendar_placeholder'];
const sourceStatuses: SourceStatus[] = ['healthy', 'error', 'syncing'];
const aiProviders: AppSettings['aiProvider'][] = ['mock', 'openai_placeholder', 'gemini_placeholder', 'lmstudio_placeholder', 'ollama_placeholder'];
const ttsProviders: AppSettings['ttsProvider'][] = ['local', 'openai', 'elevenlabs'];
const themes: AppSettings['theme'][] = ['system', 'light', 'dark'];
const contrastModes: AppSettings['contrastMode'][] = ['normal', 'high'];
const colorVisionModes: AppSettings['colorVisionMode'][] = ['default', 'protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia'];
const textSizes: AppSettings['textSize'][] = ['small', 'normal', 'large', 'extra-large'];
const densities: AppSettings['density'][] = ['compact', 'normal', 'comfortable'];

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const optionalString = (value: unknown): string | undefined => (
  typeof value === 'string' && value.trim() ? value.trim() : undefined
);

const isSourceType = (value: unknown): value is SourceType => (
  typeof value === 'string' && sourceTypes.includes(value as SourceType)
);

const isSourceStatus = (value: unknown): value is SourceStatus => (
  typeof value === 'string' && sourceStatuses.includes(value as SourceStatus)
);

const isOneOf = <T extends string>(value: unknown, options: readonly T[]): value is T => (
  typeof value === 'string' && options.includes(value as T)
);

const validateProviderConfig = (value: unknown, fieldName: string): ValidationResult<void> => {
  if (value === undefined) return {ok: true, value: undefined};
  if (!isRecord(value)) return {ok: false, error: `${fieldName} must be an object`};

  for (const key of ['apiKey', 'model', 'baseUrl']) {
    if (value[key] !== undefined && typeof value[key] !== 'string') {
      return {ok: false, error: `${fieldName}.${key} must be a string`};
    }
  }

  return {ok: true, value: undefined};
};

export const parseCreateSourceInput = (body: unknown): ValidationResult<CreateSourceInput> => {
  if (!isRecord(body)) return {ok: false, error: 'source body must be an object'};
  if (!isSourceType(body.type)) return {ok: false, error: 'type must be a valid source type'};

  const name = optionalString(body.name);
  if (!name) return {ok: false, error: 'name is required'};

  const url = optionalString(body.url);
  const description = optionalString(body.description);

  if (body.type === 'rss' && !url) {
    return {ok: false, error: 'url is required for rss sources'};
  }

  if (body.type === 'manual_topic' && !description) {
    return {ok: false, error: 'description is required for manual topic sources'};
  }

  return {
    ok: true,
    value: {
      type: body.type,
      name,
      url,
      description,
      category: optionalString(body.category),
      isActive: typeof body.isActive === 'boolean' ? body.isActive : true,
      status: isSourceStatus(body.status) ? body.status : 'healthy',
    },
  };
};

export const parseUpdateSourceInput = (body: unknown): ValidationResult<UpdateSourceInput> => {
  if (!isRecord(body)) return {ok: false, error: 'source update body must be an object'};

  const input: UpdateSourceInput = {};

  if (body.type !== undefined) {
    if (!isSourceType(body.type)) return {ok: false, error: 'type must be a valid source type'};
    input.type = body.type;
  }

  if (body.name !== undefined) {
    const name = optionalString(body.name);
    if (!name) return {ok: false, error: 'name must be a non-empty string'};
    input.name = name;
  }

  if (body.url !== undefined) {
    if (body.url !== null && typeof body.url !== 'string') return {ok: false, error: 'url must be a string'};
    input.url = optionalString(body.url);
  }

  if (body.description !== undefined) {
    if (body.description !== null && typeof body.description !== 'string') return {ok: false, error: 'description must be a string'};
    input.description = optionalString(body.description);
  }

  if (body.category !== undefined) {
    if (body.category !== null && typeof body.category !== 'string') return {ok: false, error: 'category must be a string'};
    input.category = optionalString(body.category);
  }

  if (body.isActive !== undefined) {
    if (typeof body.isActive !== 'boolean') return {ok: false, error: 'isActive must be a boolean'};
    input.isActive = body.isActive;
  }

  if (body.status !== undefined) {
    if (!isSourceStatus(body.status)) return {ok: false, error: 'status must be a valid source status'};
    input.status = body.status;
  }

  if (Object.keys(input).length === 0) {
    return {ok: false, error: 'at least one source field is required'};
  }

  return {ok: true, value: input};
};

export const parseBriefingRunRequest = (body: unknown): ValidationResult<{sourceIds: string[]}> => {
  if (body === undefined || body === null) return {ok: true, value: {sourceIds: []}};
  if (!isRecord(body)) return {ok: false, error: 'briefing run body must be an object'};
  if (body.sourceIds === undefined) return {ok: true, value: {sourceIds: []}};
  if (!Array.isArray(body.sourceIds) || !body.sourceIds.every(id => typeof id === 'string' && id.trim())) {
    return {ok: false, error: 'sourceIds must be an array of source id strings'};
  }

  return {ok: true, value: {sourceIds: body.sourceIds.map(id => id.trim())}};
};

export const parseFollowUpRequest = (body: unknown): ValidationResult<{question: string; context?: string; runId?: string}> => {
  if (!isRecord(body)) return {ok: false, error: 'follow-up body must be an object'};

  const question = optionalString(body.question);
  if (!question) return {ok: false, error: 'question is required'};

  if (body.context !== undefined && typeof body.context !== 'string') {
    return {ok: false, error: 'context must be a string'};
  }

  if (body.runId !== undefined && typeof body.runId !== 'string') {
    return {ok: false, error: 'runId must be a string'};
  }

  return {
    ok: true,
    value: {
      question,
      context: optionalString(body.context),
      runId: optionalString(body.runId),
    },
  };
};

export const parseSettingsBody = (body: unknown): ValidationResult<AppSettings> => {
  if (!isRecord(body)) return {ok: false, error: 'settings body must be an object'};

  const configValidation = validateProviderConfig(body.aiConfig, 'aiConfig');
  if (configValidation.ok === false) return {ok: false, error: configValidation.error};

  const ttsConfigValidation = validateProviderConfig(body.ttsConfig, 'ttsConfig');
  if (ttsConfigValidation.ok === false) return {ok: false, error: ttsConfigValidation.error};

  const enumChecks: Array<[string, unknown, readonly string[]]> = [
    ['aiProvider', body.aiProvider, aiProviders],
    ['ttsProvider', body.ttsProvider, ttsProviders],
    ['theme', body.theme, themes],
    ['contrastMode', body.contrastMode, contrastModes],
    ['colorVisionMode', body.colorVisionMode, colorVisionModes],
    ['textSize', body.textSize, textSizes],
    ['density', body.density, densities],
  ];

  for (const [fieldName, value, options] of enumChecks) {
    if (value !== undefined && !isOneOf(value, options)) {
      return {ok: false, error: `${fieldName} has an invalid value`};
    }
  }

  if (body.scheduleTime !== undefined && typeof body.scheduleTime !== 'string') {
    return {ok: false, error: 'scheduleTime must be a string'};
  }

  if (body.isScheduleActive !== undefined && typeof body.isScheduleActive !== 'boolean') {
    return {ok: false, error: 'isScheduleActive must be a boolean'};
  }

  if (body.orbTheme !== undefined && typeof body.orbTheme !== 'string') {
    return {ok: false, error: 'orbTheme must be a string'};
  }

  return {ok: true, value: body as unknown as AppSettings};
};
