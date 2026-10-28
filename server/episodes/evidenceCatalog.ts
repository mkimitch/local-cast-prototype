import {GenerationError, type GenerationDiagnostic} from '../jobs/types';
import type {EpisodeEvidence, GeneratedCitation} from './types';
import {isWellFormedLocalCastText} from '../../src/types';

export const maximumCatalogExcerptCharacters = 600;

export interface EvidenceCatalogIdentity {
	kind: EpisodeEvidence['kind'];
	originalId: string;
	contentSha256: string;
	sourceId?: string;
}

export interface EvidenceCatalogEntry {
	reference: string;
	snapshotId: string;
	originalIdentity: EvidenceCatalogIdentity;
	excerpt: string;
	startOffset: number;
	endOffset: number;
}

export interface EvidenceCatalogSource {
	kind: EpisodeEvidence['kind'];
	title: string;
	author?: string;
	originalUrl?: string;
	publishedAt?: string;
	references: ReadonlyArray<Pick<EvidenceCatalogEntry, 'reference' | 'excerpt'>>;
}

export interface EvidenceCatalog {
	entries: ReadonlyArray<EvidenceCatalogEntry>;
	sources: ReadonlyArray<EvidenceCatalogSource>;
}

interface CatalogRange {
	startOffset: number;
	endOffset: number;
	excerpt: string;
}

const previousCodePointOffset = (value: string, offset: number): number => {
	if (offset <= 0) return 0;
	const previous = value.charCodeAt(offset - 1);
	return previous >= 0xdc00 && previous <= 0xdfff ? offset - 2 : offset - 1;
};

const nextCodePointOffset = (value: string, offset: number): number => {
	const current = value.charCodeAt(offset);
	return current >= 0xd800 && current <= 0xdbff ? offset + 2 : offset + 1;
};

const trimStartOffset = (value: string, startOffset: number, endOffset: number): number => {
	let offset = startOffset;
	while (offset < endOffset) {
		const next = nextCodePointOffset(value, offset);
		if (value.slice(offset, next).trim().length > 0) break;
		offset = next;
	}
	return offset;
};

const trimEndOffset = (value: string, startOffset: number, endOffset: number): number => {
	let offset = endOffset;
	while (offset > startOffset) {
		const previous = previousCodePointOffset(value, offset);
		if (value.slice(previous, offset).trim().length > 0) break;
		offset = previous;
	}
	return offset;
};

const rangeEndingAt = (body: string, endOffset: number): CatalogRange => {
	let startOffset = Math.max(0, endOffset - maximumCatalogExcerptCharacters);
	if (startOffset > 0) {
		const codeUnit = body.charCodeAt(startOffset);
		if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) startOffset += 1;
	}
	startOffset = trimStartOffset(body, startOffset, endOffset);
	return {startOffset, endOffset, excerpt: body.slice(startOffset, endOffset)};
};

const bodyRanges = (body: string): CatalogRange[] => {
	const trimmed = body.trim();
	const firstOffset = body.indexOf(trimmed);
	if (firstOffset < 0 || trimmed.length < 5 || !isWellFormedLocalCastText(trimmed)) {
		throw new GenerationError(
			'EVIDENCE_CATALOG_INVALID',
			'The selected supplied material contained evidence that could not be cited safely',
			false,
			'preserve',
			{stage: 'evidence_catalog', category: 'uncitable_body'},
		);
	}
	const finalOffset = firstOffset + trimmed.length;
	const ranges: CatalogRange[] = [];
	let startOffset = firstOffset;
	while (startOffset < finalOffset) {
		let endOffset = Math.min(finalOffset, startOffset + maximumCatalogExcerptCharacters);
		if (endOffset < finalOffset) {
			const previous = body.charCodeAt(endOffset - 1);
			if (previous >= 0xd800 && previous <= 0xdbff) endOffset -= 1;
		}
		const excerptEnd = trimEndOffset(body, startOffset, endOffset);
		let range = {startOffset, endOffset: excerptEnd, excerpt: body.slice(startOffset, excerptEnd)};
		if (range.excerpt.length < 5) range = rangeEndingAt(body, finalOffset);
		if (
			range.excerpt.length < 5
			|| range.excerpt.length > maximumCatalogExcerptCharacters
			|| range.excerpt !== range.excerpt.trim()
			|| body.slice(range.startOffset, range.endOffset) !== range.excerpt
		) {
			throw new GenerationError(
				'EVIDENCE_CATALOG_INVALID',
				'The selected supplied material contained evidence that could not be cited safely',
				false,
				'preserve',
				{stage: 'evidence_catalog', category: 'uncitable_body'},
			);
		}
		ranges.push(range);
		if (endOffset >= finalOffset) break;
		startOffset = trimStartOffset(body, endOffset, finalOffset);
	}
	return ranges;
};

