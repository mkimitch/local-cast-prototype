import {artifactData, replayTrace} from './replay';
import type {GenerationTrace} from './generationTrace';

const escape = (value: string): string => value.replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]!));
const pre = (value: unknown): string => `<pre>${escape(typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? 'Not captured / not reached')}</pre>`;

export const traceReport = (trace: GenerationTrace): string => {
	const replay = replayTrace(trace);
	const stages = trace.artifacts.filter(item => item.name === 'stage').map(item => item.data);
	const reached = (stage: string): string => stages.includes(stage) ? 'true' : trace.incomplete || trace.status === 'running' ? 'unknown' : 'false';
	return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>LocalCast local generation trace</title><style>body{max-width:1000px;margin:2rem auto;padding:0 1rem;font:16px system-ui;line-height:1.5;color:#17212b;background:#fff}pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:1rem;background:#f1f3f5}summary{cursor:pointer}h2{margin-top:2rem}</style><main>
<h1>LocalCast generation trace</h1><p>Private local diagnostic. Raw evidence can contain personal or licensed content. No scripts, remote resources, or network requests.</p>
<p>Attempt ${escape(trace.id)} · ${escape(trace.createdAt)} · expires ${escape(trace.expiresAt)}</p>
<p>Status: ${escape(trace.status)}. Redacted: ${trace.redacted}. Incomplete: ${trace.incomplete}. A running trace with no outcome may be interrupted; it is not proof of completion.</p>
<h2>Publication gate and observed stages</h2>${pre(artifactData(trace, 'outcome'))}${pre(stages)}
<p>TTS reached: ${reached('rendering_audio')}. Publication entered: ${reached('publishing')}. Publication commit observed: ${reached('published')}. Unrecorded stages in running or incomplete traces are unknown.</p>
<h2>Original generated narration and selected references</h2><p>Original extracted provider output, before canonical IDs and the local disclosure were added. For malformed output, inspect the raw draft response below.</p>${pre(artifactData(trace, 'draft.text'))}
<h2>Frozen source text</h2>${pre(artifactData(trace, 'evidence'))}
<h2>Derived catalog and exact excerpts</h2>${pre(artifactData(trace, 'catalog'))}
<h2>Claims and claimed supporting evidence</h2><p>Canonical claim IDs, text, and excerpts. The provisional supportStatus in transformed sections is not a classifier decision.</p>${pre(artifactData(trace, 'sections'))}
<h2>Original semantic-support result</h2><p>These are the original classifier results. Missing IDs, duplicate IDs, unsupported, and uncertain results fail closed. The current classifier schema does not request explanatory reasons.</p>${pre(artifactData(trace, 'support.parsed'))}${pre(artifactData(trace, 'support.decisions'))}
<h2>Offline deterministic replay</h2><p>Uses this build's parser, reference resolver, membership and length rules. No provider, speech, publication, or production-state access. Semantic support is not recomputed.</p>${pre(replay)}
<h2>Raw artifacts</h2>${trace.artifacts.filter(item => item.form === 'raw').map(item => `<details><summary>${escape(item.name)} — ${escape(item.origin)} — ${item.elapsedMs} ms</summary>${pre(item.data)}</details>`).join('')}
<h2>Parsed, transformed, and derived artifacts</h2>${trace.artifacts.filter(item => item.form !== 'raw').map(item => `<details><summary>${escape(item.name)} (${item.form}) — ${escape(item.origin)} — ${item.elapsedMs} ms</summary>${pre(item.data)}</details>`).join('')}
</main></html>`;
};
