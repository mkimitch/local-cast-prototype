import {createHash, randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import type {ServerConfig} from '../config';
import type {GeneratedEpisodeScript, PublishedAudio} from '../episodes/types';
import {GenerationError} from '../jobs/types';
import {concatenateMp3WithFfmpeg, splitScriptForSpeech, validateMp3WithFfprobe} from './openai';

const execFileAsync = promisify(execFile);
const maximumPiperOutputBytes = 64 * 1024 * 1024;
const subprocessEnvironment = {
	PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
	LC_ALL: 'C',
} as const;

const providerFailure = (code: string, safeMessage: string, retryable: boolean): GenerationError => (
	new GenerationError(code, safeMessage, retryable, 'failure')
);

export interface PiperProviderOptions {
	runPiper?: (executable: string, modelPath: string, text: string, destination: string, signal: AbortSignal) => Promise<void>;
	normalize?: (ffmpegPath: string, input: string, output: string, signal: AbortSignal) => Promise<void>;
	probe?: (ffprobePath: string, filePath: string, signal?: AbortSignal) => Promise<number>;
	concatenate?: (ffmpegPath: string, inputs: string[], output: string, signal?: AbortSignal) => Promise<void>;
	piperTimeoutMs?: number;
	maximumOutputBytes?: number;
	outputPollIntervalMs?: number;
}

const assertRegularFile = (filePath: string, label: string, executable = false): void => {
	let stat: fs.Stats;
	try {
		stat = fs.lstatSync(filePath);
	} catch {
		throw providerFailure('PIPER_NOT_CONFIGURED', `The configured Piper ${label} is unavailable`, false);
	}
	if (!stat.isFile() || stat.isSymbolicLink() || (executable && (stat.mode & 0o111) === 0)) {
		throw providerFailure('PIPER_NOT_CONFIGURED', `The configured Piper ${label} is unsafe`, false);
	}
};

export const assertPiperConfiguration = (executable: string, modelPath: string): void => {
	assertRegularFile(executable, 'executable', true);
	assertRegularFile(modelPath, 'model');
};

const runPiperProcess = async (executable: string, modelPath: string, text: string, destination: string, signal: AbortSignal): Promise<void> => {
	if (signal.aborted) throw new DOMException('Worker stopped', 'AbortError');
	await new Promise<void>((resolve, reject) => {
		const child = spawn(executable, ['--model', modelPath, '--output_file', destination], {
			cwd: path.dirname(destination),
			env: subprocessEnvironment,
			stdio: ['pipe', 'ignore', 'pipe'],
			signal,
		});
		let stderr = '';
		child.stderr.setEncoding('utf8');
		child.stderr.on('data', chunk => {
			if (stderr.length < 8_192) stderr += chunk;
		});
		child.once('error', error => reject(error));
		child.once('exit', code => {
			if (code === 0) resolve();
			else reject(new Error(`Piper exited ${code ?? 'unknown'}`));
		});
		child.stdin.end(text);
	});
};

const assertBoundedPiperOutput = (destination: string, maximumBytes: number): void => {
	let stat: fs.Stats;
	try {
		stat = fs.lstatSync(destination);
	} catch {
		throw providerFailure('PIPER_INVALID_OUTPUT', 'The configured Piper provider produced invalid audio output', true);
	}
	if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size <= 0 || stat.size > maximumBytes) {
		throw providerFailure('PIPER_INVALID_OUTPUT', 'The configured Piper provider produced invalid audio output', true);
	}
};

const describeBoundedFile = (filePath: string): {byteLength: number; sha256: string; modifiedAt: Date} => {
	let fd: number | undefined;
	try {
		fd = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
		const stat = fs.fstatSync(fd);
		if (!stat.isFile() || stat.nlink !== 1 || stat.size <= 0 || stat.size > maximumPiperOutputBytes) {
			throw new Error('unsafe output metadata');
		}
		const hash = createHash('sha256');
		const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, stat.size));
		let position = 0;
		while (position < stat.size) {
			const read = fs.readSync(fd, buffer, 0, Math.min(buffer.byteLength, stat.size - position), position);
			if (read <= 0) throw new Error('short output read');
			hash.update(buffer.subarray(0, read));
			position += read;
		}
		return {byteLength: stat.size, sha256: hash.digest('hex'), modifiedAt: stat.mtime};
	} catch {
		throw new GenerationError('PIPER_INVALID_OUTPUT', 'The configured Piper provider produced unsafe audio output', true);
	} finally {
		if (fd !== undefined) fs.closeSync(fd);
	}
};

