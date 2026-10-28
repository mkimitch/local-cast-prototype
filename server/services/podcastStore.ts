import type Database from 'better-sqlite3';
import {db} from '../database/index';
import {publishedEpisodePredicate} from '../episodes/publication';

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
			WHERE ${publishedEpisodePredicate()}
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
