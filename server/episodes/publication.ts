export const publishedEpisodePredicate = (runAlias = 'br', audioAlias = 'aa'): string => `
	${runAlias}.status = 'complete'
	AND ${runAlias}.completed_at IS NOT NULL
	AND ${runAlias}.ai_generated = 1
	AND ${runAlias}.script_format_version = 1
	AND ${audioAlias}.format = 'mp3'
	AND ${audioAlias}.mime_type = 'audio/mpeg'
	AND ${audioAlias}.storage_filename IS NOT NULL
	AND ${audioAlias}.validated_at IS NOT NULL
	AND ${audioAlias}.ai_generated = 1
	AND ${audioAlias}.byte_length > 0
	AND ${audioAlias}.duration_ms > 0
	AND length(${audioAlias}.sha256) = 64
	AND EXISTS (
		SELECT 1
		FROM transcript_claims tc
		JOIN episode_citations ec ON ec.claim_id = tc.id
		JOIN episode_evidence_snapshots es ON es.id = ec.snapshot_id AND es.run_id = tc.run_id
		WHERE tc.run_id = ${runAlias}.id
			AND tc.kind = 'factual'
			AND tc.support_status = 'supported'
			AND ec.excerpt = trim(ec.excerpt)
			AND instr(es.body, ec.excerpt) > 0
	)
	AND NOT EXISTS (
		SELECT 1
		FROM transcript_claims tc
		WHERE tc.run_id = ${runAlias}.id
			AND tc.kind = 'factual'
			AND (
				tc.support_status <> 'supported'
				OR NOT EXISTS (
					SELECT 1
					FROM episode_citations ec
					JOIN episode_evidence_snapshots es ON es.id = ec.snapshot_id AND es.run_id = tc.run_id
					WHERE ec.claim_id = tc.id
						AND ec.excerpt = trim(ec.excerpt)
						AND instr(es.body, ec.excerpt) > 0
				)
			)
	)
`;
