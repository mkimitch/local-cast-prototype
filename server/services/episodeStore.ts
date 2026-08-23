import type Database from 'better-sqlite3';
import {createHash} from 'node:crypto';
import {db} from '../database/index';
import {GenerationError} from '../jobs/types';
import {hasEmbeddedUrlCredential} from './safeFeedFetcher';
import type {EpisodeEvidence, EpisodeRequestSnapshot, EpisodeRequestSource, GeneratedSection, PublishedAudio} from '../episodes/types';
import {assertEvidenceSufficient} from '../episodes/modePolicy';
import {assertGeneratedEpisode} from '../episodes/validation';
import {publishedEpisodePredicate} from '../episodes/publication';

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
	source_id_snapshot: string | null;
	source_name_snapshot: string | null;
	network_scope: EpisodeEvidence['networkScope'];
};

export interface PublishedMediaRecord {
	assetId: string;
	runId: string;
	storageFilename: string;
	byteLength: number;
	mimeType: string;
	sha256: string;
	validatedAt: string;
}

const contentHash = (value: string): string => createHash('sha256').update(value).digest('hex');

export const episodeEvidenceLimits = {
	maxItems: 50,
	maxAggregateCharacters: 120_000,
} as const;

const safeEvidenceUrl = (value: string | null): string | null => {
	if (!value) return null;
	try {
		const url = new URL(value);
		return (url.protocol === 'http:' || url.protocol === 'https:') && !hasEmbeddedUrlCredential(url) ? url.href : null;
	} catch {
		return null;
	}
};

const evidenceCharacterCost = (input: {title: string; body: string; author: string | null; originalUrl: string | null}): number => (
	input.title.length + input.body.length + (input.author?.length || 0) + (input.originalUrl?.length || 0)
);

