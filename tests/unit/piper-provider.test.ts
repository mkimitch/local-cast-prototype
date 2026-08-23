import {afterEach, describe, expect, it} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PiperSpeechProvider} from '../../server/providers/piper';
import {testConfig} from '../helpers/database';

const roots: string[] = [];
afterEach(() => {
	while (roots.length > 0) fs.rmSync(roots.pop()!, {recursive: true, force: true});
});

const fixture = () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localcast-piper-contract-'));
	roots.push(root);
	const executable = path.join(root, 'piper');
	const model = path.join(root, 'voice.onnx');
	const media = path.join(root, 'media');
	fs.writeFileSync(executable, '#!/bin/sh\ncat > "$4"\n', {mode: 0o700});
	fs.writeFileSync(model, 'synthetic-model', {mode: 0o600});
	fs.mkdirSync(media, {mode: 0o700});
	return {root, executable, model, media};
};

const script = {
	version: 1 as const,
	sections: [{
		id: 'section-piper', title: 'Synthetic audio', type: 'news_summary' as const,
		segments: [{id: 'segment-piper', kind: 'transition' as const, text: 'Synthetic Piper contract narration.', citations: [], supportStatus: 'not_required' as const, speakerRole: 'host' as const}],
	}],
};

describe('Piper speech provider contract', () => {
	it('validates its executable/model, bounds deterministic subprocess output, normalizes MP3, and publishes atomically', async () => {
		const files = fixture();
		const normalizedInputs: string[] = [];
		const provider = new PiperSpeechProvider(testConfig({
			speechProvider: 'piper',
			piperExecutable: files.executable,
			piperModelPath: files.model,
			mediaPath: files.media,
		}), {
			normalize: async (_ffmpeg, input, output) => {
				expect(fs.existsSync(input)).toBe(true);
				normalizedInputs.push(fs.readFileSync(input, 'utf8'));
				fs.writeFileSync(output, Buffer.alloc(2_048, 2), {mode: 0o600});
			},
			probe: async (_ffprobe, filePath) => {
				expect(fs.statSync(filePath).size).toBeGreaterThan(1_000);
				return 1_000;
			},
		});

		const result = await provider.render('run-piper', script, new AbortController().signal);

		expect(normalizedInputs).toEqual(['Synthetic Piper contract narration.']);
		expect(result).toMatchObject({provider: 'Piper', mimeType: 'audio/mpeg', durationMs: 1_000, liveRequestPerformed: true});
		const published = path.join(files.media, result.storageFilename);
		expect(fs.lstatSync(published).isFile()).toBe(true);
		expect(fs.readdirSync(files.media).filter(name => name.includes('.tmp'))).toEqual([]);
	});

	it('fails closed for a symlinked model and caller cancellation without publishing audio', async () => {
		const files = fixture();
		const linkedModel = path.join(files.root, 'linked.onnx');
		fs.symlinkSync(files.model, linkedModel);
		const unsafe = new PiperSpeechProvider(testConfig({
			speechProvider: 'piper', piperExecutable: files.executable, piperModelPath: linkedModel, mediaPath: files.media,
		}));
		await expect(unsafe.render('run-piper-link', script, new AbortController().signal)).rejects.toMatchObject({code: 'PIPER_NOT_CONFIGURED'});

		const cancelled = new AbortController();
		const provider = new PiperSpeechProvider(testConfig({
			speechProvider: 'piper', piperExecutable: files.executable, piperModelPath: files.model, mediaPath: files.media,
		}), {
			runPiper: async (_executable, _model, _text, _destination, signal) => new Promise<void>((_resolve, reject) => {
				signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), {once: true});
			}),
		});
		const rendering = provider.render('run-piper-cancel', script, cancelled.signal);
		cancelled.abort();
		await expect(rendering).rejects.toMatchObject({name: 'AbortError'});
		expect(fs.readdirSync(files.media).filter(name => name.endsWith('.mp3'))).toEqual([]);
	});

	it.each([
		{
			name: 'hung executable',
			source: '#!/bin/sh\nwhile :; do :; done\n',
			expectedCode: 'PIPER_TIMEOUT',
			options: {piperTimeoutMs: 25, outputPollIntervalMs: 5},
		},
		{
			name: 'oversized live output',
			source: '#!/bin/sh\nhead -c 4096 /dev/zero > "$4"\nwhile :; do :; done\n',
			expectedCode: 'PIPER_INVALID_OUTPUT',
			options: {piperTimeoutMs: 1_000, maximumOutputBytes: 1_024, outputPollIntervalMs: 5},
		},
	])('terminates a $name and removes its exact temporary artifacts', async ({source, expectedCode, options}) => {
		const files = fixture();
		fs.writeFileSync(files.executable, source, {mode: 0o700});
		const provider = new PiperSpeechProvider(testConfig({
			speechProvider: 'piper', piperExecutable: files.executable, piperModelPath: files.model, mediaPath: files.media,
		}), options);

		await expect(provider.render(`run-${expectedCode.toLowerCase()}`, script, new AbortController().signal)).rejects.toMatchObject({code: expectedCode});
		expect(fs.readdirSync(files.media)).toEqual([]);
	});
});
