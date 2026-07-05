import dotenv from 'dotenv';

dotenv.config();

export type BackendAiProvider = 'mock' | 'gemini' | 'openai_compatible';

const providerFromEnv = (value?: string): BackendAiProvider => {
  const normalized = value?.trim().toLowerCase();

  if (normalized === 'gemini' || normalized === 'openai_compatible') {
    return normalized;
  }

  return 'mock';
};

const portFromEnv = (value?: string): number => {
  const port = Number(value || 8787);
  return Number.isFinite(port) && port > 0 ? port : 8787;
};

const corsOriginsFromEnv = (value?: string): string[] => {
  const origins = (value || 'http://localhost:3000')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

  return origins.length > 0 ? origins : ['http://localhost:3000'];
};

export const serverConfig = {
	port: portFromEnv(process.env.PORT),
	corsOrigins: corsOriginsFromEnv(process.env.CORS_ORIGIN),
	databasePath: process.env.DATABASE_PATH || 'data/localcast.sqlite',
	aiProvider: providerFromEnv(process.env.AI_PROVIDER),
	aiModel: process.env.AI_MODEL || 'mock-localcast',
	aiBaseUrl: process.env.AI_BASE_URL || '',
  aiApiKey: process.env.AI_API_KEY || '',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
};
