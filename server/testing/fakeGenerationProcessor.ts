import fs from 'node:fs';
import path from 'node:path';
import type {BriefingSection, SourceItem} from '../../src/types';
import type {ServerConfig} from '../config';
import type {GenerationJobStore} from '../jobs/generationJobStore';
import type {GenerationProcessor} from '../jobs/generationProcessor';
import {GenerationError} from '../jobs/types';
import type {GenerationJob} from '../jobs/types';
import {briefingStore} from '../services/briefingStore';
import {sourceStore} from '../services/sourceStore';

const assertNotAborted = (signal: AbortSignal): void => {
	if (signal.aborted) throw new DOMException('Worker stopped', 'AbortError');
};

const wait = (milliseconds: number, signal: AbortSignal): Promise<void> => {
	if (milliseconds === 0) return Promise.resolve();
	return new Promise((resolve, reject) => {
		const complete = () => {
			signal.removeEventListener('abort', abort);
			resolve();
		};
		const timeout = setTimeout(complete, milliseconds);
		const abort = () => {
			clearTimeout(timeout);
			signal.removeEventListener('abort', abort);
			reject(new DOMException('Worker stopped', 'AbortError'));
		};
		signal.addEventListener('abort', abort, {once: true});
	});
};

export const deterministicFakeMp3Bytes = (): Buffer => {
	const bytes = Buffer.alloc(417, 0);
	bytes.set([0xff, 0xfb, 0x90, 0x64], 0);
	return bytes;
};

const fakeSections = (job: GenerationJob, items: SourceItem[]): BriefingSection[] => {
	const citedItems = items.slice(0, 5);
	const titles = citedItems.map(item => item.title).join(', ');
	return [
		{
			id: `section-${job.id}-intro`,
			title: 'Introduction',
			type: 'intro',
			spokenText: 'This deterministic LocalCast fixture verifies the durable generation pipeline.',
			sourceItemIds: [],
			importanceScore: 5,
			followUpPrompts: [],
		},
		{
			id: `section-${job.id}-sources`,
			title: 'Selected source material',
			type: 'news_summary',
			spokenText: `The selected fixture material includes ${titles}.`,
			sourceItemIds: citedItems.map(item => item.id),
			importanceScore: 7,
			followUpPrompts: [],
		},
	];
};

export class DeterministicFakeGenerationProcessor implements GenerationProcessor {
	constructor(
		private readonly config: ServerConfig,
		private readonly jobs: GenerationJobStore,
	) {}

	async process(job: GenerationJob, workerId: string, signal: AbortSignal): Promise<void> {
		await this.atPhase('syncing', signal);

		const selecting = this.jobs.updatePhase(job.id, workerId, 'selecting', this.config.leaseMs);
		await this.atPhase('selecting', signal);
		const sourceItems = sourceStore.listSourceItems({sourceIds: selecting.payload.sourceIds, limit: 25});
		if (sourceItems.length === 0) {
			throw new GenerationError('INSUFFICIENT_SOURCE_MATERIAL', 'No stored source material is available for this test job', false);
		}

		this.jobs.updatePhase(job.id, workerId, 'drafting', this.config.leaseMs);
		await this.atPhase('drafting', signal);
		const sections = fakeSections(job, sourceItems);
		const summary = `Deterministic test summary from ${sourceItems.length} stored source item${sourceItems.length === 1 ? '' : 's'}.`;

		this.jobs.updatePhase(job.id, workerId, 'validating', this.config.leaseMs);
		await this.atPhase('validating', signal);
		const availableIds = new Set(sourceItems.map(item => item.id));
		if (sections.some(section => section.sourceItemIds.some(id => !availableIds.has(id)))) {
			throw new GenerationError('INVALID_FAKE_CITATION', 'Deterministic test output contained an invalid source reference', false);
		}

		this.jobs.updatePhase(job.id, workerId, 'rendering_audio', this.config.leaseMs);
		await this.atPhase('rendering_audio', signal);
		this.jobs.renewLease(job.id, workerId, this.config.leaseMs);
		const audioId = `audio-${job.id}`;
		const fileName = `${audioId}.mp3`;
		const destination = path.join(this.config.mediaPath, fileName);
		const temporary = `${destination}.${process.pid}.tmp`;
		fs.writeFileSync(temporary, deterministicFakeMp3Bytes(), {flag: 'w', mode: 0o640});
		fs.renameSync(temporary, destination);

		briefingStore.updateRun(job.runId, {
			summary,
			sections,
			audioAsset: {id: audioId, url: `/media/${fileName}`, durationMs: 26, format: 'mp3'},
		});
		await wait(this.config.fakeAfterPublicationDelayMs, signal);
		assertNotAborted(signal);
		this.jobs.complete(job.id, workerId);
	}

	private async atPhase(phase: ServerConfig['fakeFailurePhase'], signal: AbortSignal): Promise<void> {
		if (this.config.fakeFailurePhase === phase) {
			throw new Error('secret-canary source-canary provider-body-canary /private/path-canary');
		}
		assertNotAborted(signal);
		const delay = !this.config.fakeDelayPhase || this.config.fakeDelayPhase === phase ? this.config.fakePhaseDelayMs : 0;
		await wait(delay, signal);
		assertNotAborted(signal);
	}
}
