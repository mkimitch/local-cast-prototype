import {describe, expect, it, vi} from 'vitest';
import type {EpisodeEvidence, EpisodeRequestSnapshot} from '../../server/episodes/types';
import {buildEvidenceCatalog} from '../../server/episodes/evidenceCatalog';
import {GenerationError} from '../../server/jobs/types';
import {OpenAiCompatibleTextProvider} from '../../server/providers/openAiCompatible';

const request: EpisodeRequestSnapshot = {
	id: 'request-compatible',
	runId: 'run-compatible',
	stationId: 'station-compatible',
	stationRevision: 1,
	stationName: 'Synthetic station',
	topicInstruction: 'Use only supplied facts.',
	mode: 'brief',
	briefLengthPreset: 'standard',
	requestHash: 'a'.repeat(64),
	requestedAt: '2026-08-21T00:00:00.000Z',
};

const facts = Array.from({length: 620}, (_value, index) => `fact${String(index + 1).padStart(4, '0')}`);
const excerpt = facts.slice(0, 40).join(' ');
const evidence: EpisodeEvidence[] = [{
	id: 'snapshot-compatible',
	kind: 'note',
	title: 'Synthetic provider fixture',
	body: facts.join(' '),
	contentSha256: 'b'.repeat(64),
	networkScope: 'user_supplied',
}];

const draftSegments = Array.from({length: 16}, (_value, segmentIndex) => ({
			kind: 'factual' as const,
			text: facts.slice(segmentIndex * 40, segmentIndex * 40 + 40).join(' '),
			citations: ['E01'],
		}));
const draft = {
	sections: [
		{title: 'Synthetic section 1', type: 'news_summary' as const, segments: draftSegments.slice(0, 10)},
		{title: 'Synthetic section 2', type: 'deep_dive' as const, segments: draftSegments.slice(10)},
	],
};

const claimResults = (status: 'supported' | 'unsupported' = 'supported') => draft.sections.flatMap((section, sectionIndex) => section.segments.map((_segment, segmentIndex) => ({
	claimId: `claim-run-compatible-${sectionIndex}-${segmentIndex}`,
	status: sectionIndex === 0 && segmentIndex === 0 ? status : 'supported' as const,
})));

const response = (body: unknown): Response => new Response(JSON.stringify({
	choices: [{message: {content: JSON.stringify(body)}}],
}), {headers: {'content-type': 'application/json'}});

