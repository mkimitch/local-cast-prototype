import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {armTrace, captureTrace, purgeTraces, readProtected, traceSchema, withGenerationTrace, traceLimitBytes} from '../../server/debug/generationTrace';
import {artifactData, replayTrace} from '../../server/debug/replay';
import {traceReport} from '../../server/debug/report';
import {assertTracedEpisode} from '../../server/debug/validationTrace';
import type {GeneratedSection} from '../../server/episodes/types';
import {OpenAiTextProvider} from '../../server/providers/openai';
import {OpenAiCompatibleTextProvider} from '../../server/providers/openAiCompatible';
import type {EpisodeEvidence, EpisodeRequestSnapshot} from '../../server/episodes/types';

const temporary: string[] = [];
const root = () => { const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'localcast-trace-')); temporary.push(parent); return path.join(parent, '.generation-traces'); };
const load = (directory: string) => traceSchema.parse(JSON.parse(readProtected(path.join(directory, fs.readdirSync(directory).find(name => name.startsWith('trace-') && name.endsWith('.json'))!))));
const body = 'A person explicitly requests each LocalCast episode. The worker processes one generation job at a time. The database retains immutable supplied evidence. Each factual statement must have a verbatim supporting excerpt. The application does not search for new material or invent missing facts.';
const request: EpisodeRequestSnapshot = {id: 'request-synthetic', runId: 'run-synthetic', stationId: 'station-synthetic', stationRevision: 1, stationName: 'Synthetic station', topicInstruction: 'Summarize supplied evidence.', mode: 'brief', briefLengthPreset: 'standard', requestHash: 'synthetic', requestedAt: '2026-10-15T12:00:00Z'};
const evidence: EpisodeEvidence[] = [{id: 'snapshot-synthetic', originalId: 'note-synthetic', kind: 'note', title: 'Synthetic facts', body, contentSha256: createHash('sha256').update(body).digest('hex'), networkScope: 'user_supplied'}];
afterEach(() => { vi.restoreAllMocks(); for (const directory of temporary.splice(0)) fs.rmSync(directory, {recursive: true, force: true}); });

