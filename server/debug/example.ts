import {createHash} from 'node:crypto';
import {armTrace, captureTrace, withGenerationTrace} from './generationTrace';
import {buildEvidenceCatalog, resolveEvidenceReferences} from '../episodes/evidenceCatalog';
import {episodeDraftSchema, sectionsForResolvedDraft} from '../episodes/draft';
import {assertTracedEpisode} from './validationTrace';
import {GenerationError} from '../jobs/types';
import type {EpisodeEvidence, EpisodeRequestSnapshot} from '../episodes/types';

// Explicit synthetic fixture, not a provider response or semantic classifier.
export const createTraceExample = async (root: string): Promise<void> => {
	const body = 'A person explicitly requests each LocalCast episode. The worker processes one generation job at a time. The database retains immutable supplied evidence. Each factual statement must have a verbatim supporting excerpt. The application does not search for new material or invent missing facts.';
	const request: EpisodeRequestSnapshot = {id: 'synthetic-request', runId: 'synthetic-run', stationId: 'synthetic-station', stationRevision: 1, stationName: 'Synthetic example', topicInstruction: 'Summarize the supplied facts.', mode: 'brief', briefLengthPreset: 'standard', requestHash: 'synthetic-fixture', requestedAt: new Date().toISOString()};
	const evidence: EpisodeEvidence[] = [{id: 'synthetic-snapshot', kind: 'note', title: 'Synthetic operational facts', body, contentSha256: createHash('sha256').update(body).digest('hex'), networkScope: 'user_supplied'}];
	armTrace(root, request.stationId);
	try {
		await withGenerationTrace(root, request.stationId, {jobId: 'synthetic-job', attemptNumber: 1, fixture: true}, [], async () => {
			captureTrace('request', 'synthetic fixture', 'raw', request);
			captureTrace('evidence', 'synthetic fixture', 'raw', evidence);
			captureTrace('provider', 'synthetic fixture; no provider invoked', 'derived', {adapter: 'OpenAI', model: 'synthetic-model'});
			const catalog = buildEvidenceCatalog(evidence);
			captureTrace('catalog', 'buildEvidenceCatalog', 'derived', catalog);
			captureTrace('stage', 'synthetic fixture', 'derived', 'drafting');
			captureTrace('draft.request', 'synthetic request fixture, never transmitted', 'raw', JSON.stringify({model: 'synthetic-model', input: [{role: 'developer', content: 'Summarize only supplied evidence.'}, {role: 'user', content: JSON.stringify(catalog.sources)}]}));
			const draft = {sections: [{title: 'Fixture', type: 'news_summary', segments: [{kind: 'factual', text: body, citations: ['E01']}]}]};
			const envelope = (value: unknown) => JSON.stringify({status: 'completed', output: [{type: 'message', content: [{type: 'output_text', text: JSON.stringify(value)}]}]});
			captureTrace('draft.response', 'synthetic response fixture, not a live response', 'raw', envelope(draft));
			captureTrace('draft.text', 'synthetic output text', 'transformed', JSON.stringify(draft));
			const parsed = episodeDraftSchema.parse(draft);
			captureTrace('draft.parsed', 'episodeDraftSchema', 'parsed', parsed);
			const resolved = resolveEvidenceReferences(parsed, catalog);
			captureTrace('citations.resolved', 'resolveEvidenceReferences', 'transformed', resolved);
			const sections = sectionsForResolvedDraft(request, resolved);
			captureTrace('sections', 'sectionsForResolvedDraft; supportStatus is provisional', 'transformed', sections);
			assertTracedEpisode(request, evidence, sections);
			captureTrace('stage', 'synthetic fixture', 'derived', 'validating');
			captureTrace('support.request', 'synthetic request fixture, never transmitted', 'raw', JSON.stringify({claims: sections.slice(1).flatMap(section => section.segments).map(claim => ({claimId: claim.id, claim: claim.text, citedEvidence: claim.citations}))}));
			const verdict = {results: [{claimId: 'claim-synthetic-run-0-0', status: 'uncertain'}]};
			captureTrace('support.response', 'explicit synthetic classifier fixture, not a semantic decision', 'raw', envelope(verdict));
			captureTrace('support.parsed', 'explicit synthetic classifier fixture', 'parsed', verdict);
			captureTrace('support.decisions', 'fixture association', 'derived', [{index: 0, ...verdict.results[0]}]);
			throw new GenerationError('UNSUPPORTED_GENERATED_CLAIM', 'Synthetic rejection fixture', false, 'preserve', {stage: 'semantic_support', category: 'unsupported_claims', rejectedCount: 1});
		});
	} catch (error) {
		if (!(error instanceof GenerationError) || error.code !== 'UNSUPPORTED_GENERATED_CLAIM') throw error;
	}
};
