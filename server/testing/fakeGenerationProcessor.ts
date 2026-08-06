import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import type {BriefingSection, SourceItem} from '../../src/types';
import type {ServerConfig} from '../config';
import type {EpisodeEvidence, GeneratedSection, PublishedAudio} from '../episodes/types';
import type {GenerationJobStore} from '../jobs/generationJobStore';
import type {GenerationProcessor} from '../jobs/generationProcessor';
import {GenerationError} from '../jobs/types';
import type {GenerationJob} from '../jobs/types';
import {briefingStore} from '../services/briefingStore';
import {episodeStore} from '../services/episodeStore';
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

const deterministicFakeMp3 = 'SUQzBAAAAAAAIlRTU0UAAAAOAAADTGF2ZjYyLjMuMTAwAAAAAAAAAAAAAAD/84TAAAAAAAAAAAAASW5mbwAAAA8AAAAXAAAJYAAeHh4eKCgoKDMzMzMzPT09PUdHR0dRUVFRUVxcXFxmZmZmcHBwcHB6enp6hYWFhY+Pj4+PmZmZmaOjo6Ourq6urri4uLjCwsLCzMzMzMzX19fX4eHh4evr6+vr9fX19f////8AAAAATGF2YzYyLjExAAAAAAAAAAAAAAAAJAKgAAAAAAAACWANTP/jAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/80TEAAAAA0gAAAAATEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy7/80TEUwAAA0gAAAAAMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy7/80TEpgAAA0gAAAAAMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy7/80TErAAAA0gAAAAAMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy7/80TErAAAA0gAAAAAMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy7/80TErAAAA0gAAAAAMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy7/80TErAAAA0gAAAAAMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy7/80TErAAAA0gAAAAAMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy7/80TErAAAA0gAAAAAMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy7/80TErAAAA0gAAAAAMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy7/80TErAAAA0gAAAAAMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy7/80TErAAAA0gAAAAAMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy7/80TErAAAA0gAAAAAMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy7/80TErAAAA0gAAAAAMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy7/80TErAAAA0gAAAAAMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy7/80TErAAAA0gAAAAAMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy7/80TErAAAA0gAAAAAMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy7/80TErAAAA0gAAAAAMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy7/80TErAAAA0gAAAAAMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy7/80TErAAAA0gAAAAAMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy7/80TErAAAA0gAAAAAMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80TErAAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80TErAAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVU=';

export const deterministicFakeMp3Bytes = (): Buffer => Buffer.from(deterministicFakeMp3, 'base64');

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

const exactOpeningExcerpt = (body: string): string => {
	const sentenceEnd = body.indexOf('.');
	return body.slice(0, sentenceEnd >= 4 && sentenceEnd < 320 ? sentenceEnd + 1 : Math.min(body.length, 320)).trimEnd();
};

const fakeGeneratedSections = (job: GenerationJob, evidence: EpisodeEvidence[]): GeneratedSection[] => [
	{
		id: `section-${job.id}-disclosure`,
		title: 'AI audio disclosure',
		type: 'intro',
		segments: [{
			id: `claim-${job.id}-disclosure`,
			kind: 'transition',
			text: 'This LocalCast audio was generated by AI.',
			citations: [],
			supportStatus: 'not_required',
		}],
	},
	{
		id: `section-${job.id}-sources`,
		title: 'Source summary',
		type: 'news_summary',
		segments: evidence.slice(0, 5).map((item, index) => {
			const excerpt = exactOpeningExcerpt(item.body);
			return {
				id: `claim-${job.id}-source-${index}`,
				kind: 'factual' as const,
				text: excerpt,
				citations: [{snapshotId: item.id, excerpt}],
				supportStatus: 'supported' as const,
			};
		}),
	},
];

export class DeterministicFakeGenerationProcessor implements GenerationProcessor {
	constructor(
		private readonly config: ServerConfig,
		private readonly jobs: GenerationJobStore,
	) {}

	async process(job: GenerationJob, workerId: string, signal: AbortSignal): Promise<void> {
		await this.atPhase('syncing', signal);

		const selecting = this.jobs.updatePhase(job.id, workerId, 'selecting', this.config.leaseMs);
		await this.atPhase('selecting', signal);
		const evidence = selecting.payload.version === 2
			? episodeStore.finalizeEvidence(selecting.payload.requestId, job.runId)
			: undefined;
		const sourceItems: SourceItem[] = selecting.payload.version === 1
			? sourceStore.listSourceItems({sourceIds: selecting.payload.sourceIds, limit: 25})
			: evidence!.map(item => ({
				id: item.id,
				sourceId: item.kind,
				title: item.title,
				content: item.body,
				url: item.originalUrl,
				author: item.author,
				publishedAt: item.publishedAt,
				gatheredAt: selecting.payload.requestedAt,
			}));
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
		const audioId = selecting.payload.version === 2 ? `audio-${job.runId}` : `audio-${job.id}`;
		const fileName = `${audioId}.mp3`;
		const destination = path.join(this.config.mediaPath, fileName);
		const temporary = `${destination}.${randomUUID()}.tmp`;
		const bytes = deterministicFakeMp3Bytes();
		if (!fs.existsSync(destination)) {
			fs.writeFileSync(temporary, bytes, {flag: 'wx', mode: 0o640});
			fs.renameSync(temporary, destination);
		}

		if (selecting.payload.version === 2) {
			const request = episodeStore.getRequest(selecting.payload.requestId);
			if (!request || !evidence) throw new GenerationError('INVALID_JOB_PAYLOAD', 'The deterministic test request is invalid', false);
			const audio: PublishedAudio = {
				id: audioId,
				storageFilename: fileName,
				durationMs: 500,
				byteLength: bytes.byteLength,
				sha256: createHash('sha256').update(bytes).digest('hex'),
				mimeType: 'audio/mpeg',
				validatedAt: fs.statSync(destination).mtime.toISOString(),
				provider: 'Deterministic test speech',
				model: 'fixture-mp3-v1',
				voice: 'fixture-silence',
			};
			this.jobs.complete(job.id, workerId, () => episodeStore.publishEpisode({
				runId: job.runId,
				request,
				sections: fakeGeneratedSections(job, evidence),
				audio,
				textProvider: 'Deterministic test text',
				textModel: 'fixture-text-v1',
			}));
			return;
		}

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
