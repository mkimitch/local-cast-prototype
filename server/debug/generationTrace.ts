import fs from 'node:fs';
import path from 'node:path';
import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {GenerationError} from '../jobs/types';

export const traceLimitBytes = 8 * 1024 * 1024;
const traceName = /^trace-[0-9a-f-]{36}\.(json|html)$/;
const armSchema = z.object({stationId: z.string().min(1).max(200), expiresAt: z.number(), retentionHours: z.number().min(1 / 60).max(24)}).strict();
export const traceSchema = z.object({
	version: z.literal(1), id: z.string().uuid(), createdAt: z.iso.datetime(), expiresAt: z.iso.datetime(),
	status: z.enum(['running', 'complete', 'failed']), redacted: z.boolean(), incomplete: z.boolean(),
	artifacts: z.array(z.object({name: z.string(), origin: z.string(), form: z.enum(['raw', 'parsed', 'transformed', 'derived']), at: z.string(), elapsedMs: z.number(), data: z.unknown()})).max(100),
}).strict();
export type GenerationTrace = z.infer<typeof traceSchema>;
type Form = GenerationTrace['artifacts'][number]['form'];

export const traceRootForDatabase = (databasePath: string): string => path.join(path.dirname(path.resolve(databasePath)), '.generation-traces');

export const protectedDirectory = (root: string, create = false): void => {
	if (create && !fs.existsSync(root)) fs.mkdirSync(root, {mode: 0o700});
	const stat = fs.lstatSync(root);
	if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700 || stat.uid !== process.getuid?.() || fs.realpathSync(root) !== path.resolve(root)) throw new Error('Trace directory must be owned, private, and free of symlinks');
};

export const readProtected = (filename: string): string => {
	const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
	try {
		const stat = fs.fstatSync(fd);
		if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600 || stat.uid !== process.getuid?.() || stat.size > traceLimitBytes) throw new Error('Invalid private trace file');
		return fs.readFileSync(fd, 'utf8');
	} finally { fs.closeSync(fd); }
};

