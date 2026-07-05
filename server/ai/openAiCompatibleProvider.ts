import type {BriefingSection, SourceItem} from '../../src/types';
import {parseSectionsFromText, sourceItemsForPrompt} from './providerUtils';
import type {AiProvider, FollowUpQuestionInput, GenerateBriefingScriptInput} from './types';

interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

interface ChatCompletionResponse {
  choices?: Array<{message?: {content?: string}}>;
  error?: {message?: string};
}

export class OpenAiCompatibleProvider implements AiProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly apiKey?: string,
  ) {}

  private getChatCompletionsUrl(): string {
    const baseUrl = this.baseUrl.replace(/\/+$/, '');
    return `${baseUrl.endsWith('/v1') ? baseUrl : `${baseUrl}/v1`}/chat/completions`;
  }

  private async chat(messages: ChatMessage[]): Promise<string> {
    if (!this.baseUrl) {
      throw new Error('OpenAI-compatible provider requires AI_BASE_URL. Set AI_BASE_URL or use AI_PROVIDER=mock.');
    }

    const headers: Record<string, string> = {'Content-Type': 'application/json'};
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    const response = await fetch(this.getChatCompletionsUrl(), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: this.model || 'localcast-local-model',
        messages,
        temperature: 0.3,
      }),
    });

    const payload = await response.json().catch(() => undefined) as ChatCompletionResponse | undefined;
    if (!response.ok) {
      throw new Error(`OpenAI-compatible provider request failed (${response.status}): ${payload?.error?.message || response.statusText}`);
    }

    const content = payload?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('OpenAI-compatible provider returned an empty response.');
    }

    return content;
  }

  async generateSourceSummary(items: SourceItem[]): Promise<string> {
    return this.chat([
      {role: 'system', content: 'You write concise personal audio briefing summaries.'},
      {role: 'user', content: `Summarize these source items in 2 concise sentences.\n\n${sourceItemsForPrompt(items)}`},
    ]);
  }

  async generateBriefingScript(input: GenerateBriefingScriptInput): Promise<BriefingSection[]> {
    const summary = input.sourceSummaries[0] || '';
    const text = await this.chat([
      {role: 'system', content: 'You generate LocalCast briefing transcript sections as strict JSON.'},
      {
        role: 'user',
        content: [
          'Return JSON only: an array of sections with id, title, type, spokenText, sourceItemIds, importanceScore, followUpPrompts.',
          'Use only these type values: intro, news_summary, deep_dive, outro.',
          'Include follow-up prompts on substantive sections.',
          `Summary: ${summary}`,
          '',
          sourceItemsForPrompt(input.sourceItems),
        ].join('\n'),
      },
    ]);

    return parseSectionsFromText(text, input.sourceItems, summary);
  }

  async answerFollowUpQuestion(input: FollowUpQuestionInput): Promise<string> {
    return this.chat([
      {role: 'system', content: 'Answer LocalCast briefing follow-up questions briefly and accurately.'},
      {
        role: 'user',
        content: [
          input.run ? `Briefing title: ${input.run.title}` : undefined,
          input.context ? `Context: ${input.context}` : undefined,
          `Question: ${input.question}`,
        ].filter(Boolean).join('\n'),
      },
    ]);
  }
}
