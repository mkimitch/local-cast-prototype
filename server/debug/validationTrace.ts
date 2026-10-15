import {captureTrace} from './generationTrace';
import {assertGeneratedEpisode, narrationForScript} from '../episodes/validation';
import {countWords, policyForEvidence} from '../episodes/modePolicy';
import {GenerationError} from '../jobs/types';

// Observes the existing validator; never implements or bypasses a gate.
export const assertTracedEpisode: typeof assertGeneratedEpisode = (request, evidence, sections) => {
	try {
		const script = assertGeneratedEpisode(request, evidence, sections);
		const policy = policyForEvidence(request.mode, evidence, request.briefLengthPreset);
		captureTrace('deterministic.passed', 'assertGeneratedEpisode', 'derived', {
			citations: 'passed', length: 'passed', actualWords: countWords(narrationForScript(script)),
			minimumWords: policy.minimumOutputWords, maximumWords: policy.maximumOutputWords,
		});
		return script;
	} catch (error) {
		if (error instanceof GenerationError) captureTrace('deterministic.failed', 'assertGeneratedEpisode', 'derived', {
			code: error.code, diagnostic: error.diagnostic,
			citations: error.diagnostic?.stage === 'length_validation' || error.code === 'TTS_INPUT_TOO_LARGE' ? 'passed' : 'not_completed',
			length: error.code === 'TTS_INPUT_TOO_LARGE' ? 'passed' : error.diagnostic?.stage === 'length_validation' ? 'failed' : 'not_reached',
		});
		throw error;
	}
};
