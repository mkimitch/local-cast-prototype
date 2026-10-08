import {describe, expect, it} from 'vitest';
import type {EpisodeEvidence, EpisodeRequestSnapshot, GeneratedSection} from '../../server/episodes/types';
import {assertGeneratedEpisode} from '../../server/episodes/validation';
import type {GenerationJob} from '../../server/jobs/types';
import {fakeGeneratedSections} from '../../server/testing/fakeGenerationProcessor';

const evidence: EpisodeEvidence[] = [0, 1].map(sourceIndex => ({
	id: `snapshot-grounding-note-${sourceIndex}`,
	kind: 'note',
	title: `Grounding source ${sourceIndex + 1}`,
	body: Array.from({length: 400}, (_value, wordIndex) => `source${sourceIndex}fact${String(wordIndex + 1).padStart(3, '0')}`).join(' '),
	contentSha256: String(sourceIndex + 1).repeat(64),
	networkScope: 'user_supplied',
}));

const request: EpisodeRequestSnapshot = {
	id: 'request-grounding',
	runId: 'run-grounding',
	stationId: 'station-grounding',
	stationRevision: 1,
	stationName: 'Grounding station',
	topicInstruction: 'Treat this direction as emphasis, not evidence.',
	mode: 'brief',
	requestHash: 'a'.repeat(64),
	requestedAt: '2026-08-06T12:00:00.000Z',
};

const job: GenerationJob = {
	id: 'job-grounding',
	runId: request.runId,
	payload: {version: 2, requestId: request.id, requestedAt: request.requestedAt},
	state: 'running',
	phase: 'validating',
	attemptCount: 1,
	retryable: false,
	createdAt: request.requestedAt,
	updatedAt: request.requestedAt,
};

const validSections = (): GeneratedSection[] => fakeGeneratedSections(job, evidence, 'brief');
const clone = (sections: GeneratedSection[]): GeneratedSection[] => structuredClone(sections);
const firstFact = (sections: GeneratedSection[]) => sections.flatMap(section => section.segments).find(segment => segment.kind === 'factual')!;

describe('provider-independent episode grounding validator', () => {
	it('accepts exact current-snapshot citations including valid multi-source support', () => {
		const sections = validSections();
		const segment = firstFact(sections);
		const excerpt = evidence[1]!.body.slice(0, 80).trim();
		segment.citations.push({snapshotId: evidence[1]!.id, excerpt});
		expect(assertGeneratedEpisode(request, evidence, sections)).toMatchObject({version: 1});
	});

	it('permits the same snapshot in separate factual segments', () => {
		const sections = validSections();
		const facts = sections.flatMap(section => section.segments).filter(segment => segment.kind === 'factual');
		expect(facts.length).toBeGreaterThan(1);
		facts[1]!.citations = [{...facts[0]!.citations[0]!}];
		expect(assertGeneratedEpisode(request, evidence, sections)).toMatchObject({version: 1});
	});

	it.each([
		['original note ID', (sections: GeneratedSection[]) => { firstFact(sections).citations[0]!.snapshotId = 'note-original-id'; }],
		['station ID', (sections: GeneratedSection[]) => { firstFact(sections).citations[0]!.snapshotId = request.stationId; }],
		['absent excerpt', (sections: GeneratedSection[]) => { firstFact(sections).citations[0]!.excerpt = 'absent evidence excerpt'; }],
		['wrong-snapshot excerpt', (sections: GeneratedSection[]) => { firstFact(sections).citations[0]!.snapshotId = evidence[1]!.id; }],
		['empty citations', (sections: GeneratedSection[]) => { firstFact(sections).citations = []; }],
		['repeated-only citations', (sections: GeneratedSection[]) => { const citation = firstFact(sections).citations[0]!; firstFact(sections).citations.push({...citation}); }],
		['repeated citations mixed with a distinct source', (sections: GeneratedSection[]) => {
			const citation = firstFact(sections).citations[0]!;
			firstFact(sections).citations.push(
				{...citation},
				{snapshotId: evidence[1]!.id, excerpt: evidence[1]!.body.slice(0, 80).trim()},
			);
		}],
		['same snapshot with different excerpts', (sections: GeneratedSection[]) => {
			const citation = firstFact(sections).citations[0]!;
			firstFact(sections).citations.push({snapshotId: citation.snapshotId, excerpt: evidence[0]!.body.slice(81, 161).trim()});
		}],
	] as const)('rejects %s', (_name, mutate) => {
		const sections = clone(validSections());
		mutate(sections);
		expect(() => assertGeneratedEpisode(request, evidence, sections)).toThrow(expect.objectContaining({code: 'INVALID_CITATIONS'}));
	});

	it('reports repeated per-segment citations with accurate safe wording', () => {
		const sections = clone(validSections());
		const citation = firstFact(sections).citations[0]!;
		firstFact(sections).citations.push({...citation});
		expect(() => assertGeneratedEpisode(request, evidence, sections)).toThrow(expect.objectContaining({
			code: 'INVALID_CITATIONS',
			safeMessage: 'The generated transcript repeated a source citation within one factual segment',
		}));
	});

	it('rejects unsupported facts, cited transitions, and non-host roles at publication', () => {
		const unsupported = clone(validSections());
		firstFact(unsupported).supportStatus = 'not_required';
		expect(() => assertGeneratedEpisode(request, evidence, unsupported)).toThrow(expect.objectContaining({code: 'INVALID_CITATIONS'}));

		const transition = clone(validSections());
		transition[0]!.segments[0]!.citations.push({snapshotId: evidence[0]!.id, excerpt: evidence[0]!.body.slice(0, 80).trim()});
		expect(() => assertGeneratedEpisode(request, evidence, transition)).toThrow(expect.objectContaining({code: 'INVALID_CITATIONS'}));

		const speaker = clone(validSections());
		(firstFact(speaker) as unknown as {speakerRole: string}).speakerRole = 'model-selected-speaker';
		expect(() => assertGeneratedEpisode(request, evidence, speaker)).toThrow(expect.objectContaining({code: 'INVALID_EPISODE_STRUCTURE'}));
	});

	it('rejects an under-length output instead of padding it', () => {
		const sections = clone(validSections()).slice(0, 2);
		sections[1]!.segments = sections[1]!.segments.slice(0, 1);
		expect(() => assertGeneratedEpisode(request, evidence, sections)).toThrow(expect.objectContaining({code: 'EPISODE_LENGTH_OUT_OF_RANGE'}));
	});
});