const runBoundedPiper = async (
	runner: NonNullable<PiperProviderOptions['runPiper']>,
	executable: string,
	modelPath: string,
	text: string,
	destination: string,
	externalSignal: AbortSignal,
	timeoutMs: number,
	maximumBytes: number,
	pollIntervalMs: number,
): Promise<void> => {
	if (externalSignal.aborted) throw new DOMException('Worker stopped', 'AbortError');
	const controller = new AbortController();
	let timedOut = false;
	let invalidOutput = false;
	let rejectBoundary: ((reason: unknown) => void) | undefined;
	const boundary = new Promise<never>((_resolve, reject) => { rejectBoundary = reject; });
	const abortFor = (reason: 'external' | 'timeout' | 'output'): void => {
		if (controller.signal.aborted) return;
		timedOut = reason === 'timeout';
		invalidOutput = reason === 'output';
		controller.abort();
		rejectBoundary?.(new DOMException('Piper execution stopped', 'AbortError'));
	};
	const onExternalAbort = (): void => abortFor('external');
	externalSignal.addEventListener('abort', onExternalAbort, {once: true});
	const timeout = setTimeout(() => abortFor('timeout'), timeoutMs);
	const outputMonitor = setInterval(() => {
		if (!fs.existsSync(destination)) return;
		try {
			const stat = fs.lstatSync(destination);
			if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > maximumBytes) abortFor('output');
		} catch {
			abortFor('output');
		}
	}, pollIntervalMs);

	try {
		await Promise.race([runner(executable, modelPath, text, destination, controller.signal), boundary]);
		assertBoundedPiperOutput(destination, maximumBytes);
	} catch (error) {
		if (externalSignal.aborted) throw new DOMException('Worker stopped', 'AbortError');
		if (timedOut) throw providerFailure('PIPER_TIMEOUT', 'The configured Piper provider timed out', true);
		if (invalidOutput) throw providerFailure('PIPER_INVALID_OUTPUT', 'The configured Piper provider exceeded its output boundary', true);
		throw error;
	} finally {
		clearTimeout(timeout);
		clearInterval(outputMonitor);
		externalSignal.removeEventListener('abort', onExternalAbort);
	}
};

const normalizeWav = async (ffmpegPath: string, input: string, output: string, signal: AbortSignal): Promise<void> => {
	try {
		await execFileAsync(ffmpegPath, [
			'-v', 'error', '-nostdin', '-i', input,
			'-codec:a', 'libmp3lame', '-q:a', '3', '-f', 'mp3', output,
		], {timeout: 120_000, maxBuffer: 32 * 1024, env: subprocessEnvironment, signal});
	} catch {
		if (signal.aborted) throw new DOMException('Worker stopped', 'AbortError');
		throw new GenerationError('PIPER_NORMALIZATION_FAILED', 'The Piper audio output could not be normalized safely', true);
	}
};

const compatibilityScript = (narration: string): GeneratedEpisodeScript => ({
	version: 1,
	sections: [{
		id: 'compatibility-section', title: 'Narration', type: 'news_summary',
		segments: narration.split(/\n\n+/).filter(Boolean).map((text, index) => ({
			id: `compatibility-segment-${index}`, kind: 'transition', text, citations: [], supportStatus: 'not_required', speakerRole: 'host',
		})),
	}],
});

export class PiperSpeechProvider {
	constructor(
		private readonly config: Pick<ServerConfig, 'piperExecutable' | 'piperModelPath' | 'mediaPath' | 'ffprobePath' | 'ffmpegPath'>,
		private readonly options: PiperProviderOptions = {},
	) {}

