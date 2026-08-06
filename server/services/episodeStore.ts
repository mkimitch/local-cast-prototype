import type Database from 'better-sqlite3';
import {createHash} from 'node:crypto';
import {db} from '../database/index';
import {GenerationError} from '../jobs/types';
import type {EpisodeEvidence, EpisodeRequestSnapshot, GeneratedSection, PublishedAudio} from '../episodes/types';

type RequestRow = {
	id: string;
	run_id: string;
	station_id_snapshot: string;
	station_revision: number;
	station_name: string;
	topic_instruction: string;
	requested_mode: EpisodeRequestSnapshot['mode'];
	request_hash: string;
	requested_at: string;
};

type EvidenceRow = {
	id: string;
	kind: EpisodeEvidence['kind'];
	title: string;
	body: string;
	author: string | null;
	original_url: string | null;
	published_at: string | null;
	content_sha256: string;
};

const contentHash = (value: string): string => createHash('sha256').update(value).digest('hex');

const evidenceFromRow = (row: EvidenceRow): EpisodeEvidence => ({
	id: row.id,
	kind: row.kind,
	title: row.title,
	body: row.body,
	author: row.author || undefined,
	originalUrl: row.original_url || undefined,
	publishedAt: row.published_at || undefined,
	contentSha256: row.content_sha256,
});

export class EpisodeStore {
	constructor(private readonly database: Database.Database = db) {}

	getRequest(requestId: string): EpisodeRequestSnapshot | undefined {
		const row = this.database.prepare('SELECT * FROM generation_requests WHERE id = ?').get(requestId) as RequestRow | undefined;
		if (!row) return undefined;
		return {
			id: row.id,
			runId: row.run_id,
			stationId: row.station_id_snapshot,
			stationRevision: row.station_revision,
			stationName: row.station_name,
			topicInstruction: row.topic_instruction,
			mode: row.requested_mode,
			requestHash: row.request_hash,
			requestedAt: row.requested_at,
		};
	}

	finalizeEvidence(requestId: string, runId: string): EpisodeEvidence[] {
		const finalize = this.database.transaction(() => {
			const request = this.getRequest(requestId);
			if (!request || request.runId !== runId) throw new GenerationError('INVALID_JOB_PAYLOAD', 'The persisted generation request is invalid', false);

			const existing = this.listEvidence(runId);
			if (existing.length > 0) return existing;

			const insert = this.database.prepare(`
				INSERT INTO episode_evidence_snapshots (
					id, run_id, request_id, kind, original_id_snapshot, title, body,
					author, original_url, published_at, content_sha256, sort_order
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`);
			let order = 0;
			const notes = this.database.prepare('SELECT * FROM generation_request_notes WHERE request_id = ? ORDER BY sort_order').all(requestId) as Array<{
				note_id_snapshot: string;
				title: string;
				body: string;
				author: string | null;
				original_url: string | null;
			}>;
			for (const note of notes) {
				const id = `snapshot-${runId}-note-${order}`;
				insert.run(id, runId, requestId, 'note', note.note_id_snapshot, note.title, note.body, note.author, note.original_url, null, contentHash(note.body), order++);
			}

			const feedItems = this.database.prepare(`
				SELECT si.*
				FROM generation_request_sources grs
				JOIN source_items si ON si.source_id = grs.source_id_snapshot
				WHERE grs.request_id = ?
				ORDER BY grs.sort_order, datetime(COALESCE(si.published_at, si.gathered_at)) DESC, si.id
				LIMIT 50
			`).all(requestId) as Array<{
				id: string;
				title: string;
				content: string;
				author: string | null;
				url: string | null;
				published_at: string | null;
			}>;
			for (const item of feedItems) {
				const id = `snapshot-${runId}-feed-${order}`;
				insert.run(id, runId, requestId, 'feed', item.id, item.title, item.content, item.author, item.url, item.published_at, contentHash(item.content), order++);
			}

			const evidence = this.listEvidence(runId);
			const combined = evidence.map(item => item.body).join(' ').replace(/\s+/g, ' ').trim();
			const words = combined ? combined.split(' ').length : 0;
			if (combined.length < 200 || words < 40) {
				throw new GenerationError('INSUFFICIENT_SOURCE_MATERIAL', 'The selected supplied material is too limited for a factual episode', false);
			}
			return evidence;
		});

		return finalize.immediate();
	}

	listEvidence(runId: string): EpisodeEvidence[] {
		const rows = this.database.prepare('SELECT * FROM episode_evidence_snapshots WHERE run_id = ? ORDER BY sort_order').all(runId) as EvidenceRow[];
		return rows.map(evidenceFromRow);
	}

