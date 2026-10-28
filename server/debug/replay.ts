import {extractOutputText, compatibleOutputText} from '../providers/textOutput';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {episodeDraftSchema, sectionsForResolvedDraft} from '../episodes/draft';
import {buildEvidenceCatalog, resolveEvidenceReferences} from '../episodes/evidenceCatalog';
import {assertGeneratedEpisode, narrationForScript} from '../episodes/validation';
import {GenerationError} from '../jobs/types';
import {traceSchema, type GenerationTrace} from './generationTrace';

const requestSchema = z.object({
	id: z.string(), runId: z.string(), stationId: z.string(), stationRevision: z.number().int(),
	stationName: z.string(), topicInstruction: z.string(), mode: z.enum(['brief', 'deep']), briefLengthPreset: z.enum(['compact', 'standard']), requestHash: z.string(), requestedAt: z.string(),
}).strict();
const evidenceSchema = z.array(z.object({
	id: z.string(), originalId: z.string().optional(), kind: z.enum(['note', 'feed']), title: z.string(), body: z.string(),
	author: z.string().optional(), originalUrl: z.string().optional(), publishedAt: z.string().optional(), contentSha256: z.string(),
	sourceId: z.string().optional(), sourceName: z.string().optional(), networkScope: z.enum(['public', 'private', 'unknown', 'user_supplied']),
}).strict()).max(50);

export const artifactData = (trace: GenerationTrace, name: string): unknown => trace.artifacts.find(artifact => artifact.name === name)?.data;

export const replayTrace = (input: unknown) => {
	const trace = traceSchema.parse(input);
	const originalVerdict = artifactData(trace, 'support.parsed') ?? null;
	const base = {semanticSupport: 'ORIGINAL VERDICT ONLY; no offline classifier was run', originalVerdict, providerRequests: 0, published: false};
	if (trace.redacted || trace.incomplete) return {...base, deterministic: 'UNPROVEN', gate: 'capture', code: 'REDACTED_OR_INCOMPLETE_CAPTURE'};
	let gate = 'frozen_inputs';
	try {
		const request = requestSchema.parse(artifactData(trace, 'request'));
		const evidence = evidenceSchema.parse(artifactData(trace, 'evidence'));
		if (evidence.some(item => createHash('sha256').update(item.body).digest('hex') !== item.contentSha256)) throw new Error('Evidence checksum mismatch');
		gate = 'evidence_catalog';
		const catalog = buildEvidenceCatalog(evidence);
		if (JSON.stringify(catalog) !== JSON.stringify(artifactData(trace, 'catalog'))) throw new Error('Catalog differs from captured association');
		gate = 'provider_output_parsing';
		const provider = z.object({adapter: z.enum(['OpenAI', 'Ollama', 'LM Studio']), model: z.string()}).parse(artifactData(trace, 'provider'));
		const envelope = JSON.parse(z.string().parse(artifactData(trace, 'draft.response')));
		const text = provider.adapter === 'OpenAI' ? extractOutputText(envelope) : compatibleOutputText(envelope, provider.adapter === 'Ollama' ? 'OLLAMA' : 'LM_STUDIO');
		const draft = episodeDraftSchema.parse(JSON.parse(text));
		gate = 'citation_reference_resolution';
		const resolved = resolveEvidenceReferences(draft, catalog);
		const sections = sectionsForResolvedDraft(request, resolved);
		gate = 'citation_and_length_validation';
		const script = assertGeneratedEpisode(request, evidence, sections);
		return {...base, deterministic: 'PASS', gate: 'complete', narration: narrationForScript(script), resolved};
	} catch (error) {
		return {...base, deterministic: 'REJECTED', gate: error instanceof GenerationError ? error.diagnostic?.stage ?? gate : gate, code: error instanceof GenerationError ? error.code : 'INVALID_CAPTURE_OR_OUTPUT'};
	}
};
