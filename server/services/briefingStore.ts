import type {AudioAsset, BriefingRun, BriefingSection, RunStatus} from '../../src/types';
import type Database from 'better-sqlite3';
import {db} from '../database/index';

const cloneRun = (run: BriefingRun): BriefingRun => ({
	...run,
	sections: run.sections.map(section => ({
		...section,
		followUpPrompts: [...section.followUpPrompts],
		sourceItemIds: [...section.sourceItemIds],
		segments: section.segments?.map(segment => ({
			...segment,
			citations: segment.citations.map(citation => ({...citation})),
		})),
	})),
	audioAsset: run.audioAsset ? {...run.audioAsset} : undefined,
	station: run.station ? {...run.station} : undefined,
	providers: run.providers ? {text: {...run.providers.text}, speech: {...run.providers.speech}} : undefined,
	warnings: run.warnings?.map(warning => ({...warning})),
});

type BriefingRunRow = {
	id: string;
	title: string;
	status: RunStatus;
	created_at: string;
	completed_at: string | null;
	summary: string | null;
	mode: BriefingRun['mode'] | null;
	station_id_snapshot: string | null;
	station_name_snapshot: string | null;
	station_revision: number | null;
	text_provider: string | null;
	text_model: string | null;
	speech_provider: string | null;
	speech_model: string | null;
	speech_voice: string | null;
	ai_generated: number;
	script_format_version: 1 | null;
};

type BriefingSectionRow = {
	id: string;
	title: string;
	type: BriefingSection['type'];
	spoken_text: string;
	source_item_ids_json: string;
	importance_score: number;
	follow_up_prompts_json: string;
};

type AudioAssetRow = {
	id: string;
	url: string;
	duration_ms: number;
	format: string;
	mime_type: string | null;
	byte_length: number | null;
	sha256: string | null;
	validated_at: string | null;
	provider: string | null;
	model: string | null;
	voice: string | null;
	ai_generated: number;
};

type ClaimRow = {
	id: string;
	kind: 'factual' | 'transition';
	text: string;
	support_status: 'supported' | 'not_required';
	speaker_role: 'host';
	speaker_label: string | null;
	voice_profile: string | null;
};

type CitationRow = {
	snapshot_id: string;
	title: string;
	kind: 'note' | 'feed';
	source_name_snapshot: string | null;
	excerpt: string;
	author: string | null;
	original_url: string | null;
	published_at: string | null;
};

const parseStringArray = (value: string): string[] => {
	try {
		const parsed = JSON.parse(value) as unknown;
		return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : [];
	} catch {
		return [];
	}
};

const sectionFromRow = (row: BriefingSectionRow): BriefingSection => ({
	id: row.id,
	title: row.title,
	type: row.type,
	spokenText: row.spoken_text,
	sourceItemIds: parseStringArray(row.source_item_ids_json),
	importanceScore: row.importance_score,
	followUpPrompts: parseStringArray(row.follow_up_prompts_json),
});

const audioAssetFromRow = (row: AudioAssetRow): AudioAsset => ({
	id: row.id,
	url: `/media/${encodeURIComponent(row.id)}`,
	durationMs: row.duration_ms,
	format: row.format,
	mimeType: row.mime_type || undefined,
	byteLength: row.byte_length ?? undefined,
	sha256: row.sha256 || undefined,
	validatedAt: row.validated_at || undefined,
	provider: row.provider || undefined,
	model: row.model || undefined,
	voice: row.voice || undefined,
	aiGenerated: row.ai_generated === 1,
});

export class BriefingStore {
	constructor(private readonly database: Database.Database = db) {}

	listRuns(): BriefingRun[] {
		const rows = this.database.prepare('SELECT * FROM briefing_runs ORDER BY datetime(created_at) DESC').all() as BriefingRunRow[];
		return rows.map(row => cloneRun(this.hydrateRun(row)));
	}