	publishEpisode(input: {
		runId: string;
		request: EpisodeRequestSnapshot;
		sections: GeneratedSection[];
		audio: PublishedAudio;
		textProvider: 'OpenAI' | 'Deterministic test text';
		textModel: string;
	}): void {
		const evidenceIds = new Set(this.listEvidence(input.runId).map(item => item.id));
		if (evidenceIds.size === 0) throw new Error('Cannot publish an episode without immutable evidence');

		this.database.prepare('DELETE FROM briefing_sections WHERE run_id = ?').run(input.runId);
		const insertSection = this.database.prepare(`
			INSERT INTO briefing_sections (
				id, run_id, title, type, spoken_text, source_item_ids_json,
				importance_score, follow_up_prompts_json, sort_order
			) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?)
		`);
		const insertClaim = this.database.prepare(`
			INSERT INTO transcript_claims (id, run_id, section_id, kind, text, support_status, sort_order)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`);
		const insertCitation = this.database.prepare(`
			INSERT INTO episode_citations (claim_id, snapshot_id, excerpt, sort_order)
			VALUES (?, ?, ?, ?)
		`);

		let claimCount = 0;
		input.sections.forEach((section, sectionIndex) => {
			const sourceIds = [...new Set(section.segments.flatMap(segment => segment.citations.map(citation => citation.snapshotId)))];
			if (sourceIds.some(id => !evidenceIds.has(id))) throw new Error('Cannot publish an unknown evidence citation');
			insertSection.run(
				section.id,
				input.runId,
				section.title,
				section.type,
				section.segments.map(segment => segment.text).join(' '),
				JSON.stringify(sourceIds),
				5,
				sectionIndex,
			);
			section.segments.forEach((segment, segmentIndex) => {
				insertClaim.run(segment.id, input.runId, section.id, segment.kind, segment.text, segment.supportStatus, segmentIndex);
				segment.citations.forEach((citation, citationIndex) => insertCitation.run(segment.id, citation.snapshotId, citation.excerpt, citationIndex));
				if (segment.kind === 'factual') claimCount += 1;
			});
		});

		this.database.prepare(`
			INSERT INTO audio_assets (
				id, run_id, url, duration_ms, format, storage_filename, mime_type,
				byte_length, sha256, validated_at, provider, model, voice, ai_generated
			) VALUES (?, ?, ?, ?, 'mp3', ?, ?, ?, ?, ?, ?, ?, ?, 1)
			ON CONFLICT(run_id) DO UPDATE SET
				id = excluded.id,
				url = excluded.url,
				duration_ms = excluded.duration_ms,
				format = excluded.format,
				storage_filename = excluded.storage_filename,
				mime_type = excluded.mime_type,
				byte_length = excluded.byte_length,
				sha256 = excluded.sha256,
				validated_at = excluded.validated_at,
				provider = excluded.provider,
				model = excluded.model,
				voice = excluded.voice,
				ai_generated = 1
		`).run(
			input.audio.id,
			input.runId,
			`/media/${input.audio.id}`,
			input.audio.durationMs,
			input.audio.storageFilename,
			input.audio.mimeType,
			input.audio.byteLength,
			input.audio.sha256,
			input.audio.validatedAt,
			input.audio.provider,
			input.audio.model,
			input.audio.voice,
		);

		this.database.prepare(`
			UPDATE briefing_runs
			SET summary = ?, mode = ?, station_id_snapshot = ?, station_name_snapshot = ?, station_revision = ?,
				text_provider = ?, text_model = ?, speech_provider = ?, speech_model = ?,
				speech_voice = ?, ai_generated = 1
			WHERE id = ?
		`).run(
			`${claimCount} validated factual claim${claimCount === 1 ? '' : 's'} from supplied material.`,
			input.request.mode,
			input.request.stationId,
			input.request.stationName,
			input.request.stationRevision,
			input.textProvider,
			input.textModel,
			input.audio.provider,
			input.audio.model,
			input.audio.voice,
			input.runId,
		);
	}

	getPublishedMedia(assetId: string): {storageFilename: string; byteLength: number; mimeType: string; sha256: string} | undefined {
		return this.database.prepare(`
			SELECT aa.storage_filename AS storageFilename, aa.byte_length AS byteLength,
				aa.mime_type AS mimeType, aa.sha256
			FROM audio_assets aa
			JOIN briefing_runs br ON br.id = aa.run_id
			WHERE aa.id = ? AND br.status = 'complete' AND aa.storage_filename IS NOT NULL
		`).get(assetId) as {storageFilename: string; byteLength: number; mimeType: string; sha256: string} | undefined;
	}
}

export const episodeStore = new EpisodeStore();
