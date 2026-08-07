import type Database from 'better-sqlite3';
import {db} from '../database/index';

export interface PublishedPodcastEpisode {
	runId: string;
	title: string;
	description: string;
	createdAt: string;
	completedAt: string;
	assetId: string;
	durationMs: number;
	byteLength: number;
	sha256: string;
}

type PodcastEpisodeRow = {
	run_id: string;
	title: string;
	description: string | null;
	created_at: string;
	completed_at: string;
	asset_id: string;
	duration_ms: number;
	byte_length: number;
	sha256: string;
};

export class PodcastStore {
	constructor(private readonly database: Database.Database = db) {}

	listPublishedEpisodes(): PublishedPodcastEpisode[] {
		const rows = this.database.prepare(`
			SELECT br.id AS run_id, br.title, br.summary AS description,
				br.created_at, br.completed_at, aa.id AS asset_id,
				aa.duration_ms, aa.byte_length, aa.sha256
			FROM briefing_runs br
			JOIN audio_assets aa ON aa.run_id = br.id
			WHERE br.status = 'complete'
				AND br.completed_at IS NOT NULL
				AND br.ai_generated = 1
				AND br.script_format_version = 1
				AND aa.format = 'mp3'
				AND aa.mime_type = 'audio/mpeg'
				AND aa.storage_filename IS NOT NULL
				AND aa.validated_at IS NOT NULL
				AND aa.ai_generated = 1
				AND aa.byte_length > 0
				AND aa.duration_ms > 0
				AND length(aa.sha256) = 64
				AND EXISTS (
					SELECT 1
					FROM transcript_claims tc
					JOIN episode_citations ec ON ec.claim_id = tc.id
					WHERE tc.run_id = br.id
						AND tc.kind = 'factual'
						AND tc.support_status = 'supported'
				)
				AND NOT EXISTS (
					SELECT 1
					FROM transcript_claims tc
					WHERE tc.run_id = br.id
						AND tc.kind = 'factual'
						AND (
							tc.support_status <> 'supported'
							OR NOT EXISTS (
							SELECT 1 FROM episode_citations ec WHERE ec.claim_id = tc.id
							)
						)
				)
			ORDER BY datetime(br.completed_at) DESC, br.completed_at DESC, br.id DESC
		`).all() as PodcastEpisodeRow[];

		return rows.flatMap(row => {
			if (!Number.isSafeInteger(row.byte_length) || row.byte_length <= 0) return [];
			if (!Number.isSafeInteger(row.duration_ms) || row.duration_ms <= 0) return [];
			if (!Number.isFinite(Date.parse(row.completed_at))) return [];
			if (!/^[a-f0-9]{64}$/.test(row.sha256)) return [];
			return [{
				runId: row.run_id,
				title: row.title,
				description: row.description || 'A source-grounded LocalCast episode generated from supplied material.',
				createdAt: row.created_at,
				completedAt: row.completed_at,
				assetId: row.asset_id,
				durationMs: row.duration_ms,
				byteLength: row.byte_length,
				sha256: row.sha256,
			}];
		});
	}
}

export const podcastStore = new PodcastStore();
