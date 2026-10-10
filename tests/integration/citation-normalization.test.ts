import {afterEach, describe, expect, it, vi} from 'vitest';
import {createTestDatabase, testConfig} from '../helpers/database';
import {EpisodeStore, episodeStore} from '../../server/services/episodeStore';
import {StationStore} from '../../server/services/stationStore';
import {ProviderCheckStore} from '../../server/services/providerCheckStore';
import {GenerationJobStore} from '../../server/jobs/generationJobStore';
import {createGenerationProcessor} from '../../server/jobs/generationProcessor';
import {OpenAiSpeechProvider} from '../../server/providers/openai';

afterEach(() => { vi.restoreAllMocks(); });

describe('normalization through the configured generation processor', () => {
	it.each(['exact', 'ambiguous', 'unknown', 'nonverbatim', 'unsupported'] as const)('%s citations retain validation, publication fencing, and provider evidence', async pattern => {
		const db = createTestDatabase();
		try {
			const jobs = new GenerationJobStore(db);
			const episodes = new EpisodeStore(db);
			const stations = new StationStore(db);
			const body = 'A person explicitly requests each LocalCast episode. The worker processes one generation job at a time. The database retains immutable supplied evidence. Each factual statement must have a verbatim supporting excerpt. The application does not search for new material or invent missing facts.';
			const note = stations.createNote({title: 'Synthetic normalization facts', body});
			const station = stations.createStation({name: 'Synthetic station', topicInstruction: 'Use only supplied facts.', defaultMode: 'brief', noteIds: [note.id], sourceIds: []});
			const queued = jobs.enqueueStation(station.id, 'brief').job;
			if (queued.payload.version !== 2) throw new Error('Expected version two request');
			const evidence = episodes.finalizeEvidence(queued.payload.requestId, queued.runId);
			const job = jobs.claimNext('test-worker', 60_000)!;
			vi.spyOn(episodeStore, 'getRequest').mockImplementation(id => episodes.getRequest(id));
			vi.spyOn(episodeStore, 'listEvidence').mockImplementation(id => episodes.listEvidence(id));
			vi.spyOn(episodeStore, 'finalizeEvidence').mockImplementation((requestId, runId) => episodes.finalizeEvidence(requestId, runId));
			const publish = vi.spyOn(episodeStore, 'publishEpisode');
			const render = vi.spyOn(OpenAiSpeechProvider.prototype, 'render').mockRejectedValue(new Error('synthetic stop at speech boundary'));
			vi.spyOn(console, 'info').mockImplementation(() => {});
			const config = testConfig({textProvider: 'openai', speechProvider: 'openai', openAiApiKey: 'synthetic-credential', allowFakeProviders: false});
			const checks = new ProviderCheckStore(db);
			checks.recordLive('text', config);
			checks.recordLive('speech', config);
			const before = db.prepare('SELECT * FROM provider_checks ORDER BY capability').all();
			const citation = {snapshotId: pattern === 'unknown' ? 'unknown' : evidence[0]!.id, excerpt: pattern === 'nonverbatim' ? 'Not in the supplied evidence.' : body};
			const citations = [citation, {...citation}];
			if (pattern === 'ambiguous') citations.push({snapshotId: evidence[0]!.id, excerpt: 'A person explicitly requests each LocalCast episode.'});
			const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
				const value = fetchMock.mock.calls.length === 1
					? {sections: [{title: 'Synthetic', type: 'news_summary', segments: [{kind: 'factual', text: body, citations}]}]}
					: {results: [{claimId: `claim-${job.runId}-0-0`, status: pattern === 'unsupported' ? 'unsupported' : 'supported'}]};
				return new Response(JSON.stringify({status: 'completed', output: [{type: 'message', content: [{type: 'output_text', text: JSON.stringify(value)}]}]}), {headers: {'content-type': 'application/json'}});
			});
			const processor = createGenerationProcessor(config, jobs, {resolve: () => config.openAiApiKey}, checks);
			expect(fetchMock).not.toHaveBeenCalled();
			const processing = processor.process(job, 'test-worker', new AbortController().signal);
			if (pattern === 'exact') {
				await expect(processing).rejects.toThrow('synthetic stop at speech boundary');
				expect(render).toHaveBeenCalledTimes(1);
				expect(fetchMock).toHaveBeenCalledTimes(2);
			} else {
				await expect(processing).rejects.toMatchObject({code: pattern === 'unsupported' ? 'UNSUPPORTED_GENERATED_CLAIM' : 'INVALID_CITATIONS', providerStatusImpact: 'preserve'});
				expect(render).not.toHaveBeenCalled();
				expect(fetchMock).toHaveBeenCalledTimes(pattern === 'unsupported' ? 2 : 1);
				expect(db.prepare('SELECT * FROM provider_checks ORDER BY capability').all()).toEqual(before);
			}
			expect(publish).not.toHaveBeenCalled();
			expect(db.prepare('SELECT COUNT(*) AS count FROM briefing_sections').get()).toEqual({count: 0});
			expect(episodes.listEvidence(job.runId)).toEqual(evidence);
		} finally { db.close(); }
	});
});
