import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, expect, it, vi} from 'vitest';
import {createTestDatabase, testConfig} from '../helpers/database';
import {EpisodeStore, episodeStore} from '../../server/services/episodeStore';
import {StationStore} from '../../server/services/stationStore';
import {ProviderCheckStore} from '../../server/services/providerCheckStore';
import {GenerationJobStore} from '../../server/jobs/generationJobStore';
import {createGenerationProcessor} from '../../server/jobs/generationProcessor';
import {GenerationWorker} from '../../server/jobs/generationWorker';
import {OpenAiSpeechProvider} from '../../server/providers/openai';
import {armTrace, readProtected, traceRootForDatabase, traceSchema} from '../../server/debug/generationTrace';
import {artifactData, replayTrace} from '../../server/debug/replay';

afterEach(() => vi.restoreAllMocks());

it.each(['unsupported', 'reference', 'length', 'snapshot-read'])('retains %s rejection through the real processor without speech or publication', async failure => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'localcast-trace-integration-'));
	const db = createTestDatabase();
	try {
		const jobs = new GenerationJobStore(db);
		const episodes = new EpisodeStore(db);
		const stations = new StationStore(db);
		const body = 'A person explicitly requests each LocalCast episode. The worker processes one generation job at a time. The database retains immutable supplied evidence. Each factual statement must have a verbatim supporting excerpt. The application does not search for new material or invent missing facts.';
		const note = stations.createNote({title: 'Synthetic facts', body});
		const station = stations.createStation({name: 'Synthetic station', topicInstruction: 'Use supplied facts.', defaultMode: 'brief', noteIds: [note.id], sourceIds: []});
		const queued = jobs.enqueueStation(station.id, 'brief').job;
		vi.spyOn(episodeStore, 'getRequest').mockImplementation(id => episodes.getRequest(id));
		vi.spyOn(episodeStore, 'listRequestNotes').mockImplementation(id => { if (failure === 'snapshot-read') throw new Error('synthetic trace read failure'); return episodes.listRequestNotes(id); });
		vi.spyOn(episodeStore, 'listRequestSources').mockImplementation(id => episodes.listRequestSources(id));
		vi.spyOn(episodeStore, 'listEvidence').mockImplementation(id => episodes.listEvidence(id));
		vi.spyOn(episodeStore, 'finalizeEvidence').mockImplementation((requestId, runId) => episodes.finalizeEvidence(requestId, runId));
		const publish = vi.spyOn(episodeStore, 'publishEpisode');
		const render = vi.spyOn(OpenAiSpeechProvider.prototype, 'render');
		const config = testConfig({databasePath: path.join(directory, 'unused.sqlite'), textProvider: 'openai', speechProvider: 'openai', openAiApiKey: 'synthetic-credential', allowFakeProviders: false});
		const root = traceRootForDatabase(config.databasePath); armTrace(root, station.id);
		const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
			const value = fetchMock.mock.calls.length === 1
				? {sections: [{title: 'Synthetic', type: 'news_summary', segments: [{kind: 'factual', text: failure === 'length' ? 'Too short.' : body, citations: [failure === 'reference' ? 'E99' : 'E01']}]}]}
				: {results: [{claimId: `claim-${queued.runId}-0-0`, status: 'unsupported'}]};
			return new Response(JSON.stringify({status: 'completed', output: [{type: 'message', content: [{type: 'output_text', text: JSON.stringify(value)}]}]}));
		});
		const processor = createGenerationProcessor(config, jobs, {resolve: () => config.openAiApiKey}, new ProviderCheckStore(db));
		await new GenerationWorker(config, jobs, processor).runOnce();
		const trace = traceSchema.parse(JSON.parse(readProtected(path.join(root, fs.readdirSync(root).find(name => name.endsWith('.json'))!))));
		expect(trace.status).toBe('failed');
		if (failure === 'length') expect(artifactData(trace, 'deterministic.failed')).toMatchObject({citations: 'passed', length: 'failed'});
		if (failure === 'unsupported') expect(artifactData(trace, 'deterministic.passed')).toMatchObject({citations: 'passed', length: 'passed', actualWords: expect.any(Number), minimumWords: expect.any(Number), maximumWords: expect.any(Number)});
		expect(artifactData(trace, 'attempt')).toEqual({jobId: queued.id, runId: queued.runId, attemptNumber: 1});
		if (failure !== 'snapshot-read') expect(artifactData(trace, 'request.notes')).toEqual(episodes.listRequestNotes((queued.payload as {requestId: string}).requestId));
		else expect(trace.incomplete).toBe(true);
		expect(artifactData(trace, 'evidence')).toEqual(episodes.listEvidence(queued.runId));
		const result = replayTrace(trace);
		expect(result).toMatchObject({deterministic: failure === 'snapshot-read' ? 'UNPROVEN' : failure === 'unsupported' ? 'PASS' : 'REJECTED', providerRequests: 0, published: false});
		if (failure === 'length' || failure === 'reference') expect(result).toMatchObject({code: failure === 'reference' ? 'INVALID_CITATIONS' : 'EPISODE_LENGTH_OUT_OF_RANGE'});
		expect(fetchMock).toHaveBeenCalledTimes(failure === 'unsupported' || failure === 'snapshot-read' ? 2 : 1);
		expect(render).not.toHaveBeenCalled(); expect(publish).not.toHaveBeenCalled();
		expect(jobs.get(queued.id)?.state).toBe('failed');
		for (const table of ['briefing_sections', 'transcript_claims', 'audio_assets']) expect(db.prepare(`SELECT count(*) AS count FROM ${table}`).get()).toEqual({count: 0});
		expect(JSON.stringify(jobs.listEvents(queued.id))).not.toContain(body);
	} finally { db.close(); fs.rmSync(directory, {recursive: true, force: true}); }
});
