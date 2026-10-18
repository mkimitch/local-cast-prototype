import {afterEach, expect, it, vi} from 'vitest';
import {OpenAiTextProvider} from '../../server/providers/openai';
import {OpenAiCompatibleTextProvider} from '../../server/providers/openAiCompatible';
import {buildEvidenceCatalog} from '../../server/episodes/evidenceCatalog';
import {draftingGroundingInstructions} from '../../server/episodes/draftingContract';
import {contractEvidence, contractRequest, supportedContractDraft} from '../fixtures/generationContract';

afterEach(() => vi.restoreAllMocks());

it.each(['OpenAI', 'Ollama', 'LM Studio'] as const)('%s separates body evidence and accepts a fixture-supported paraphrase and reminder', async adapter => {
	const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No external requests permitted'));
	const sent: Array<{input?: Array<{content: string}>; messages?: Array<{content: string}>}> = [];
	const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
		const payload = JSON.parse(String(init?.body)); sent.push(payload);
		const value = sent.length === 1 ? supportedContractDraft : {results: supportedContractDraft.sections.map((_, index) => ({claimId: `claim-synthetic-run-${index}-0`, status: 'supported'}))};
		return new Response(JSON.stringify(adapter === 'OpenAI'
			? {status: 'completed', output: [{type: 'message', content: [{type: 'output_text', text: JSON.stringify(value)}]}]}
			: {choices: [{message: {content: JSON.stringify(value)}}]}));
	});
	const provider = adapter === 'OpenAI'
		? new OpenAiTextProvider('synthetic-key', 'synthetic-model', {fetchImpl})
		: new OpenAiCompatibleTextProvider(adapter, 'http://127.0.0.1:1', 'synthetic-model', {fetchImpl});
	const result = await provider.generateEpisode(contractRequest, contractEvidence, new AbortController().signal);
	const draftMessages = sent[0].input ?? sent[0].messages!;
	expect(draftMessages[0].content).toContain(draftingGroundingInstructions);
	expect(draftMessages[0].content).toContain('You write the spoken factual lead');
	expect(draftMessages[0].content).toContain('LocalCast supplies only the AI disclosure and neutral display headings');
	expect(draftMessages[0].content).toContain('Intro and outro segments require exactly the same citations');
	expect(draftMessages[0].content).toContain('review the note bodies as well as feed bodies');
	expect(draftMessages[0].content).not.toContain('LocalCast supplies those locally');
	const input = JSON.parse(draftMessages[1].content);
	expect(input.requestedAt).toBe(contractRequest.requestedAt);
	expect(input.evidenceCatalog).toHaveLength(3);
	for (const [i, source] of contractEvidence.entries()) {
		expect(draftMessages[1].content).not.toContain(source.title);
		expect(input.evidenceCatalog[i]).toEqual({navigation: {kind: source.kind, ...(source.publishedAt ? {publishedAt: source.publishedAt} : {})}, references: [{reference: `E0${i + 1}`, excerpt: source.body}]});
	}
	expect(draftMessages[1].content).not.toMatch(/900,000|Software glitch|Deliveries resume|Metadata author|headline-only-event/);
	// Full provenance still exists locally; the support request contains excerpts only.
	expect(buildEvidenceCatalog(contractEvidence).sources[1].title).toBe(contractEvidence[1].title);
	const supportMessages = sent[1].input ?? sent[1].messages!;
	const claims = JSON.parse(supportMessages[1].content).claims;
	expect(claims).toHaveLength(3);
	expect(claims[2].citedEvidence).toEqual([{snapshotId: 'note-reminder', excerpt: contractEvidence[0].body}]);
	expect(supportMessages[1].content).not.toMatch(/publishedAt|originalUrl|Model heading/);
	expect(result.narration).toContain('November 4, 2026 at 3:00 PM Central Time');
	expect(result.sections.flatMap(s => s.segments).filter(s => s.kind === 'factual')).toHaveLength(3);
	expect(result.narration).not.toContain('Model heading');
	expect(network).not.toHaveBeenCalled(); expect(fetchImpl).toHaveBeenCalledTimes(2);
});

// Verdicts are explicit fixtures, not an offline semantic classifier. These cases
// prove forwarding and fail-closed handling, not what a future model will decide.
it.each([
	['intro', 'These are the biggest developments today.', 'uncertain', 2],
	['news_summary', 'Deliveries have resumed at the port.', 'unsupported', 1],
	['news_summary', 'A software glitch delayed 900,000 registrations before voting.', 'unsupported', 2],
	['outro', 'The delays will remain in focus tomorrow.', 'uncertain', 2],
] as const)('keeps %s claims subject to rejection: %s', async (type, text, status, evidenceIndex) => {
	const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No external requests permitted'));
	const draft = structuredClone(supportedContractDraft);
	draft.sections.push({title: 'Cannot bypass support', type, segments: [{kind: 'factual', text, citations: [`E0${evidenceIndex + 1}`]}]});
	const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
		const response = (value: unknown) => new Response(JSON.stringify({status: 'completed', output: [{type: 'message', content: [{type: 'output_text', text: JSON.stringify(value)}]}]}));
		if (fetchImpl.mock.calls.length === 1) return response(draft);
		const claims = JSON.parse(JSON.parse(String(init?.body)).input[1].content).claims;
		expect(claims.at(-1).claim).toBe(text);
		expect(claims.at(-1).citedEvidence).toEqual([{snapshotId: contractEvidence[evidenceIndex].id, excerpt: contractEvidence[evidenceIndex].body}]);
		return response({results: claims.map((c: {claimId: string}, i: number) => ({claimId: c.claimId, status: i === 3 ? status : 'supported'}))});
	});
	await expect(new OpenAiTextProvider('synthetic-key', 'synthetic-model', {fetchImpl}).generateEpisode(contractRequest, contractEvidence, new AbortController().signal)).rejects.toMatchObject({code: 'UNSUPPORTED_GENERATED_CLAIM'});
	expect(network).not.toHaveBeenCalled(); expect(fetchImpl).toHaveBeenCalledTimes(2);
});
