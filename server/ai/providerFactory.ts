import {serverConfig} from '../config';
import {GeminiProvider} from './geminiProvider';
import {MockAiProvider} from './mockProvider';
import {OpenAiCompatibleProvider} from './openAiCompatibleProvider';
import type {AiProvider} from './types';

export const createAiProvider = (): AiProvider => {
  if (serverConfig.aiProvider === 'gemini') {
    const model = serverConfig.aiModel === 'mock-localcast' ? 'gemini-2.5-flash' : serverConfig.aiModel;
    return new GeminiProvider(serverConfig.geminiApiKey, model);
  }

  if (serverConfig.aiProvider === 'openai_compatible') {
    return new OpenAiCompatibleProvider(serverConfig.aiBaseUrl, serverConfig.aiModel, serverConfig.aiApiKey);
  }

  return new MockAiProvider();
};
