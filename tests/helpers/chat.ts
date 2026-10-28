import {createHash} from 'node:crypto';
import type Database from 'better-sqlite3';

export const syntheticChatEvidence = 'Synthetic LocalCast evidence states that durable chat history remains in SQLite across process and browser restarts.';

export const insertGroundedEpisode = (database: Database.Database, input: {
	runId?: string;
	status?: 'queued' | 'gathering' | 'synthesizing' | 'complete' | 'failed';
	scriptFormatVersion?: 1 | null;
} = {}) => {
	const runId = input.runId || 'run-chat-synthetic';
	const status = input.status || 'complete';
	const requestId = `request-${runId}`;
	const sectionId = `section-${runId}`;
	const claimId = `claim-${runId}`;
	const snapshotId = `snapshot-${runId}`;
	const timestamp = '2026-08-07T12:00:00.000Z';
	database.prepare(`
		INSERT INTO briefing_runs (
			id, title, status, created_at, completed_at, summary, mode,
			ai_generated, script_format_version
		) VALUES (?, ?, ?, ?, ?, ?, 'brief', 1, ?)
	`).run(
		runId,
		'Synthetic grounded episode',
		status,
		timestamp,
		status === 'complete' || status === 'failed' ? timestamp : null,
		status === 'complete' ? 'Synthetic completed summary' : null,
		input.scriptFormatVersion === undefined ? 1 : input.scriptFormatVersion,
	);
	database.prepare(`
		INSERT INTO generation_requests (
			id, run_id, station_id_snapshot, station_revision, station_name,
			topic_instruction, requested_mode, request_hash, requested_at
		) VALUES (?, ?, 'station-synthetic', 1, 'Synthetic station',
			'Synthesize only supplied synthetic material.', 'brief', ?, ?)
	`).run(requestId, runId, createHash('sha256').update(runId).digest('hex'), timestamp);
	database.prepare(`
		INSERT INTO episode_evidence_snapshots (
			id, run_id, request_id, kind, original_id_snapshot, title, body,
			author, original_url, published_at, content_sha256, sort_order,
			source_id_snapshot, source_name_snapshot, network_scope
		) VALUES (?, ?, ?, 'note', 'note-synthetic', 'Synthetic persistence note', ?,
			'Synthetic Author', 'https://example.test/synthetic-note', NULL, ?, 0,
			NULL, NULL, 'user_supplied')
	`).run(snapshotId, runId, requestId, syntheticChatEvidence, createHash('sha256').update(syntheticChatEvidence).digest('hex'));
	database.prepare(`
		INSERT INTO briefing_sections (
			id, run_id, title, type, spoken_text, source_item_ids_json,
			importance_score, follow_up_prompts_json, sort_order
		) VALUES (?, ?, 'Synthetic facts', 'news_summary', ?, ?, 5, '[]', 0)
	`).run(sectionId, runId, syntheticChatEvidence, JSON.stringify([snapshotId]));
	database.prepare(`
		INSERT INTO transcript_claims (
			id, run_id, section_id, kind, text, support_status, sort_order,
			speaker_role, speaker_label, voice_profile
		) VALUES (?, ?, ?, 'factual', ?, 'supported', 0, 'host', NULL, NULL)
	`).run(claimId, runId, sectionId, syntheticChatEvidence);
	database.prepare(`
		INSERT INTO episode_citations (claim_id, snapshot_id, excerpt, sort_order)
		VALUES (?, ?, ?, 0)
	`).run(claimId, snapshotId, syntheticChatEvidence);

	return {runId, requestId, sectionId, claimId, snapshotId, excerpt: syntheticChatEvidence};
};
