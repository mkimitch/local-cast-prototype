import {describe, expect, it} from 'vitest';
import {
	buildEvidenceCatalog,
	maximumCatalogExcerptCharacters,
	resolveEvidenceReferences,
} from '../../server/episodes/evidenceCatalog';
import type {EpisodeEvidence} from '../../server/episodes/types';

const evidenceItem = (overrides: Partial<EpisodeEvidence> = {}): EpisodeEvidence => ({
	id: 'snapshot-catalog-a',
	kind: 'note',
	title: 'Navigation title only',
	body: 'Exact supplied body text is the only citable material in this source.',
	contentSha256: 'a'.repeat(64),
	networkScope: 'user_supplied',
	...overrides,
});

const draft = (citations: string[], secondSegmentCitations?: string[]) => ({
	sections: [{
		title: 'Provider-authored title ignored by publication',
		type: 'news_summary' as const,
		segments: [
			{kind: 'factual' as const, text: 'A supported fact.', citations},
			...(secondSegmentCitations ? [{kind: 'factual' as const, text: 'Another supported fact.', citations: secondSegmentCitations}] : []),
		],
	}],
});

describe('attempt-scoped evidence reference catalog', () => {
	it('is deterministic, compact, unique, immutable, and retains original evidence identity', () => {
		const evidence = [
			evidenceItem({sourceId: 'note-original-a'}),
			evidenceItem({id: 'snapshot-catalog-b', originalId: 'feed-item-original-b', kind: 'feed', sourceId: 'feed-original-b', contentSha256: 'b'.repeat(64)}),
		];
		const first = buildEvidenceCatalog(evidence);
		const second = buildEvidenceCatalog(structuredClone(evidence));
		expect(first).toEqual(second);
		expect(first.entries.map(entry => entry.reference)).toEqual(['E01', 'E02']);
		expect(new Set(first.entries.map(entry => entry.reference)).size).toBe(first.entries.length);
		expect(first.entries[1]).toMatchObject({
			snapshotId: 'snapshot-catalog-b',
			originalIdentity: {kind: 'feed', originalId: 'feed-item-original-b', sourceId: 'feed-original-b', contentSha256: 'b'.repeat(64)},
		});
		expect(Object.isFrozen(first)).toBe(true);
		expect(Object.isFrozen(first.entries)).toBe(true);
		expect(Object.isFrozen(first.entries[0])).toBe(true);
		expect(Object.isFrozen(first.entries[0]!.originalIdentity)).toBe(true);
	});

	it('uses the complete valid short body and never treats its title as citable text', () => {
		const item = evidenceItem();
		const catalog = buildEvidenceCatalog([item]);
		expect(catalog.entries).toEqual([expect.objectContaining({
			reference: 'E01', excerpt: item.body, startOffset: 0, endOffset: item.body.length,
		})]);
		expect(catalog.entries[0]!.excerpt).not.toContain(item.title);
		expect(catalog.sources[0]).toMatchObject({title: item.title, references: [{reference: 'E01', excerpt: item.body}]});
	});

	it('splits long bodies into bounded Unicode-safe exact substrings with deterministic offsets', () => {
		const body = `  ${'évidence🙂 '.repeat(95)}final fact.  `;
		const item = evidenceItem({body});
		const catalog = buildEvidenceCatalog([item]);
		expect(catalog.entries.length).toBeGreaterThan(1);
		for (const entry of catalog.entries) {
			expect(entry.excerpt.length).toBeLessThanOrEqual(maximumCatalogExcerptCharacters);
			expect(entry.excerpt.length).toBeGreaterThanOrEqual(5);
			expect(entry.excerpt).toBe(entry.excerpt.trim());
			expect(body.slice(entry.startOffset, entry.endOffset)).toBe(entry.excerpt);
			expect(entry.excerpt).not.toMatch(/[\ud800-\udbff]$/u);
			expect(entry.excerpt).not.toMatch(/^[\udc00-\udfff]/u);
		}
		expect(buildEvidenceCatalog([structuredClone(item)])).toEqual(catalog);
	});

	it('reconstructs canonical IDs and excerpts in stable model-selected order', () => {
		const evidence = [
			evidenceItem(),
			evidenceItem({id: 'snapshot-catalog-b', body: 'A distinct supplied body supports another factual statement.', contentSha256: 'b'.repeat(64)}),
		];
		const catalog = buildEvidenceCatalog(evidence);
		const resolved = resolveEvidenceReferences(draft(['E02', 'E01']), catalog);
		expect(resolved[0]!.segments[0]!.citations).toEqual([
			{snapshotId: evidence[1]!.id, excerpt: evidence[1]!.body},
			{snapshotId: evidence[0]!.id, excerpt: evidence[0]!.body},
		]);
	});

	it.each([
		['unknown reference', ['E99'], 'unknown_reference'],
		['repeated token', ['E01', 'E01'], 'repeated_reference'],
	] as const)('rejects %s with structural diagnostics only', (_name, citations, category) => {
		const catalog = buildEvidenceCatalog([evidenceItem()]);
		expect(() => resolveEvidenceReferences(draft([...citations]), catalog)).toThrow(expect.objectContaining({
			code: 'INVALID_CITATIONS',
			providerStatusImpact: 'preserve',
			diagnostic: {
				stage: 'citation_reference_resolution', category, sectionIndex: 0, segmentIndex: 0,
				citationIndex: citations.length - 1, referenceCount: citations.length,
			},
		}));
	});

	it('rejects two distinct catalog units from the same snapshot within one segment', () => {
		const catalog = buildEvidenceCatalog([evidenceItem({body: 'source fact '.repeat(100)})]);
		expect(catalog.entries.length).toBeGreaterThan(1);
		expect(() => resolveEvidenceReferences(draft(['E01', 'E02']), catalog)).toThrow(expect.objectContaining({
			code: 'INVALID_CITATIONS',
			diagnostic: expect.objectContaining({category: 'repeated_snapshot', citationIndex: 1}),
		}));
	});

	it('permits the same catalog reference in separate factual segments', () => {
		const catalog = buildEvidenceCatalog([evidenceItem()]);
		const resolved = resolveEvidenceReferences(draft(['E01'], ['E01']), catalog);
		expect(resolved[0]!.segments.map(segment => segment.citations[0])).toEqual([
			{snapshotId: 'snapshot-catalog-a', excerpt: catalog.entries[0]!.excerpt},
			{snapshotId: 'snapshot-catalog-a', excerpt: catalog.entries[0]!.excerpt},
		]);
	});

	it('fails before provider use when an evidence body cannot produce a valid exact excerpt', () => {
		expect(() => buildEvidenceCatalog([evidenceItem({body: ' x '})])).toThrow(expect.objectContaining({
			code: 'EVIDENCE_CATALOG_INVALID',
			diagnostic: {stage: 'evidence_catalog', category: 'uncitable_body'},
		}));
	});
});