	async render(
		runId: string,
		input: GeneratedEpisodeScript | string,
		signal: AbortSignal,
		fencePublication: () => void = () => undefined,
	): Promise<PublishedAudio> {
		if (!this.config.piperExecutable || !this.config.piperModelPath) {
			throw providerFailure('PIPER_NOT_CONFIGURED', 'Piper executable and model paths are required', false);
		}
		assertPiperConfiguration(this.config.piperExecutable, this.config.piperModelPath);
		const script = typeof input === 'string' ? compatibilityScript(input) : input;
		const chunks = splitScriptForSpeech(script);
		const renderingHash = createHash('sha256').update(JSON.stringify({script, model: this.config.piperModelPath, format: 'mp3'})).digest('hex');
		const storageFilename = `episode-${runId}-${renderingHash.slice(0, 16)}.mp3`;
		const destination = path.join(this.config.mediaPath, storageFilename);
		const assetId = `audio-${runId}`;
		const probe = this.options.probe || validateMp3WithFfprobe;
		const concatenate = this.options.concatenate || concatenateMp3WithFfmpeg;
		const piperTimeoutMs = this.options.piperTimeoutMs ?? 120_000;
		const maximumOutputBytes = this.options.maximumOutputBytes ?? maximumPiperOutputBytes;
		const outputPollIntervalMs = this.options.outputPollIntervalMs ?? 25;
		fs.mkdirSync(this.config.mediaPath, {recursive: true, mode: 0o750});
		if (fs.existsSync(destination)) return this.describe(assetId, storageFilename, destination, await probe(this.config.ffprobePath, destination, signal), false);

		const operationId = randomUUID();
		const mp3Parts: string[] = [];
		const temporaryFiles: string[] = [];
		let combined: string | undefined;
		try {
			for (const [index, chunk] of chunks.entries()) {
				const wav = path.join(this.config.mediaPath, `.${storageFilename}.${operationId}.${index}.wav.tmp`);
				const mp3 = path.join(this.config.mediaPath, `.${storageFilename}.${operationId}.${index}.mp3.tmp`);
				temporaryFiles.push(wav, mp3);
				await runBoundedPiper(
					this.options.runPiper || runPiperProcess,
					this.config.piperExecutable,
					this.config.piperModelPath,
					chunk,
					wav,
					signal,
					piperTimeoutMs,
					maximumOutputBytes,
					outputPollIntervalMs,
				);
				await (this.options.normalize || normalizeWav)(this.config.ffmpegPath, wav, mp3, signal);
				try { fs.unlinkSync(wav); } catch { /* only the unique temporary file is removed */ }
				await probe(this.config.ffprobePath, mp3, signal);
				mp3Parts.push(mp3);
			}
			combined = path.join(this.config.mediaPath, `.${storageFilename}.${operationId}.tmp`);
			temporaryFiles.push(combined);
			if (mp3Parts.length === 1) {
				fs.renameSync(mp3Parts[0]!, combined);
				mp3Parts.length = 0;
			} else {
				await concatenate(this.config.ffmpegPath, mp3Parts, combined, signal);
			}
			const durationMs = await probe(this.config.ffprobePath, combined, signal);
			if (signal.aborted) throw new DOMException('Worker stopped', 'AbortError');
			fencePublication();
			if (signal.aborted) throw new DOMException('Worker stopped', 'AbortError');
			fs.renameSync(combined, destination);
			combined = undefined;
			return this.describe(assetId, storageFilename, destination, durationMs, true);
		} catch (error) {
			if (error instanceof GenerationError) throw error;
			if (signal.aborted || error instanceof DOMException && error.name === 'AbortError') throw new DOMException('Worker stopped', 'AbortError');
			throw providerFailure('PIPER_RENDER_FAILED', 'The configured Piper provider could not render audio safely', true);
		} finally {
			for (const temporary of temporaryFiles) {
				try { fs.unlinkSync(temporary); } catch { /* only unique temporary files are removed */ }
			}
		}
	}

	private describe(assetId: string, storageFilename: string, filePath: string, durationMs: number, liveRequestPerformed: boolean): PublishedAudio {
		const file = describeBoundedFile(filePath);
		return {
			id: assetId,
			storageFilename,
			durationMs,
			byteLength: file.byteLength,
			sha256: file.sha256,
			mimeType: 'audio/mpeg',
			validatedAt: file.modifiedAt.toISOString(),
			provider: 'Piper',
			model: path.basename(this.config.piperModelPath || 'piper'),
			voice: 'configured Piper model',
			liveRequestPerformed,
		};
	}
}