const freezeEntry = (entry: EvidenceCatalogEntry): EvidenceCatalogEntry => Object.freeze({
	...entry,
	originalIdentity: Object.freeze({...entry.originalIdentity}),
});

export const buildEvidenceCatalog = (evidence: EpisodeEvidence[]): EvidenceCatalog => {
	const pending = evidence.map(item => ({item, ranges: bodyRanges(item.body)}));
	const totalEntries = pending.reduce((total, source) => total + source.ranges.length, 0);
	const tokenWidth = Math.max(2, String(totalEntries).length);
	let referenceIndex = 0;
	const entries: EvidenceCatalogEntry[] = [];
	const sources = pending.map(({item, ranges}) => {
		const references = ranges.map(range => {
			referenceIndex += 1;
			const entry = freezeEntry({
				reference: `E${String(referenceIndex).padStart(tokenWidth, '0')}`,
				snapshotId: item.id,
				originalIdentity: {
					kind: item.kind,
					originalId: item.originalId ?? item.id,
					contentSha256: item.contentSha256,
					...(item.sourceId ? {sourceId: item.sourceId} : {}),
				},
				excerpt: range.excerpt,
				startOffset: range.startOffset,
				endOffset: range.endOffset,
			});
			entries.push(entry);
			return Object.freeze({
				reference: entry.reference,
				excerpt: entry.excerpt,
			});
		});
		return Object.freeze({
			kind: item.kind,
			title: item.title,
			...(item.author ? {author: item.author} : {}),
			...(item.originalUrl ? {originalUrl: item.originalUrl} : {}),
			...(item.publishedAt ? {publishedAt: item.publishedAt} : {}),
			references: Object.freeze(references),
		});
	});
	return Object.freeze({entries: Object.freeze(entries), sources: Object.freeze(sources)});
};

export interface ReferenceDraft {
	sections: Array<{
		title: string;
		type: 'intro' | 'news_summary' | 'deep_dive' | 'outro';
		segments: Array<{kind: 'factual'; text: string; citations: string[]}>;
	}>;
}

export interface ResolvedReferenceSection {
	title: string;
	type: ReferenceDraft['sections'][number]['type'];
	segments: Array<{
		kind: 'factual';
		text: string;
		citations: GeneratedCitation[];
	}>;
}

const invalidReference = (category: GenerationDiagnostic['category'], indices: {
	sectionIndex: number;
	segmentIndex: number;
	citationIndex: number;
	referenceCount: number;
}): never => {
	const repeated = category === 'repeated_reference' || category === 'repeated_snapshot';
	throw new GenerationError(
		'INVALID_CITATIONS',
		repeated
			? 'The generated transcript repeated a source citation within one factual segment'
			: 'The generated transcript cited evidence that could not be validated',
		false,
		'preserve',
		{stage: 'citation_reference_resolution', category, ...indices},
	);
};

export const resolveEvidenceReferences = (
	draft: ReferenceDraft,
	catalog: EvidenceCatalog,
): ResolvedReferenceSection[] => {
	const entriesByReference = new Map(catalog.entries.map(entry => [entry.reference, entry]));
	return draft.sections.map((section, sectionIndex) => ({
		...section,
		segments: section.segments.map((segment, segmentIndex) => {
			const seenReferences = new Set<string>();
			const seenSnapshots = new Set<string>();
			const citations = segment.citations.map((reference, citationIndex) => {
				const indices = {sectionIndex, segmentIndex, citationIndex, referenceCount: segment.citations.length};
				const entry = entriesByReference.get(reference);
				if (!entry) invalidReference('unknown_reference', indices);
				if (seenReferences.has(reference)) invalidReference('repeated_reference', indices);
				if (seenSnapshots.has(entry.snapshotId)) invalidReference('repeated_snapshot', indices);
				seenReferences.add(reference);
				seenSnapshots.add(entry.snapshotId);
				return {snapshotId: entry.snapshotId, excerpt: entry.excerpt};
			});
			return {...segment, citations};
		}),
	}));
};
