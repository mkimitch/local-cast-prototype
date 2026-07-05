import type {BriefingRun, BriefingSection, SourceItem} from '../../src/types';

export interface GenerateBriefingScriptInput {
  sourceItems: SourceItem[];
  sourceSummaries: string[];
  sourceIds: string[];
  requestedAt: string;
}

export interface FollowUpQuestionInput {
  question: string;
  context?: string;
  run?: BriefingRun;
}

export interface AiProvider {
  generateSourceSummary(items: SourceItem[]): Promise<string>;
  generateBriefingScript(input: GenerateBriefingScriptInput): Promise<BriefingSection[]>;
  answerFollowUpQuestion(input: FollowUpQuestionInput): Promise<string>;
}