describe('OpenAI-compatible local text provider contract', () => {
	it.each(['supported', 'unsupported'] as const)('resolves compact references but still requires %s semantic classification', async status => {
		const catalog = buildEvidenceCatalog(evidence);
		try {
			const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
				if (fetchImpl.mock.calls.length === 1) return response(draft);
				const body = JSON.parse(String(init?.body));
				const claims = JSON.parse(body.messages[1].content).claims;
				expect(claims[0].citedEvidence).toEqual([{snapshotId: evidence[0]!.id, excerpt: catalog.entries[0]!.excerpt}]);
				return response({results: claimResults(status)});
			});
			const provider = new OpenAiCompatibleTextProvider('Ollama', 'http://ollama.test/v1', 'local-model', {fetchImpl});
			const result = provider.generateEpisode(request, evidence, new AbortController().signal);
			if (status === 'supported') expect((await result).sections[1]!.segments[0]!.citations).toEqual([{snapshotId: evidence[0]!.id, excerpt: catalog.entries[0]!.excerpt}]);
			else await expect(result).rejects.toMatchObject({code: 'UNSUPPORTED_GENERATED_CLAIM'});
			expect(fetchImpl).toHaveBeenCalledTimes(2);
		} finally { vi.restoreAllMocks(); }
	});

	it.each([
		['Ollama', 'http://ollama.test/v1', 'OLLAMA'],
		['LM Studio', 'http://lmstudio.test/v1', 'LM_STUDIO'],
	] as const)('uses a bounded local %s chat-completions transport without credentials', async (adapter, baseUrl, code) => {
		const calls: Array<{url: string; body: Record<string, unknown>; headers: Headers}> = [];
		const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
			calls.push({
				url: String(input),
				body: JSON.parse(String(init?.body)) as Record<string, unknown>,
				headers: new Headers(init?.headers),
			});
			return calls.length === 1
				? response(draft)
				: response({results: claimResults()});
		});
		const provider = new OpenAiCompatibleTextProvider(adapter, baseUrl, 'local-model', {fetchImpl});

		const result = await provider.generateEpisode(request, evidence, new AbortController().signal);

		expect(result.script.version).toBe(1);
		expect(calls).toHaveLength(2);
		for (const call of calls) {
			expect(call.url).toBe(`${baseUrl}/chat/completions`);
			expect(call.headers.get('authorization')).toBeNull();
			expect(call.body).toMatchObject({model: 'local-model', temperature: 0, response_format: {type: 'json_object'}});
			expect(JSON.stringify(call.body)).not.toContain('credential-canary');
			expect(call.body).not.toHaveProperty('tools');
		}
		const messages = calls[0]!.body.messages as Array<{role: string; content: string}>;
		const prompt = messages.find(message => message.role === 'system')!.content;
		expect(prompt).toContain('exact catalog: E01');
		expect(prompt).toContain('Never copy or invent snapshot IDs or excerpts');
		expect(prompt).toContain('navigation metadata only and are not citable evidence');
		expect(prompt).toContain('at most one token may be selected from any one source');
		expect(prompt).toContain('Reusing a catalog token in separate factual segments is permitted');
		const supplied = JSON.parse(messages.find(message => message.role === 'user')!.content);
		expect(JSON.stringify(supplied)).not.toContain(evidence[0]!.id);
		expect(code).toMatch(/OLLAMA|LM_STUDIO/);
	});

	it('aligns the Compact prompt with the published validator contract', async () => {
		const compactDraft = structuredClone(draft);
		compactDraft.sections = [{...compactDraft.sections[0]!, segments: draftSegments.slice(0, 5)}];
		compactDraft.sections[0]!.segments.at(-1)!.text = facts.slice(160, 193).join(' ');
		const calls: Record<string, unknown>[] = [];
		const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
			const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
			calls.push(body);
			return calls.length === 1 ? response(compactDraft) : response({results: claimResults().slice(0, 5)});
		});
		const provider = new OpenAiCompatibleTextProvider('Ollama', 'http://ollama.test/v1', 'local-model', {fetchImpl});
		await provider.generateEpisode({...request, briefLengthPreset: 'compact'}, evidence, new AbortController().signal);
		const prompt = ((calls[0]!.messages as Array<{content: string}>)[0]!).content;
		expect(prompt).toContain('Return 193 to 343 factual spoken words');
		expect(prompt).toContain('published total 200 to 350 words');
		expect(prompt).toContain('Aim for about 268 returned words');
	});

	it('rejects distinct catalog units from the same snapshot before support validation', async () => {
		const duplicateDraft = structuredClone(draft);
		duplicateDraft.sections[0]!.segments[0]!.citations.push('E02');
		const fetchImpl = vi.fn<typeof fetch>(async () => response(duplicateDraft));
		const provider = new OpenAiCompatibleTextProvider('Ollama', 'http://ollama.test/v1', 'local-model', {fetchImpl});

		await expect(provider.generateEpisode(request, evidence, new AbortController().signal)).rejects.toMatchObject({
			code: 'INVALID_CITATIONS',
			safeMessage: 'The generated transcript repeated a source citation within one factual segment',
		});
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('rejects oversized, malformed, rejected, timed-out, and cancelled responses with safe categorical errors', async () => {
		const oversized = new OpenAiCompatibleTextProvider('Ollama', 'http://ollama.test/v1', 'local-model', {
			fetchImpl: vi.fn<typeof fetch>(async () => new Response(new Uint8Array(128))),
			responseLimitBytes: 32,
		});
		await expect(oversized.generateEpisode(request, evidence, new AbortController().signal)).rejects.toMatchObject({code: 'OLLAMA_RESPONSE_TOO_LARGE'});

		const malformed = new OpenAiCompatibleTextProvider('LM Studio', 'http://lmstudio.test/v1', 'local-model', {
			fetchImpl: vi.fn<typeof fetch>(async () => new Response('{invalid')),
		});
		await expect(malformed.generateEpisode(request, evidence, new AbortController().signal)).rejects.toMatchObject({code: 'LM_STUDIO_INVALID_RESPONSE'});

		const rejected = new OpenAiCompatibleTextProvider('Ollama', 'http://ollama.test/v1', 'local-model', {
			fetchImpl: vi.fn<typeof fetch>(async () => new Response('endpoint-canary /private/path', {status: 503})),
		});
		let caught: unknown;
		try { await rejected.generateEpisode(request, evidence, new AbortController().signal); } catch (error) { caught = error; }
		expect(caught).toMatchObject({code: 'OLLAMA_REQUEST_REJECTED', retryable: true});
		expect(caught).toMatchObject({providerStatusImpact: 'failure'});
		expect(JSON.stringify(caught)).not.toMatch(/endpoint-canary|private\/path/);

		const hanging = new OpenAiCompatibleTextProvider('LM Studio', 'http://lmstudio.test/v1', 'local-model', {
			fetchImpl: vi.fn<typeof fetch>(async (_input, init) => new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {once: true});
			})),
			timeoutMs: 10,
		});
		await expect(hanging.generateEpisode(request, evidence, new AbortController().signal)).rejects.toMatchObject({code: 'LM_STUDIO_TIMEOUT'});

		const cancelled = new AbortController();
		cancelled.abort();
		await expect(hanging.generateEpisode(request, evidence, cancelled.signal)).rejects.toMatchObject({name: 'AbortError'});
	});

	it('fails closed when the compatibility provider returns unsupported claims', async () => {
		const provider = new OpenAiCompatibleTextProvider('Ollama', 'http://ollama.test/v1', 'local-model', {
			fetchImpl: vi.fn<typeof fetch>()
				.mockResolvedValueOnce(response(draft))
				.mockResolvedValueOnce(response({results: claimResults('unsupported')})),
		});
		const result = provider.generateEpisode(request, evidence, new AbortController().signal);
		await expect(result).rejects.toBeInstanceOf(GenerationError);
		await expect(result).rejects.toMatchObject({code: 'UNSUPPORTED_GENERATED_CLAIM'});
	});
});
