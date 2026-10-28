import {GenerationError} from '../jobs/types';
const providerFailure = (code: string, safeMessage: string, retryable: boolean): GenerationError => new GenerationError(code, safeMessage, retryable, 'failure');

export type OpenAiResponsePayload = {
	id?: unknown;
	status?: string;
	incomplete_details?: unknown;
	output?: Array<{
		type?: string;
		content?: Array<{type?: string; text?: string}>;
	}>;
	usage?: {
		input_tokens?: unknown;
		output_tokens?: unknown;
		total_tokens?: unknown;
		input_tokens_details?: {cached_tokens?: unknown};
		output_tokens_details?: {reasoning_tokens?: unknown};
	};
};

export type ChatCompletionsPayload = {
	choices?: Array<{message?: {content?: unknown}}>;
};

export const extractOutputText = (payload: OpenAiResponsePayload): string => {
	if (payload.status !== 'completed') throw providerFailure('OPENAI_INCOMPLETE_RESPONSE', 'The configured OpenAI text provider did not complete its response', true);
	const texts = payload.output?.flatMap(item => item.type === 'message'
		? item.content?.filter(content => content.type === 'output_text' && typeof content.text === 'string').map(content => content.text!) || []
		: []) || [];
	if (texts.length !== 1 || !texts[0]?.trim()) throw providerFailure('OPENAI_INVALID_RESPONSE', 'The configured OpenAI text provider returned invalid structured output', false);
	return texts[0];
};

export const compatibleOutputText = (payload: ChatCompletionsPayload, code: string): string => {
	const content = payload.choices?.[0]?.message?.content;
	if (typeof content !== 'string' || !content.trim()) {
		throw providerFailure(`${code}_INVALID_RESPONSE`, 'The configured local text provider returned invalid structured output', false);
	}
	return content;
};
