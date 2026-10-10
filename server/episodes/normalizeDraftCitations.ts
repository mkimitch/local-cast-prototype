interface DraftCitation {
	snapshotId: string;
	excerpt: string;
}

// Only call on a schema-validated, private parsed episode draft, never evidence
// snapshots or published scripts. The strict validator remains the final gate.
export const normalizeDraftCitations = (draft: {
	sections: Array<{segments: Array<{kind: string; citations: DraftCitation[]}>}>;
}): void => {
	let removedCount = 0;
	for (const section of draft.sections) {
		for (const segment of section.segments) {
			if (segment.kind !== 'factual') continue;
			const seen = new Map<string, Set<string>>();
			segment.citations = segment.citations.filter(citation => {
				const excerpts = seen.get(citation.snapshotId) ?? new Set<string>();
				if (excerpts.has(citation.excerpt)) {
					removedCount += 1;
					return false;
				}
				excerpts.add(citation.excerpt);
				seen.set(citation.snapshotId, excerpts);
				return true;
			});
		}
	}
	if (removedCount > 0) {
		try {
			console.info(JSON.stringify({event: 'episode_citations_normalized', removedCount}));
		} catch {
			// Diagnostic availability must not change validation or generation.
		}
	}
};