	getRun(id: string): BriefingRun | undefined {
		const row = this.database.prepare('SELECT * FROM briefing_runs WHERE id = ?').get(id) as BriefingRunRow | undefined;
		return row ? cloneRun(this.hydrateRun(row)) : undefined;
	}

	updateRun(id: string, patch: Partial<BriefingRun>): BriefingRun | undefined {
		const current = this.getRun(id);
		if (!current) return undefined;

		const update = this.database.transaction(() => {
			const assignments: string[] = [];
			const values: Record<string, string | null> = {id};

			if (patch.title !== undefined) {
				assignments.push('title = @title');
				values.title = patch.title;
			}

			if (patch.status !== undefined) {
				assignments.push('status = @status');
				values.status = patch.status;
			}

			if (patch.createdAt !== undefined) {
				assignments.push('created_at = @createdAt');
				values.createdAt = patch.createdAt;
			}

			if (patch.completedAt !== undefined) {
				assignments.push('completed_at = @completedAt');
				values.completedAt = patch.completedAt;
			}

			if (patch.summary !== undefined) {
				assignments.push('summary = @summary');
				values.summary = patch.summary;
			}

			if (assignments.length > 0) {
				this.database.prepare(`UPDATE briefing_runs SET ${assignments.join(', ')} WHERE id = @id`).run(values);
			}

			if (patch.sections !== undefined) this.replaceSections(id, patch.sections);
			if (patch.audioAsset !== undefined) this.replaceAudioAsset(id, patch.audioAsset);
		});

		update();
		return this.getRun(id);
	}

	updateStatus(id: string, status: RunStatus): BriefingRun | undefined {
		return this.updateRun(id, {status});
	}

	getRunSourceIds(id: string): string[] {
		const rows = this.database.prepare('SELECT source_id FROM briefing_run_sources WHERE run_id = ? ORDER BY source_id').all(id) as {source_id: string}[];
		return rows.map(row => row.source_id);
	}

	private hydrateRun(row: BriefingRunRow): BriefingRun {
		const sectionRows = this.database.prepare('SELECT * FROM briefing_sections WHERE run_id = ? ORDER BY sort_order ASC').all(row.id) as BriefingSectionRow[];
		const audioRow = this.database.prepare('SELECT * FROM audio_assets WHERE run_id = ?').get(row.id) as AudioAssetRow | undefined;

		return {
			id: row.id,
			title: row.title,
			status: row.status,
			createdAt: row.created_at,
			completedAt: row.completed_at || undefined,
			summary: row.summary || undefined,
			sections: sectionRows.map(section => ({...sectionFromRow(section), segments: this.hydrateSegments(section.id)})),
			audioAsset: audioRow ? audioAssetFromRow(audioRow) : undefined,
			scriptFormatVersion: row.script_format_version === 1 ? 1 : undefined,
			warnings: this.hydrateWarnings(row.id),
			mode: row.mode || undefined,
			station: row.station_id_snapshot && row.station_name_snapshot && row.station_revision
				? {id: row.station_id_snapshot, name: row.station_name_snapshot, revision: row.station_revision}
				: undefined,
			providers: row.text_provider && row.text_model && row.speech_provider && row.speech_model
				? {
					text: {adapter: row.text_provider, model: row.text_model},
					speech: {adapter: row.speech_provider, model: row.speech_model, voice: row.speech_voice || undefined},
				}
				: undefined,
			aiGenerated: row.ai_generated === 1,
		};
	}

