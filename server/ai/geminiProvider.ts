import {GoogleGenAI} from '@google/genai';
import type {BriefingSection, SourceItem} from '../../src/types';
import {parseSectionsFromText, sourceItemsForPrompt} from './providerUtils';
import type {AiProvider, FollowUpQuestionInput, GenerateBriefingScriptInput} from './types';

export class GeminiProvider implements AiProvider {
  constructor(private readonly apiKey: string, private readonly model: string) {}

  private getClient(): GoogleGenAI {
    if (!this.apiKey) {
      throw new Error('Gemini provider requires GEMINI_API_KEY. Set GEMINI_API_KEY or use AI_PROVIDER=mock.');
    }

    return new GoogleGenAI({apiKey: this.apiKey});
  }

  private async generateText(prompt: string): Promise<string> {
    const response = await this.getClient().models.generateContent({
      model: this.model || 'gemini-2.5-flash',
      contents: prompt,
    });

    if (!response.text) {
      throw new Error('Gemini provider returned an empty response.');
    }

    return response.text;
  }

  async generateSourceSummary(items: SourceItem[]): Promise<string> {
    return this.generateText([
      'Summarize these LocalCast source items in 2 concise sentences.',
      'Keep the tone suitable for a personal audio briefing.',
      '',
      sourceItemsForPrompt(items),
    ].join('\n'));
  }

  async generateBriefingScript(input: GenerateBriefingScriptInput): Promise<BriefingSection[]> {
    const summary = input.sourceSummaries[0] || '';
    const text = await this.generateText([
      'Create a LocalCast briefing transcript as JSON only.',
      'Return an array of sections using this shape:',
      '[{"id":"sec-id","title":"Title","type":"intro|news_summary|deep_dive|outro","spokenText":"...","sourceItemIds":["item-id"],"importanceScore":1,"followUpPrompts":["question"]}]',
      'Use only these section type values: intro, news_summary, deep_dive, outro.',
      'Include useful follow-up prompts on substantive sections.',
      '',
      `Summary: ${summary}`,
      '',
      sourceItemsForPrompt(input.sourceItems),
    ].join('\n'));

    return parseSectionsFromText(text, input.sourceItems, summary);
  }

  async answerFollowUpQuestion(input: FollowUpQuestionInput): Promise<string> {
    return this.generateText([
      'Answer this LocalCast follow-up question clearly and briefly.',
      input.run ? `Briefing title: ${input.run.title}` : undefined,
      input.context ? `Context: ${input.context}` : undefined,
      `Question: ${input.question}`,
    ].filter(Boolean).join('\n'));
  }
}
