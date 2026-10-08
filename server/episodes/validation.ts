import type {EpisodeEvidence, EpisodeRequestSnapshot, GeneratedEpisodeScript, GeneratedSection} from './types';
import {assertEvidenceSufficient, countWords, policyForEvidence} from './modePolicy';
import {GenerationError} from '../jobs/types';

const invalidEpisode = (code: string, message: string): never => {
	throw new GenerationError(code, message, false);
};

export const narrationForScript = (script: GeneratedEpisodeScript): string => script.sections
	.flatMap(section => section.segments.map(segment => segment.text))
	.join('\n\n');

export const assertGeneratedEpisode = (
	request: EpisodeRequestSnapshot,
	evidence: EpisodeEvidence[],
	sections: GeneratedSection[],
): GeneratedEpisodeScript => {
	assertEvidenceSufficient(request.mode, evidence);
	if (sections.length === 0 || sections.length > 8) invalidEpisode('INVALID_EPISODE_STRUCTURE', 'The generated transcript structure was invalid');
	const evidenceById = new Map(evidence.map(item => [item.id, item]));
	const ids = new Set<string>();
	let factualClaims = 0;

	for (const section of sections) {
		if (!section.id || ids.has(section.id) || section.segments.length === 0 || section.segments.length > 12) {
			invalidEpisode('INVALID_EPISODE_STRUCTURE', 'The generated transcript structure was invalid');
		}
		ids.add(section.id);
		for (const segment of section.segments) {
			if (!segment.id || ids.has(segment.id) || !segment.text.trim() || segment.text !== segment.text.trim() || segment.text.length > 1_200) {
				invalidEpisode('INVALID_EPISODE_STRUCTURE', 'The generated transcript contained an invalid segment');
			}
			ids.add(segment.id);
			if (segment.speakerRole !== 'host') invalidEpisode('INVALID_EPISODE_STRUCTURE', 'The generated transcript contained an unsupported speaker role');
			if (segment.kind === 'transition') {
				if (segment.supportStatus !== 'not_required' || segment.citations.length !== 0) {
					invalidEpisode('INVALID_CITATIONS', 'The generated transcript contained an invalid transition');
				}
				continue;
			}

			factualClaims += 1;
			if (segment.supportStatus !== 'supported' || segment.citations.length === 0 || segment.citations.length > 4) {
				invalidEpisode('INVALID_CITATIONS', 'The generated transcript contained an uncited factual claim');
			}
			const citationIds = new Set<string>();
			for (const citation of segment.citations) {
				if (citationIds.has(citation.snapshotId)) invalidEpisode('INVALID_CITATIONS', 'The generated transcript repeated a source citation within one factual segment');
				citationIds.add(citation.snapshotId);
				const source = evidenceById.get(citation.snapshotId);
				if (
					!source
					|| citation.excerpt.length < 5
					|| citation.excerpt.length > 600
					|| citation.excerpt !== citation.excerpt.trim()
					|| !source.body.includes(citation.excerpt)
				) invalidEpisode('INVALID_CITATIONS', 'The generated transcript cited evidence that could not be validated');
			}
		}
	}

	if (factualClaims === 0) invalidEpisode('INVALID_EPISODE_STRUCTURE', 'The generated transcript contained no factual claims');
	const script: GeneratedEpisodeScript = {version: 1, sections};
	const narration = narrationForScript(script);
	const words = countWords(narration);
	const policy = policyForEvidence(request.mode, evidence);
	if (words < policy.minimumOutputWords || words > policy.maximumOutputWords) {
		invalidEpisode(
			'EPISODE_LENGTH_OUT_OF_RANGE',
			`The generated ${request.mode} episode did not meet its source-grounded length contract`,
		);
	}
	if (narration.length > 32_000) invalidEpisode('TTS_INPUT_TOO_LARGE', 'The generated narration exceeded the configured speech limit');
	return script;
};
