import {describe, expect, it} from 'vitest';
import type {EpisodeEvidence, EpisodeRequestSnapshot} from '../../server/episodes/types';
import {aiAudioDisclosure, assertEvidenceSufficient, briefLengthPresets, countWords, policyForEvidence} from '../../server/episodes/modePolicy';
import {assertGeneratedEpisode, editorialLengthWarningForScript, narrationForScript} from '../../server/episodes/validation';
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

const requestFor = (mode: 'brief' | 'deep', briefLengthPreset?: 'compact' | 'standard'): EpisodeRequestSnapshot => ({
	id: `request-${mode}`,
	runId: `run-${mode}`,
	stationId: 'station-mode',
	stationRevision: 1,
	stationName: 'Mode station',
	topicInstruction: 'Explain only the supplied material.',
	mode,
	briefLengthPreset: briefLengthPreset ?? 'standard',
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
	it('defines compact and standard Brief contracts from one typed policy source', () => {
		expect(countWords(aiAudioDisclosure)).toBe(7);
		expect(briefLengthPresets.compact).toEqual({
			minimumOutputWords: 50,
			maximumOutputWords: 350,
			preferredMinimumOutputWords: 200,
			preferredMaximumOutputWords: 350,
			targetOutputWords: 275,
			providerTargetOutputWords: 300,
			maxOutputTokens: 4_000,
		});
		expect(briefLengthPresets.standard).toEqual({
			minimumOutputWords: 600,
			maximumOutputWords: 1_000,
			preferredMinimumOutputWords: 600,
			preferredMaximumOutputWords: 1_000,
			targetOutputWords: 700,
			providerTargetOutputWords: 700,
			maxOutputTokens: 8_000,
		});
		expect(policyForEvidence('brief', evidenceWithWords(2_300), 'compact')).toMatchObject(briefLengthPresets.compact);
		expect(policyForEvidence('brief', evidenceWithWords(2_300))).toMatchObject(briefLengthPresets.standard);
		expect(policyForEvidence('deep', evidenceWithWords(2_300), 'compact')).toMatchObject({
			minimumOutputWords: 1_800,
			maximumOutputWords: 3_000,
			preferredMinimumOutputWords: 1_800,
			preferredMaximumOutputWords: 3_000,
			targetOutputWords: 2_100,
			providerTargetOutputWords: 2_100,
		});
	});

	it('applies Compact hard boundaries and warns below the preferred editorial range', () => {
		const evidence = evidenceWithWords(2_300);
		const sectionsFor = (publishedWords: number) => {
			const factualWords = publishedWords - countWords(aiAudioDisclosure);
			const words = [...evidence[0]!.body.matchAll(/\S+/g)].slice(0, factualWords);
			const segments = [];
			for (let offset = 0; offset < words.length; offset += 40) {
				const group = words.slice(offset, offset + 40);
				const text = evidence[0]!.body.slice(group[0]!.index!, group.at(-1)!.index! + group.at(-1)![0].length);
				segments.push({
					id: `claim-compact-${offset}`,
					kind: 'factual' as const,
					text,
					citations: [{snapshotId: evidence[0]!.id, excerpt: text}],
					supportStatus: 'supported' as const,
					speakerRole: 'host' as const,
				});
			}
			return [{
				id: 'section-compact-disclosure', title: 'AI audio disclosure', type: 'intro' as const,
				segments: [{id: 'claim-compact-disclosure', kind: 'transition' as const, text: aiAudioDisclosure, citations: [], supportStatus: 'not_required' as const, speakerRole: 'host' as const}],
			}, {id: 'section-compact-facts', title: 'Source summary', type: 'news_summary' as const, segments}];
		};
		const request = requestFor('brief', 'compact');
		for (const words of [50, 199, 200, 350]) {
			const script = assertGeneratedEpisode(request, evidence, sectionsFor(words));
			expect(countWords(narrationForScript(script))).toBe(words);
			const warning = editorialLengthWarningForScript(request, evidence, script);
			if (words < 200) {
				expect(warning).toEqual({
					code: 'COMPACT_EDITORIAL_LENGTH_BELOW_PREFERRED',
					category: 'editorial_length',
					actualWords: words,
					preferredMinimumWords: 200,
					preferredMaximumWords: 350,
				});
			} else expect(warning).toBeUndefined();
		}
		for (const [words, direction] of [[49, 'below'], [351, 'above']] as const) {
			expect(() => assertGeneratedEpisode(request, evidence, sectionsFor(words))).toThrow(expect.objectContaining({
				code: 'EPISODE_LENGTH_OUT_OF_RANGE',
				diagnostic: {stage: 'length_validation', category: 'length_out_of_range', actualWords: words, minimumWords: 50, maximumWords: 350, direction},
			}));
		}
		expect(() => assertGeneratedEpisode(request, evidence, sectionsFor(countWords(aiAudioDisclosure)))).toThrow();
	});

	it('uses the Compact provider guard target without changing its published target or acceptance range', () => {
		const evidence = evidenceWithWords(2_300);
		const policy = policyForEvidence('brief', evidence, 'compact');
		const generated = fakeGeneratedSections(jobFor('brief'), evidence, 'brief', 'compact');

		expect(policy).toMatchObject({
			minimumOutputWords: 50,
			maximumOutputWords: 350,
			preferredMinimumOutputWords: 200,
			preferredMaximumOutputWords: 350,
			targetOutputWords: 275,
			providerTargetOutputWords: 300,
		});
		expect(countWords(narrationForScript(assertGeneratedEpisode(requestFor('brief', 'compact'), evidence, generated)))).toBe(300);
	});

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
		expect(() => assertEvidenceSufficient('brief', evidenceWithWords(wordCount), 'compact')).toThrow(expect.objectContaining({code: 'INSUFFICIENT_SOURCE_MATERIAL'}));
	});

	it('publishes fixed, observable policy boundaries', () => {
		expect(policyForEvidence('brief', evidenceWithWords(2_300))).toMatchObject({minimumOutputWords: 600, maximumOutputWords: 1_000});
		expect(policyForEvidence('brief', evidenceWithWords(2_300), 'compact')).toMatchObject({minimumOutputWords: 50, maximumOutputWords: 350, preferredMinimumOutputWords: 200, preferredMaximumOutputWords: 350});
		expect(policyForEvidence('deep', evidenceWithWords(2_300))).toMatchObject({minimumOutputWords: 1_800, maximumOutputWords: 3_000, minimumEvidenceWords: 1_800});
	});
});