const writeAtomic = (filename: string, content: string): void => {
	const temporary = `${filename}.tmp`;
	const fd = fs.openSync(temporary, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
	try { fs.writeFileSync(fd, content); } finally { fs.closeSync(fd); }
	fs.renameSync(temporary, filename);
};

export const purgeTraces = (root: string, all = false, now = Date.now()): number => {
	if (!fs.existsSync(root)) return 0;
	protectedDirectory(root);
	let removed = 0;
	for (const name of fs.readdirSync(root)) {
		if (/^trace-[0-9a-f-]{36}\.html$/.test(name)) {
			const file = path.join(root, name);
			if (!fs.existsSync(file)) continue;
			const capture = file.replace(/\.html$/, '.json');
			if (all || (!fs.existsSync(capture) && fs.lstatSync(file).mtimeMs + 24 * 3600000 <= now)) fs.unlinkSync(file);
			continue;
		}
		if (/^trace-[0-9a-f-]{36}\.(json|html)\.tmp$/.test(name)) {
			const file = path.join(root, name);
			if (fs.existsSync(file) && (all || fs.lstatSync(file).mtimeMs + 24 * 3600000 <= now)) fs.unlinkSync(file);
			continue;
		}
		if (!/^trace-[0-9a-f-]{36}\.json$/.test(name)) continue;
		const file = path.join(root, name);
		let expiresAt = fs.lstatSync(file).mtimeMs + 24 * 3600000;
		try { expiresAt = Date.parse(traceSchema.parse(JSON.parse(readProtected(file))).expiresAt); } catch { /* Damaged capture: bounded fallback retention, never parse unsafe content. */ }
		if (all || expiresAt <= now) {
			for (const suffix of ['', '.tmp']) fs.rmSync(file + suffix, {force: true});
			fs.rmSync(file.replace(/\.json$/, '.html'), {force: true});
			removed += 1;
		}
	}
	const arm = path.join(root, 'armed.json');
	if (fs.existsSync(arm)) {
		let expiresAt = fs.lstatSync(arm).mtimeMs + 3600000;
		try { expiresAt = armSchema.parse(JSON.parse(readProtected(arm))).expiresAt; } catch { /* Damaged arm expires safely. */ }
		if (all || expiresAt <= now) fs.unlinkSync(arm);
	}
	return removed;
};

export const armTrace = (root: string, stationId: string, retentionHours = 24): void => {
	const arm = armSchema.parse({stationId, retentionHours, expiresAt: Date.now() + 60 * 60 * 1000});
	protectedDirectory(root, true);
	purgeTraces(root);
	if (fs.readdirSync(root).filter(name => traceName.test(name) && name.endsWith('.json')).length >= 10) throw new Error('Purge retained traces before arming another');
	fs.writeFileSync(path.join(root, 'armed.json'), JSON.stringify(arm), {mode: 0o600, flag: 'wx'});
};

// Credentials never enter the capture API as headers/configuration objects. Known
// provider secrets and recognizable authentication material in untrusted text
// are additionally removed. Any removal explicitly invalidates exact replay.
const redact = (value: unknown, secrets: string[]): {value: unknown; changed: boolean} => {
	let changed = false;
	const clean = (text: string): string => {
		let next = text;
		for (const secret of secrets.filter(Boolean)) next = next.split(secret).join('[REDACTED]');
		next = next.replace(/\bBearer\s+[^\s"\\]+/gi, 'Bearer [REDACTED]')
			.replace(/\b(Authorization|Proxy-Authorization)\s*:\s*(Basic|Bearer)\s+[^\s"\\]+/gi, '$1: $2 [REDACTED]')
			.replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '[REDACTED]')
			.replace(/([?&](?:token|key|api_key|access_token|authorization)=)[^&#\s"\\]+/gi, '$1[REDACTED]')
			.replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
			.replace(/(\/podcast\/)[^/\s"\\]+/gi, '$1[REDACTED]');
		// Also inspect nested JSON (provider content and serialized request bodies).
		try { const parsed = JSON.parse(next); if (typeof parsed === 'object' && parsed !== null) { const before = changed; const nested = walk(parsed); if (changed !== before || JSON.stringify(nested) !== JSON.stringify(parsed)) next = JSON.stringify(nested); } } catch { /* Plain narration. */ }
		if (next !== text) changed = true;
		return next;
	};
	const walk = (input: unknown): unknown => {
		if (typeof input === 'string') return clean(input);
		if (Array.isArray(input)) return input.map(walk);
		if (input && typeof input === 'object') return Object.fromEntries(Object.entries(input).map(([key, val]) => {
			if (/^(authorization|proxy-authorization|cookie|set-cookie|api[_-]?key|openAiApiKey|password|access[_-]?token|refresh[_-]?token|podcastToken|token)$/i.test(key)) { changed = true; return [key, '[REDACTED]']; }
			return [key, walk(val)];
		}));
		return input;
	};
	const result = walk(value);
	return {value: result, changed};
};

class TraceWriter {
	readonly trace: GenerationTrace;
	private readonly started = performance.now();
	constructor(private readonly file: string, retentionHours: number, private readonly secrets: string[]) {
		this.trace = {version: 1, id: path.basename(file).slice(6, -5), createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + retentionHours * 3600000).toISOString(), status: 'running', redacted: false, incomplete: false, artifacts: []};
	}
	record(name: string, origin: string, form: Form, data: unknown): void {
		try {
			const cleaned = redact(data, this.secrets);
			this.trace.redacted ||= cleaned.changed;
			const artifact = {name, origin, form, at: new Date().toISOString(), elapsedMs: Math.round(performance.now() - this.started), data: cleaned.value};
			if (this.trace.artifacts.length >= 90 || Buffer.byteLength(JSON.stringify(artifact)) > 2 * 1024 * 1024 || Buffer.byteLength(JSON.stringify(this.trace)) + Buffer.byteLength(JSON.stringify(artifact)) > traceLimitBytes - 4096) {
				this.trace.incomplete = true;
				if (this.trace.artifacts.length < 100) this.trace.artifacts.push({...artifact, data: {omitted: 'capture_size_limit'}});
			} else this.trace.artifacts.push(artifact);
			writeAtomic(this.file, JSON.stringify(this.trace));
		} catch { this.trace.incomplete = true; console.error('GENERATION_TRACE_WRITE_FAILED'); }
	}
	finish(error?: unknown): void {
		this.trace.status = error ? 'failed' : 'complete';
		this.record('outcome', 'generation processor', 'derived', error instanceof GenerationError ? {code: error.code, diagnostic: error.diagnostic} : {code: error ? 'GENERATION_FAILED' : 'COMPLETE'});
	}
	gap(name: string, origin: string, reason: string): void {
		this.trace.incomplete = true;
		this.record(name, origin, 'derived', {omitted: reason});
	}
}

const context = new AsyncLocalStorage<TraceWriter>();
export const captureTrace = (name: string, origin: string, form: Form, data: unknown): void => context.getStore()?.record(name, origin, form, data);
export const traceEnabled = (): boolean => Boolean(context.getStore());
export const captureTraceGap = (name: string, origin: string, reason: string): void => context.getStore()?.gap(name, origin, reason);

export const withGenerationTrace = async <T>(root: string, stationId: string, identity: unknown, secrets: string[], work: () => Promise<T>): Promise<T> => {
	let writer: TraceWriter | undefined;
	try {
		if (fs.existsSync(path.join(root, 'armed.json'))) {
			protectedDirectory(root);
			const arm = armSchema.parse(JSON.parse(readProtected(path.join(root, 'armed.json'))));
			if (arm.expiresAt > Date.now() && arm.stationId === stationId) {
				fs.unlinkSync(path.join(root, 'armed.json')); // One attempt, including rejection/interruption; never auto-rearm.
				writer = new TraceWriter(path.join(root, `trace-${randomUUID()}.json`), arm.retentionHours, secrets);
			}
		}
	} catch { console.error('GENERATION_TRACE_UNAVAILABLE'); }
	if (!writer) return work();
	return context.run(writer, async () => {
		writer.record('attempt', 'claimed generation job', 'raw', identity);
		try { const result = await work(); writer.finish(); return result; }
		catch (error) { writer.finish(error); throw error; }
	});
};

let nextSweep = 0;
export const sweepGenerationTraces = (databasePath: string): void => {
	if (Date.now() < nextSweep) return;
	nextSweep = Date.now() + 60_000;
	try { purgeTraces(traceRootForDatabase(databasePath)); } catch { console.error('GENERATION_TRACE_CLEANUP_FAILED'); }
};
