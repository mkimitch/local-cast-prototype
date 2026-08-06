import {describe, expect, it} from 'vitest';
import type {EpisodeEvidence, EpisodeRequestSnapshot} from '../../server/episodes/types';
import {assertEvidenceSufficient, countWords, policyForEvidence} from '../../server/episodes/modePolicy';
import {assertGeneratedEpisode, narrationForScript} from '../../server/episodes/validation';
import type {GenerationJob} from '../../server/jobs/types';
import {fakeGeneratedSections} from '../../server/testing/fakeGenerationProcessor';

const evidenceWithWords = (wordCount: number): EpisodeEvidence[] => [{
	id: 'snapshot-mode-note-0',
	kind: 'note',
	title: 'Grounded mode fixture',
	body: Array.from({length: wordCount}, (_value, index) => `fact${String(index + 1).padStart(4, '0')}`).join(' '),
	contentSha256: 'a'.repeat(64),
	networkScope: 'user_supplied',
}];

const requestFor = (mode: 'brief' | 'deep'): EpisodeRequestSnapshot => ({
	id: `request-${mode}`,
	runId: `run-${mode}`,
	stationId: 'station-mode',
	stationRevision: 1,
	stationName: 'Mode station',
	topicInstruction: 'Explain only the supplied material.',
	mode,
	requestHash: 'b'.repeat(64),
	requestedAt: '2026-08-06T12:00:00.000Z',
});

const jobFor = (mode: 'brief' | 'deep'): GenerationJob => ({
	id: `job-${mode}`,
	runId: `run-${mode}`,
	payload: {version: 2, requestId: `request-${mode}`, requestedAt: '2026-08-06T12:00:00.000Z'},
	state: 'running',
	phase: 'validating',
	attemptCount: 1,
	retryable: false,
	createdAt: '2026-08-06T12:00:00.000Z',
	updatedAt: '2026-08-06T12:00:00.000Z',
});

describe('source-grounded episode mode policy', () => {
	it('keeps brief and deep output inside their contracts for identical adequate evidence', () => {
		const evidence = evidenceWithWords(2_300);
		const brief = assertGeneratedEpisode(requestFor('brief'), evidence, fakeGeneratedSections(jobFor('brief'), evidence, 'brief'));
		const deep = assertGeneratedEpisode(requestFor('deep'), evidence, fakeGeneratedSections(jobFor('deep'), evidence, 'deep'));
		const briefWords = countWords(narrationForScript(brief));
		const deepWords = countWords(narrationForScript(deep));

		expect(briefWords).toBeGreaterThanOrEqual(600);
		expect(briefWords).toBeLessThanOrEqual(1_000);
		expect(deepWords).toBeGreaterThanOrEqual(1_800);
		expect(deepWords).toBeLessThanOrEqual(3_000);
		expect(deepWords).toBeGreaterThan(briefWords);
		expect(deep.sections.flatMap(section => section.segments).every(segment => segment.speakerRole === 'host')).toBe(true);
	});

	it('allows a shorter supported brief but rejects the same sparse evidence for deep mode', () => {
		const evidence = evidenceWithWords(120);
		const brief = assertGeneratedEpisode(requestFor('brief'), evidence, fakeGeneratedSections(jobFor('brief'), evidence, 'brief'));
		expect(countWords(narrationForScript(brief))).toBeLessThan(600);
		expect(() => assertEvidenceSufficient('deep', evidence)).toThrow(expect.objectContaining({code: 'INSUFFICIENT_SOURCE_MATERIAL', retryable: false}));
	});

	it('does not count duplicate source bodies twice toward deep-mode sufficiency', () => {
		const original = evidenceWithWords(900)[0]!;
		const duplicate = {...original, id: 'snapshot-duplicate'};
		expect(() => assertEvidenceSufficient('deep', [original, duplicate])).toThrow(expect.objectContaining({code: 'INSUFFICIENT_SOURCE_MATERIAL'}));
	});

	it.each([0, 10, 39])('rejects %s supplied words before any generation boundary', wordCount => {
		expect(() => assertEvidenceSufficient('brief', evidenceWithWords(wordCount))).toThrow(expect.objectContaining({code: 'INSUFFICIENT_SOURCE_MATERIAL'}));
	});

	it('publishes fixed, observable policy boundaries', () => {
		expect(policyForEvidence('brief', evidenceWithWords(2_300))).toMatchObject({minimumOutputWords: 600, maximumOutputWords: 1_000});
		expect(policyForEvidence('deep', evidenceWithWords(2_300))).toMatchObject({minimumOutputWords: 1_800, maximumOutputWords: 3_000, minimumEvidenceWords: 1_800});
	});
});
