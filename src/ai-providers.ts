import { BriefingSection, SourceItem } from './types';

export interface AiProvider {
  generateSourceSummary(items: SourceItem[]): Promise<string>;
  generateBriefingScript(summaries: string[]): Promise<BriefingSection[]>;
  answerFollowUpQuestion(context: string, question: string): Promise<string>;
}

export class MockAiProvider implements AiProvider {
  async generateSourceSummary(items: SourceItem[]): Promise<string> {
    return "Mock summary of the provided sources. This highlights the key themes in a concise manner.";
  }

  async generateBriefingScript(summaries: string[]): Promise<BriefingSection[]> {
    return [
      {
        id: `sec-intro-${Date.now()}`,
        title: 'Introduction',
        type: 'intro',
        spokenText: 'Welcome to your mock briefing. We have gathered insights from your selected sources.',
        sourceItemIds: [],
        importanceScore: 5,
        followUpPrompts: []
      },
      {
        id: `sec-main-${Date.now()}`,
        title: 'Main Topic',
        type: 'deep_dive',
        spokenText: 'This is a mock deep dive into the provided topics. The sources suggest a strong trend toward localized models and AI agents.',
        sourceItemIds: [],
        importanceScore: 8,
        followUpPrompts: [
          "Can you explain more about localized models?",
          "What are the implications for privacy?"
        ]
      }
    ];
  }

  async answerFollowUpQuestion(context: string, question: string): Promise<string> {
    return `Mock answer to your question: "${question}". Based on the context, this is a simulated response.`;
  }
}

export class OpenAiPlaceholderProvider extends MockAiProvider {}
export class GeminiPlaceholderProvider extends MockAiProvider {}
export class LmStudioPlaceholderProvider extends MockAiProvider {}
export class OllamaPlaceholderProvider extends MockAiProvider {}

export function getAiProvider(providerId: string): AiProvider {
  switch (providerId) {
    case 'openai_placeholder': return new OpenAiPlaceholderProvider();
    case 'gemini_placeholder': return new GeminiPlaceholderProvider();
    case 'lmstudio_placeholder': return new LmStudioPlaceholderProvider();
    case 'ollama_placeholder': return new OllamaPlaceholderProvider();
    case 'mock':
    default:
      return new MockAiProvider();
  }
}