describe('one-attempt local generation traces', () => {
	it('is disabled by default and does not create a directory', async () => {
		const directory = root();
		await withGenerationTrace(directory, request.stationId, {}, [], async () => captureTrace('private', 'test', 'raw', 'not retained'));
		expect(fs.existsSync(directory)).toBe(false);
	});

	it.each(['OpenAI', 'Ollama', 'LM Studio'] as const)('preserves exact rejected %s exchange and replays without any provider calls', async adapter => {
		const directory = root(); armTrace(directory, request.stationId);
		const draft = {sections: [{title: 'Provider title', type: 'news_summary', segments: [{kind: 'factual', text: body, citations: ['E01']}]}]};
		const verdict = {results: [{claimId: 'claim-run-synthetic-0-0', status: 'uncertain'}]};
		const raws: string[] = [];
		const sent: string[] = [];
		const fetchMock = vi.fn(async (_url, init) => {
			sent.push(init.body);
			const value = sent.length === 1 ? draft : verdict;
			const envelope = adapter === 'OpenAI'
				? {id: 'response-synthetic', status: 'completed', output: [{type: 'message', content: [{type: 'output_text', text: JSON.stringify(value)}]}], usage: {input_tokens: 100, output_tokens: 50}}
				: {id: 'response-synthetic', choices: [{message: {content: JSON.stringify(value)}}], usage: {prompt_tokens: 100, completion_tokens: 50}};
			const raw = JSON.stringify(envelope, null, 2) + '\n'; raws.push(raw);
			return new Response(raw, {headers: {'x-request-id': 'request-synthetic'}});
		});
		const provider = adapter === 'OpenAI' ? new OpenAiTextProvider('synthetic-private-credential', 'synthetic-model', {fetchImpl: fetchMock}) : new OpenAiCompatibleTextProvider(adapter, 'http://127.0.0.1:1', 'synthetic-model', {fetchImpl: fetchMock});
		await expect(withGenerationTrace(directory, request.stationId, {attemptNumber: 1}, ['synthetic-private-credential'], async () => {
			captureTrace('request', 'snapshot', 'raw', request);
			captureTrace('evidence', 'snapshot', 'raw', evidence);
			return provider.generateEpisode(request, evidence, new AbortController().signal);
		})).rejects.toMatchObject({code: 'UNSUPPORTED_GENERATED_CLAIM'});
		const trace = load(directory);
		expect(trace).toMatchObject({status: 'failed', redacted: false, incomplete: false});
		expect(artifactData(trace, 'draft.request')).toBe(sent[0]);
		expect(artifactData(trace, 'support.request')).toBe(sent[1]);
		expect(artifactData(trace, 'draft.response')).toBe(raws[0]);
		expect(artifactData(trace, 'support.response')).toBe(raws[1]);
		expect(artifactData(trace, 'support.parsed')).toEqual(verdict);
		expect(artifactData(trace, 'support.decisions')).toEqual([{index: 0, claimId: 'claim-run-synthetic-0-0', status: 'uncertain'}]);
		expect(artifactData(trace, 'evidence')).toEqual(evidence);
		expect(JSON.stringify(trace)).not.toContain('synthetic-private-credential');
		const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Replay must never use network'));
		expect(replayTrace(trace)).toMatchObject({deterministic: 'PASS', originalVerdict: verdict, providerRequests: 0, published: false, resolved: [{segments: [{citations: [{snapshotId: evidence[0].id, excerpt: body}]}]}]});
		expect(network).not.toHaveBeenCalled(); expect(fetchMock).toHaveBeenCalledTimes(2);
		const html = traceReport(trace);
		expect(html).toContain('UNSUPPORTED_GENERATED_CLAIM'); expect(html).toContain('uncertain'); expect(html).toContain('TTS reached: false');
		expect(fs.statSync(directory).mode & 0o777).toBe(0o700);
		for (const file of fs.readdirSync(directory)) expect(fs.statSync(path.join(directory, file)).mode & 0o777).toBe(0o600);
		await withGenerationTrace(directory, request.stationId, {}, [], async () => captureTrace('second', 'test', 'raw', 'must not appear'));
		expect(fs.readdirSync(directory)).toHaveLength(1);
		expect(artifactData(load(directory), 'second')).toBeUndefined();
		const malformed = structuredClone(trace); malformed.artifacts.find(a => a.name === 'draft.response')!.data = '{invalid';
		expect(replayTrace(malformed)).toMatchObject({deterministic: 'REJECTED', gate: 'provider_output_parsing'});
		const mismatch = structuredClone(trace); (artifactData(mismatch, 'evidence') as EpisodeEvidence[])[0].body += ' changed';
		expect(replayTrace(mismatch)).toMatchObject({deterministic: 'REJECTED', gate: 'frozen_inputs'});
	});

	it('redacts credentials, headers, nested JSON, URL tokens, and escapes untrusted report HTML', async () => {
		const directory = root(); armTrace(directory, request.stationId);
		await withGenerationTrace(directory, request.stationId, {}, ['private-exact-key'], async () => {
			captureTrace('secret', 'test', 'raw', {authorization: 'Basic abc', apiKey: 'secret', text: 'Authorization: Basic abc-auth private-exact-key Bearer private-token sk-example123456 https://u:p@host/path?token=private-query', content: JSON.stringify({token: 'nested-secret', body: '<script>alert(1)</script>'})});
		});
		const trace = load(directory); const raw = JSON.stringify(trace);
		expect(raw).not.toMatch(/private-exact-key|private-token|sk-example123456|private-query|nested-secret|Basic abc|abc-auth|u:p@/);
		expect(trace.redacted).toBe(true); expect(replayTrace(trace)).toMatchObject({deterministic: 'UNPROVEN'});
		expect(traceReport(trace)).not.toContain('<script>'); expect(traceReport(trace)).toContain('&lt;script&gt;');
	});

	it('bounds artifacts without truncating them silently and purges reports and expired arms', async () => {
		const directory = root(); armTrace(directory, request.stationId, 1 / 60);
		await withGenerationTrace(directory, request.stationId, {}, [], async () => captureTrace('too-large', 'test', 'raw', 'x'.repeat(3 * 1024 * 1024)));
		const trace = load(directory); expect(trace.incomplete).toBe(true);
		expect(artifactData(trace, 'too-large')).toEqual({omitted: 'capture_size_limit'});
		const filename = path.join(directory, fs.readdirSync(directory)[0]); expect(fs.statSync(filename).size).toBeLessThan(traceLimitBytes);
		fs.writeFileSync(filename.replace('.json', '.html'), 'private report', {mode: 0o600});
		armTrace(directory, request.stationId);
		expect(purgeTraces(directory, false, Date.now() + 3600001)).toBe(1); expect(fs.readdirSync(directory)).toEqual([]);
	});

	it('does not consume an arm for another station and refuses symlinks or permissive directories', async () => {
		const directory = root(); armTrace(directory, request.stationId);
		await withGenerationTrace(directory, 'other', {}, [], async () => {});
		expect(fs.existsSync(path.join(directory, 'armed.json'))).toBe(true);
		expect(purgeTraces(directory, true)).toBe(0); expect(fs.readdirSync(directory)).toEqual([]);
		fs.chmodSync(directory, 0o755); expect(() => armTrace(directory, request.stationId)).toThrow();
		fs.chmodSync(directory, 0o700);
		const link = path.join(path.dirname(directory), 'link'); fs.symlinkSync(directory, link); expect(() => armTrace(link, request.stationId)).toThrow();
	});
	it('purges orphan reports, crash temporary files, and invalid-expiry captures', async () => {
		const directory = root(); armTrace(directory, request.stationId);
		await withGenerationTrace(directory, request.stationId, {}, [], async () => {});
		const file = path.join(directory, fs.readdirSync(directory)[0]);
		const trace = JSON.parse(readProtected(file)); trace.expiresAt = 'not-a-date';
		fs.writeFileSync(file, JSON.stringify(trace));
		fs.writeFileSync(file + '.tmp', 'crash left private content', {mode: 0o600});
		const orphan = path.join(directory, 'trace-00000000-0000-4000-8000-000000000000.html');
		fs.writeFileSync(orphan, 'orphan private report', {mode: 0o600});
		expect(purgeTraces(directory, false, Date.now() + 86400001)).toBe(1);
		expect(fs.readdirSync(directory)).toEqual([]);
		fs.writeFileSync(orphan, 'new orphan', {mode: 0o600});
		purgeTraces(directory, true); expect(fs.readdirSync(directory)).toEqual([]);
	});

	it('marks interrupted stages unknown and contains capture I/O failure without losing the original failure', async () => {
		const directory = root(); armTrace(directory, request.stationId);
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		await expect(withGenerationTrace(directory, request.stationId, {}, [], async () => {
			const write = vi.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => { throw new Error('private path or credential'); });
			captureTrace('lost', 'test', 'raw', 'private'); write.mockRestore();
			// Remove the synthetic crash-left temp file to simulate restored storage.
			for (const name of fs.readdirSync(directory).filter(name => name.endsWith('.tmp'))) fs.unlinkSync(path.join(directory, name));
			throw new Error('original error');
		})).rejects.toThrow('original error');
		const trace = load(directory); expect(trace.incomplete).toBe(true);
		expect(log).toHaveBeenCalledWith('GENERATION_TRACE_WRITE_FAILED');
		expect(JSON.stringify(log.mock.calls)).not.toContain('private path');
		expect(traceReport({...trace, incomplete: false, status: 'running'})).toContain('TTS reached: unknown');
	});

	it.each(['malformed', 'http-rejection'])('preserves %s response bodies before parsing or rejection', async failure => {
		const directory = root(); armTrace(directory, request.stationId);
		const raw = failure === 'malformed' ? '{invalid provider json' : '{"error":{"message":"synthetic rejection"}}';
		const provider = new OpenAiTextProvider('synthetic-credential', 'synthetic-model', {fetchImpl: vi.fn().mockResolvedValue(new Response(raw, {status: failure === 'malformed' ? 200 : 401}))});
		await expect(withGenerationTrace(directory, request.stationId, {}, ['synthetic-credential'], () => provider.generateEpisode(request, evidence, new AbortController().signal))).rejects.toBeDefined();
		expect(artifactData(load(directory), 'draft.response')).toBe(raw);
	});

	it('records already-passed gates when narration exceeds the speech character bound', async () => {
		const directory = root(); armTrace(directory, request.stationId);
		const sourceBody = Array.from({length: 1000}, (_, index) => `sourceword${index}`).join(' ');
		const sources = [{...evidence[0], body: sourceBody, contentSha256: createHash('sha256').update(sourceBody).digest('hex')}];
		const sections: GeneratedSection[] = Array.from({length: 5}, (_, sectionIndex) => ({
			id: `section-${sectionIndex}`, title: 'Synthetic', type: 'news_summary',
			segments: Array.from({length: 7}, (_, segmentIndex) => ({
				id: `claim-${sectionIndex}-${segmentIndex}`, kind: 'factual', speakerRole: 'host', supportStatus: 'supported',
				text: Array.from({length: 20}, () => 'x'.repeat(49)).join(' '),
				citations: [{snapshotId: sources[0].id, excerpt: 'sourceword0'}],
			})),
		}));
		await expect(withGenerationTrace(directory, request.stationId, {}, [], async () => assertTracedEpisode(request, sources, sections))).rejects.toMatchObject({code: 'TTS_INPUT_TOO_LARGE'});
		expect(artifactData(load(directory), 'deterministic.failed')).toMatchObject({citations: 'passed', length: 'passed', code: 'TTS_INPUT_TOO_LARGE'});
	});

});
