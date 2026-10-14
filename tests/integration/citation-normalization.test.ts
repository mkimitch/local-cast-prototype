import {afterEach, describe, expect, it, vi} from 'vitest';
import {createTestDatabase, testConfig} from '../helpers/database';
import {EpisodeStore, episodeStore} from '../../server/services/episodeStore';
import {StationStore} from '../../server/services/stationStore';
import {ProviderCheckStore} from '../../server/services/providerCheckStore';
import {GenerationJobStore} from '../../server/jobs/generationJobStore';
import {createGenerationProcessor} from '../../server/jobs/generationProcessor';
import {GenerationWorker} from '../../server/jobs/generationWorker';
import {OpenAiSpeechProvider} from '../../server/providers/openai';
import {BriefingStore} from '../../server/services/briefingStore';

afterEach(() => { vi.restoreAllMocks(); });

describe('normalization through the configured generation processor', () => {
	it.each(['exact', 'repeated', 'unknown', 'unsupported'] as const)('%s references retain validation, publication fencing, and provider evidence', async pattern => {
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
			const citations = [pattern === 'unknown' ? 'E99' : 'E01'];
			if (pattern === 'repeated') citations.push('E01');
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

	it('persists bounded attempt-correlated reference diagnostics without evidence content', async () => {
		const db = createTestDatabase();
		try {
			const jobs = new GenerationJobStore(db);
			const episodes = new EpisodeStore(db);
			const stations = new StationStore(db);
			const body = 'A person explicitly requests each LocalCast episode. The worker processes one generation job at a time. The database retains immutable supplied evidence. Each factual statement must have a verbatim supporting excerpt. The application does not search for new material or invent missing facts.';
			const note = stations.createNote({title: 'Private diagnostic title canary', body});
			const station = stations.createStation({name: 'Synthetic station', topicInstruction: 'Use only supplied facts.', defaultMode: 'brief', noteIds: [note.id], sourceIds: []});
			const queued = jobs.enqueueStation(station.id, 'brief').job;
			vi.spyOn(episodeStore, 'getRequest').mockImplementation(id => episodes.getRequest(id));
			vi.spyOn(episodeStore, 'listEvidence').mockImplementation(id => episodes.listEvidence(id));
			vi.spyOn(episodeStore, 'finalizeEvidence').mockImplementation((requestId, runId) => episodes.finalizeEvidence(requestId, runId));
			const render = vi.spyOn(OpenAiSpeechProvider.prototype, 'render');
			const config = testConfig({textProvider: 'openai', speechProvider: 'openai', openAiApiKey: 'synthetic-credential', allowFakeProviders: false, workerId: 'diagnostic-worker'});
			const checks = new ProviderCheckStore(db);
			const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
				status: 'completed',
				output: [{type: 'message', content: [{type: 'output_text', text: JSON.stringify({
					sections: [{title: 'Synthetic', type: 'news_summary', segments: [{kind: 'factual', text: body, citations: ['E99']}]}],
				})}]}],
			}), {headers: {'content-type': 'application/json'}}));
			const processor = createGenerationProcessor(config, jobs, {resolve: () => config.openAiApiKey}, checks);
			const worker = new GenerationWorker(config, jobs, processor);

			await expect(worker.runOnce()).resolves.toBe(true);
			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect(render).not.toHaveBeenCalled();
			expect(episodes.listEvidence(queued.runId)).toHaveLength(1);
			const failedEvent = jobs.listEvents(queued.id).at(-1)!;
			expect(failedEvent).toMatchObject({attemptNumber: 1, phase: 'failed'});
			expect(JSON.parse(failedEvent.detail!)).toEqual({
				code: 'INVALID_CITATIONS',
				stage: 'citation_reference_resolution',
				category: 'unknown_reference',
				sectionIndex: 0,
				segmentIndex: 0,
				citationIndex: 0,
				referenceCount: 1,
			});
			expect(failedEvent.detail).not.toMatch(/Private diagnostic|person explicitly|snapshot|excerpt/i);
			expect(db.prepare('SELECT COUNT(*) AS count FROM briefing_sections').get()).toEqual({count: 0});
		} finally { db.close(); }
	});

	it('persists private-free Compact length diagnostics and stops before support, speech, and publication', async () => {
		const db = createTestDatabase();
		try {
			const jobs = new GenerationJobStore(db);
			const episodes = new EpisodeStore(db);
			const stations = new StationStore(db);
			const words = Array.from({length: 800}, (_value, index) => `privateword${String(index + 1).padStart(4, '0')}`);
			const body = words.join(' ');
			const note = stations.createNote({title: 'Private length title canary', body});
			const station = stations.createStation({
				name: 'Compact diagnostic station',
				topicInstruction: 'Use only supplied facts.',
				defaultMode: 'brief',
				briefLengthPreset: 'compact',
				noteIds: [note.id],
				sourceIds: [],
			});
			const queued = jobs.enqueueStation(station.id, 'brief').job;
			vi.spyOn(episodeStore, 'getRequest').mockImplementation(id => episodes.getRequest(id));
			vi.spyOn(episodeStore, 'listEvidence').mockImplementation(id => episodes.listEvidence(id));
			vi.spyOn(episodeStore, 'finalizeEvidence').mockImplementation((requestId, runId) => episodes.finalizeEvidence(requestId, runId));
			const publish = vi.spyOn(episodeStore, 'publishEpisode');
			const render = vi.spyOn(OpenAiSpeechProvider.prototype, 'render');
			const sections = [{
				title: 'Synthetic',
				type: 'news_summary',
				segments: [{
					kind: 'factual',
					text: words.slice(0, 42).join(' '),
					citations: ['E01'],
				}],
			}];
			const config = testConfig({textProvider: 'openai', speechProvider: 'openai', openAiApiKey: 'synthetic-credential', allowFakeProviders: false, workerId: 'length-worker'});
			const checks = new ProviderCheckStore(db);
			checks.recordLive('text', config);
			const before = db.prepare("SELECT * FROM provider_checks WHERE capability = 'text'").get();
			const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
				status: 'completed',
				output: [{type: 'message', content: [{type: 'output_text', text: JSON.stringify({sections})}]}],
			}), {headers: {'content-type': 'application/json'}}));
			const processor = createGenerationProcessor(config, jobs, {resolve: () => config.openAiApiKey}, checks);
			const worker = new GenerationWorker(config, jobs, processor);

			await expect(worker.runOnce()).resolves.toBe(true);
			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect(render).not.toHaveBeenCalled();
			expect(publish).not.toHaveBeenCalled();
			expect(db.prepare("SELECT * FROM provider_checks WHERE capability = 'text'").get()).toEqual(before);
			const detail = jobs.listEvents(queued.id).at(-1)!.detail!;
			expect(JSON.parse(detail)).toEqual({
				code: 'EPISODE_LENGTH_OUT_OF_RANGE',
				stage: 'length_validation',
				category: 'length_out_of_range',
				actualWords: 49,
				minimumWords: 50,
				maximumWords: 350,
				direction: 'below',
			});
			expect(detail).not.toMatch(/Private length|privateword|excerpt|snapshot/i);
			expect(db.prepare('SELECT COUNT(*) AS count FROM briefing_sections').get()).toEqual({count: 0});
		} finally { db.close(); }
	});

	it('publishes a supported 199-word Compact episode with a private-free editorial warning', async () => {
		const db = createTestDatabase();
		try {
			const jobs = new GenerationJobStore(db);
			const episodes = new EpisodeStore(db);
			const stations = new StationStore(db);
			const words = Array.from({length: 800}, (_value, index) => `privateword${String(index + 1).padStart(4, '0')}`);
			const note = stations.createNote({title: 'Private accepted title canary', body: words.join(' ')});
			const station = stations.createStation({
				name: 'Compact warning station',
				topicInstruction: 'Use only supplied facts.',
				defaultMode: 'brief',
				briefLengthPreset: 'compact',
				noteIds: [note.id],
				sourceIds: [],
			});
			const queued = jobs.enqueueStation(station.id, 'brief').job;
			vi.spyOn(episodeStore, 'getRequest').mockImplementation(id => episodes.getRequest(id));
			vi.spyOn(episodeStore, 'listEvidence').mockImplementation(id => episodes.listEvidence(id));
			vi.spyOn(episodeStore, 'finalizeEvidence').mockImplementation((requestId, runId) => episodes.finalizeEvidence(requestId, runId));
			vi.spyOn(episodeStore, 'publishEpisode').mockImplementation(input => episodes.publishEpisode(input));
			const render = vi.spyOn(OpenAiSpeechProvider.prototype, 'render').mockResolvedValue({
				id: `audio-${queued.runId}`,
				storageFilename: `episode-${queued.runId}.mp3`,
				durationMs: 60_000,
				byteLength: 12_345,
				sha256: 'a'.repeat(64),
				mimeType: 'audio/mpeg',
				validatedAt: '2026-10-14T12:00:00.000Z',
				provider: 'OpenAI',
				model: 'gpt-4o-mini-tts',
				voice: 'marin',
				liveRequestPerformed: false,
			});
			const sections = [{
				title: 'Synthetic',
				type: 'news_summary',
				segments: Array.from({length: 5}, (_value, index) => ({
					kind: 'factual',
					text: words.slice(index * 40, index === 4 ? 192 : index * 40 + 40).join(' '),
					citations: ['E01'],
				})),
			}];
			const config = testConfig({textProvider: 'openai', speechProvider: 'openai', openAiApiKey: 'synthetic-credential', allowFakeProviders: false, workerId: 'warning-worker'});
			const checks = new ProviderCheckStore(db);
			checks.recordLive('text', config);
			const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
				const value = fetchMock.mock.calls.length === 1
					? {sections}
					: {results: sections[0]!.segments.map((_segment, index) => ({claimId: `claim-${queued.runId}-0-${index}`, status: 'supported'}))};
				return new Response(JSON.stringify({status: 'completed', output: [{type: 'message', content: [{type: 'output_text', text: JSON.stringify(value)}]}]}), {headers: {'content-type': 'application/json'}});
			});
			const processor = createGenerationProcessor(config, jobs, {resolve: () => config.openAiApiKey}, checks);
			const worker = new GenerationWorker(config, jobs, processor);

			await expect(worker.runOnce()).resolves.toBe(true);
			expect(fetchMock).toHaveBeenCalledTimes(2);
			expect(render).toHaveBeenCalledTimes(1);
			expect(jobs.get(queued.id)).toMatchObject({state: 'complete', phase: 'complete'});
			const warning = new BriefingStore(db).getRun(queued.runId)?.warnings?.find(item => item.kind === 'editorial_length');
			expect(warning).toMatchObject({
				code: 'COMPACT_EDITORIAL_LENGTH_BELOW_PREFERRED',
				actualWords: 199,
				preferredMinimumWords: 200,
				preferredMaximumWords: 350,
			});
			expect(JSON.stringify(warning)).not.toMatch(/Private accepted|privateword|excerpt|snapshot/i);
			expect(db.prepare("SELECT status FROM provider_checks WHERE capability = 'text'").get()).toEqual({status: 'LIVE VERIFIED'});
		} finally { db.close(); }
	});
});
