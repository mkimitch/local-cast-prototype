import {z} from 'zod';

const productionBaseUrl = 'https://api.openai.com/v1';
const responseLimitBytes = 64 * 1024;
const defaultTimeoutMs = 10_000;

const modelSchema = z.object({
	id: z.string().min(1).max(240),
	object: z.literal('model'),
}).passthrough();

export type OpenAiVerificationErrorCode =
	| 'OPENAI_CREDENTIAL_INVALID'
	| 'OPENAI_ACCOUNT_OR_PERMISSION_PROBLEM'
	| 'OPENAI_RATE_LIMIT_OR_QUOTA'
	| 'OPENAI_PROVIDER_UNAVAILABLE'
	| 'OPENAI_MODEL_UNAVAILABLE'
	| 'OPENAI_UNEXPECTED_RESPONSE';

export class OpenAiVerificationError extends Error {
	constructor(
		readonly code: OpenAiVerificationErrorCode,
		message: string,
		readonly httpStatus: 400 | 429 | 502 | 503,
	) {
		super(message);
		this.name = 'OpenAiVerificationError';
	}
}

export interface OpenAiVerificationOptions {
	fetchImpl?: typeof fetch;
	baseUrl?: string;
	allowTestBaseUrl?: boolean;
	timeoutMs?: number;
}

const failureForStatus = (status: number): OpenAiVerificationError => {
	if (status === 401) return new OpenAiVerificationError('OPENAI_CREDENTIAL_INVALID', 'OpenAI rejected the API key as invalid or revoked.', 400);
	if (status === 403) return new OpenAiVerificationError('OPENAI_ACCOUNT_OR_PERMISSION_PROBLEM', 'OpenAI rejected the request because of an account or permission problem.', 400);
	if (status === 404) return new OpenAiVerificationError('OPENAI_MODEL_UNAVAILABLE', 'The configured OpenAI model is not available to this project.', 400);
	if (status === 429) return new OpenAiVerificationError('OPENAI_RATE_LIMIT_OR_QUOTA', 'OpenAI reported a rate-limit, quota, or account-capacity problem.', 429);
	if (status >= 500) return new OpenAiVerificationError('OPENAI_PROVIDER_UNAVAILABLE', 'OpenAI is temporarily unavailable.', 503);
	return new OpenAiVerificationError('OPENAI_UNEXPECTED_RESPONSE', 'OpenAI returned an unexpected response.', 502);
};

const readBoundedJson = async (response: Response): Promise<unknown> => {
	if (!response.body) throw new OpenAiVerificationError('OPENAI_UNEXPECTED_RESPONSE', 'OpenAI returned an unexpected response.', 502);
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let bytes = 0;
	for (;;) {
		const next = await reader.read();
		if (next.done) break;
		bytes += next.value.byteLength;
		if (bytes > responseLimitBytes) {
			await reader.cancel();
			throw new OpenAiVerificationError('OPENAI_UNEXPECTED_RESPONSE', 'OpenAI returned an unexpected response.', 502);
		}
		chunks.push(next.value);
	}
	const combined = new Uint8Array(bytes);
	let offset = 0;
	for (const chunk of chunks) {
		combined.set(chunk, offset);
		offset += chunk.byteLength;
	}
	try {
		return JSON.parse(new TextDecoder().decode(combined)) as unknown;
	} catch {
		throw new OpenAiVerificationError('OPENAI_UNEXPECTED_RESPONSE', 'OpenAI returned an unexpected response.', 502);
	}
};

export const verifyOpenAiModelAccess = async (
	apiKey: string,
	model: string,
	options: OpenAiVerificationOptions = {},
): Promise<void> => {
	const baseUrl = options.baseUrl || productionBaseUrl;
	if (baseUrl !== productionBaseUrl && !options.allowTestBaseUrl) throw new Error('Non-production OpenAI base URLs are test-only');
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? defaultTimeoutMs);
	timeout.unref();
	try {
		const response = await (options.fetchImpl || fetch)(`${baseUrl}/models/${encodeURIComponent(model)}`, {
			method: 'GET',
			headers: {authorization: `Bearer ${apiKey}`},
			redirect: 'error',
			signal: controller.signal,
		});
		if (!response.ok) {
			void response.body?.cancel();
			throw failureForStatus(response.status);
		}
		const parsed = modelSchema.safeParse(await readBoundedJson(response));
		if (!parsed.success || parsed.data.id !== model) {
			throw new OpenAiVerificationError('OPENAI_UNEXPECTED_RESPONSE', 'OpenAI returned an unexpected response.', 502);
		}
	} catch (error) {
		if (error instanceof OpenAiVerificationError) throw error;
		throw new OpenAiVerificationError('OPENAI_PROVIDER_UNAVAILABLE', 'OpenAI could not be reached.', 503);
	} finally {
		clearTimeout(timeout);
	}
};