const evidenceFromRow = (row: EvidenceRow): EpisodeEvidence => ({
	id: row.id,
	kind: row.kind,
	title: row.title,
	body: row.body,
	author: row.author || undefined,
	originalUrl: row.original_url || undefined,
	publishedAt: row.published_at || undefined,
	contentSha256: row.content_sha256,
	sourceId: row.source_id_snapshot || undefined,
	sourceName: row.source_name_snapshot || undefined,
	networkScope: row.network_scope,
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

	listRequestSources(requestId: string): EpisodeRequestSource[] {
		const rows = this.database.prepare(`
			SELECT source_id_snapshot, source_name_snapshot, source_url_snapshot,
				network_scope_snapshot, sort_order, sync_status, sync_error_code, synced_at
			FROM generation_request_sources
			WHERE request_id = ?
			ORDER BY sort_order
		`).all(requestId) as Array<{
			source_id_snapshot: string;
			source_name_snapshot: string | null;
			source_url_snapshot: string | null;
			network_scope_snapshot: EpisodeRequestSource['networkScope'];
			sort_order: number;
			sync_status: EpisodeRequestSource['syncStatus'];
			sync_error_code: string | null;
			synced_at: string | null;
		}>;
		return rows.flatMap(row => row.source_name_snapshot && row.source_url_snapshot ? [{
			sourceId: row.source_id_snapshot,
			sourceName: row.source_name_snapshot,
			sourceUrl: row.source_url_snapshot,
			networkScope: row.network_scope_snapshot,
			sortOrder: row.sort_order,
			syncStatus: row.sync_status,
			syncErrorCode: row.sync_error_code || undefined,
			syncedAt: row.synced_at || undefined,
		}] : []);
	}

	recordRequestSourceSync(requestId: string, sourceId: string, input: {
		status: EpisodeRequestSource['syncStatus'];
		errorCode?: string;
		syncedAt: string;
		networkScope?: EpisodeRequestSource['networkScope'];
	}): void {
		this.database.prepare(`
			UPDATE generation_request_sources
			SET sync_status = ?, sync_error_code = ?, synced_at = ?,
				network_scope_snapshot = COALESCE(?, network_scope_snapshot)
			WHERE request_id = ? AND source_id_snapshot = ?
		`).run(input.status, input.errorCode ?? null, input.syncedAt, input.networkScope ?? null, requestId, sourceId);
	}

	finalizeEvidence(requestId: string, runId: string): EpisodeEvidence[] {
		const finalize = this.database.transaction(() => {
			const request = this.getRequest(requestId);
			if (!request || request.runId !== runId) throw new GenerationError('INVALID_JOB_PAYLOAD', 'The persisted generation request is invalid', false);

			const existing = this.listEvidence(runId);
			if (existing.length > 0) {
				assertEvidenceSufficient(request.mode, existing);
				return existing;
			}

			const insert = this.database.prepare(`
				INSERT INTO episode_evidence_snapshots (
					id, run_id, request_id, kind, original_id_snapshot, title, body,
					author, original_url, published_at, content_sha256, sort_order,
					source_id_snapshot, source_name_snapshot, network_scope
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`);
			let order = 0;
			let aggregateCharacters = 0;
			const addEvidence = (input: {
				id: string;
				kind: 'note' | 'feed';
				originalId: string;
				title: string;
				body: string;
				author: string | null;
				originalUrl: string | null;
				publishedAt: string | null;
				sourceId: string | null;
				sourceName: string | null;
				networkScope: EpisodeEvidence['networkScope'];
			}): void => {
				const cost = evidenceCharacterCost(input);
				if (order >= episodeEvidenceLimits.maxItems || aggregateCharacters + cost > episodeEvidenceLimits.maxAggregateCharacters) return;
				insert.run(input.id, runId, requestId, input.kind, input.originalId, input.title, input.body, input.author, input.originalUrl, input.publishedAt, contentHash(input.body), order++, input.sourceId, input.sourceName, input.networkScope);
				aggregateCharacters += cost;
			};
			const notes = this.database.prepare('SELECT * FROM generation_request_notes WHERE request_id = ? ORDER BY sort_order').all(requestId) as Array<{
				note_id_snapshot: string;
				title: string;
				body: string;
				author: string | null;
				original_url: string | null;
			}>;
			for (const note of notes) {
				const id = `snapshot-${runId}-note-${order}`;
				addEvidence({id, kind: 'note', originalId: note.note_id_snapshot, title: note.title, body: note.body, author: note.author, originalUrl: safeEvidenceUrl(note.original_url), publishedAt: null, sourceId: null, sourceName: null, networkScope: 'user_supplied'});
			}

			const feedItems = this.database.prepare(`
				WITH ranked AS (
					SELECT si.*, grs.source_name_snapshot, grs.sort_order AS source_sort_order,
						ROW_NUMBER() OVER (
							PARTITION BY grs.source_id_snapshot
							ORDER BY datetime(COALESCE(si.published_at, si.gathered_at)) DESC, si.id
						) AS item_rank
					FROM generation_request_sources grs
					JOIN source_items si
						ON si.source_id = grs.source_id_snapshot
						AND si.feed_source_url = grs.source_url_snapshot
					WHERE grs.request_id = ?
				)
				SELECT * FROM ranked
				ORDER BY item_rank, source_sort_order, datetime(COALESCE(published_at, gathered_at)) DESC, id
				LIMIT 50
			`).all(requestId) as Array<{
				id: string;
				source_id: string;
				title: string;
				content: string;
				author: string | null;
				url: string | null;
				published_at: string | null;
				source_name_snapshot: string;
				network_scope: EpisodeEvidence['networkScope'];
			}>;
			for (const item of feedItems) {
				const id = `snapshot-${runId}-feed-${order}`;
				addEvidence({id, kind: 'feed', originalId: item.id, title: item.title, body: item.content, author: item.author, originalUrl: safeEvidenceUrl(item.url), publishedAt: item.published_at, sourceId: item.source_id, sourceName: item.source_name_snapshot, networkScope: item.network_scope});
			}

			const evidence = this.listEvidence(runId);
			assertEvidenceSufficient(request.mode, evidence);
			return evidence;
		});

		return finalize.immediate();
	}

	listEvidence(runId: string): EpisodeEvidence[] {
		const rows = this.database.prepare('SELECT * FROM episode_evidence_snapshots WHERE run_id = ? ORDER BY sort_order').all(runId) as EvidenceRow[];
		return rows.map(evidenceFromRow);
	}

	hasEvidence(runId: string): boolean {
		return Boolean(this.database.prepare('SELECT 1 FROM episode_evidence_snapshots WHERE run_id = ? LIMIT 1').get(runId));
	}

	publishEpisode(input: {
		runId: string;
		request: EpisodeRequestSnapshot;
		sections: GeneratedSection[];
		audio: PublishedAudio;
		textProvider: 'OpenAI' | 'Ollama' | 'LM Studio' | 'Deterministic test text';
		textModel: string;
	}): void {
		const evidence = this.listEvidence(input.runId);
		const evidenceIds = new Set(evidence.map(item => item.id));
		if (evidenceIds.size === 0) throw new Error('Cannot publish an episode without immutable evidence');
		const script = assertGeneratedEpisode(input.request, evidence, input.sections);

		this.database.prepare('DELETE FROM briefing_sections WHERE run_id = ?').run(input.runId);
		const insertSection = this.database.prepare(`
			INSERT INTO briefing_sections (
				id, run_id, title, type, spoken_text, source_item_ids_json,
				importance_score, follow_up_prompts_json, sort_order
			) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?)
		`);
		const insertClaim = this.database.prepare(`
			INSERT INTO transcript_claims (
				id, run_id, section_id, kind, text, support_status, sort_order,
				speaker_role, speaker_label, voice_profile
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);
		const insertCitation = this.database.prepare(`
			INSERT INTO episode_citations (claim_id, snapshot_id, excerpt, sort_order)
			VALUES (?, ?, ?, ?)
		`);

		let claimCount = 0;
		script.sections.forEach((section, sectionIndex) => {
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
				insertClaim.run(
					segment.id,
					input.runId,
					section.id,
					segment.kind,
					segment.text,
					segment.supportStatus,
					segmentIndex,
					segment.speakerRole,
					segment.speakerLabel ?? null,
					segment.voiceProfile ?? null,
				);
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
				speech_voice = ?, ai_generated = 1, script_format_version = ?
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
			script.version,
			input.runId,
		);
	}

	getPublishedMedia(assetId: string): PublishedMediaRecord | undefined {
		return this.database.prepare(`
			SELECT aa.id AS assetId, aa.run_id AS runId,
				aa.storage_filename AS storageFilename, aa.byte_length AS byteLength,
				aa.mime_type AS mimeType, aa.sha256, aa.validated_at AS validatedAt
			FROM audio_assets aa
			JOIN briefing_runs br ON br.id = aa.run_id
			WHERE aa.id = ? AND ${publishedEpisodePredicate()}
		`).get(assetId) as PublishedMediaRecord | undefined;
	}

	getPublishedMediaByRunId(runId: string): PublishedMediaRecord | undefined {
		return this.database.prepare(`
			SELECT aa.id AS assetId, aa.run_id AS runId,
				aa.storage_filename AS storageFilename, aa.byte_length AS byteLength,
				aa.mime_type AS mimeType, aa.sha256, aa.validated_at AS validatedAt
			FROM audio_assets aa
			JOIN briefing_runs br ON br.id = aa.run_id
			WHERE aa.run_id = ? AND ${publishedEpisodePredicate()}
		`).get(runId) as PublishedMediaRecord | undefined;
	}
}

export const episodeStore = new EpisodeStore();