	private hydrateSegments(sectionId: string): NonNullable<BriefingSection['segments']> {
		const claims = this.database.prepare('SELECT * FROM transcript_claims WHERE section_id = ? ORDER BY sort_order').all(sectionId) as ClaimRow[];
		return claims.map(claim => {
			const citations = this.database.prepare(`
				SELECT ec.snapshot_id, ec.excerpt, ees.title, ees.kind, ees.source_name_snapshot,
					ees.author, ees.original_url, ees.published_at
				FROM episode_citations ec
				JOIN episode_evidence_snapshots ees ON ees.id = ec.snapshot_id
				WHERE ec.claim_id = ?
				ORDER BY ec.sort_order
			`).all(claim.id) as CitationRow[];
			return {
				id: claim.id,
				kind: claim.kind,
				text: claim.text,
				supportStatus: claim.support_status,
				speakerRole: claim.speaker_role,
				speakerLabel: claim.speaker_label || undefined,
				voiceProfile: claim.voice_profile || undefined,
				citations: citations.map(citation => ({
					snapshotId: citation.snapshot_id,
					title: citation.title,
					sourceName: citation.source_name_snapshot || (citation.kind === 'note' ? 'Pasted note' : 'RSS/Atom source'),
					kind: citation.kind,
					excerpt: citation.excerpt,
					author: citation.author || undefined,
					originalUrl: citation.original_url || undefined,
					publishedAt: citation.published_at || undefined,
				})),
			};
		});
	}

	private hydrateWarnings(runId: string): NonNullable<BriefingRun['warnings']> {
		const rows = this.database.prepare(`
			SELECT grs.source_id_snapshot, grs.source_name_snapshot, grs.sync_error_code, grs.synced_at,
				EXISTS (
					SELECT 1 FROM episode_evidence_snapshots ees
					WHERE ees.run_id = gr.run_id AND ees.source_id_snapshot = grs.source_id_snapshot
				) AS cached_evidence_used
			FROM generation_requests gr
			JOIN generation_request_sources grs ON grs.request_id = gr.id
			WHERE gr.run_id = ? AND grs.sync_status = 'error'
			ORDER BY grs.sort_order
		`).all(runId) as Array<{
			source_id_snapshot: string;
			source_name_snapshot: string | null;
			sync_error_code: string | null;
			synced_at: string | null;
			cached_evidence_used: number;
		}>;
		return rows.map(row => {
			const sourceName = row.source_name_snapshot || 'Selected RSS/Atom source';
			const cachedEvidenceUsed = row.cached_evidence_used === 1;
			return {
				code: row.sync_error_code || 'SOURCE_SYNC_FAILED',
				message: cachedEvidenceUsed
					? `${sourceName} could not be refreshed; this episode used previously stored items.`
					: `${sourceName} could not be refreshed and supplied no material to this episode.`,
				sourceName,
				occurredAt: row.synced_at || undefined,
				cachedEvidenceUsed,
			};
		});
	}

	private replaceSections(runId: string, sections: BriefingSection[]): void {
		this.database.prepare('DELETE FROM briefing_sections WHERE run_id = ?').run(runId);

		const insert = this.database.prepare(`
			INSERT INTO briefing_sections (
				id,
				run_id,
				title,
				type,
				spoken_text,
				source_item_ids_json,
				importance_score,
				follow_up_prompts_json,
				sort_order
			)
			VALUES (@id, @runId, @title, @type, @spokenText, @sourceItemIdsJson, @importanceScore, @followUpPromptsJson, @sortOrder)
		`);

		sections.forEach((section, index) => {
			insert.run({
				id: section.id,
				runId,
				title: section.title,
				type: section.type,
				spokenText: section.spokenText,
				sourceItemIdsJson: JSON.stringify(section.sourceItemIds),
				importanceScore: section.importanceScore,
				followUpPromptsJson: JSON.stringify(section.followUpPrompts),
				sortOrder: index,
			});
		});
	}

	private replaceAudioAsset(runId: string, audioAsset: AudioAsset | undefined): void {
		this.database.prepare('DELETE FROM audio_assets WHERE run_id = ?').run(runId);
		if (!audioAsset) return;

		this.database.prepare(`
			INSERT INTO audio_assets (id, run_id, url, duration_ms, format)
			VALUES (@id, @runId, @url, @durationMs, @format)
		`).run({
			id: audioAsset.id,
			runId,
			url: audioAsset.url,
			durationMs: audioAsset.durationMs,
			format: audioAsset.format,
		});
	}
}

export const briefingStore = new BriefingStore();
