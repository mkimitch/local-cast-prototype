import {afterEach, describe, expect, it, vi} from 'vitest';
import {normalizeDraftCitations} from '../../server/episodes/normalizeDraftCitations';

const a = {snapshotId: 'A', excerpt: 'private excerpt A'};
const b = {snapshotId: 'B', excerpt: 'private excerpt B'};
const wrap = (citations = [a, {...a}]) => ({sections: [{segments: [{kind: 'factual', citations}]}]});
afterEach(() => vi.restoreAllMocks());

describe('exact parsed-draft citation normalization', () => {
	it.each([
		[[a, {...a}], [a]],
		[[a, {...a}, b], [a, b]],
		[[b, a, {...b}, {...a}], [b, a]],
		[[a, {...a, excerpt: 'different excerpt'}], [a, {...a, excerpt: 'different excerpt'}]],
		[[a, {...a, excerpt: `${a.excerpt} `}], [a, {...a, excerpt: `${a.excerpt} `}]],
		[[a, {...a, snapshotId: 'B'}], [a, {...a, snapshotId: 'B'}]],
	])('retains exact first occurrences in order without merging evidence', (input, expected) => {
		vi.spyOn(console, 'info').mockImplementation(() => {});
		const original = structuredClone(input);
		const draft = wrap(input);
		normalizeDraftCitations(draft);
		expect(draft.sections[0]!.segments[0]!.citations).toEqual(expected);
		expect(input).toEqual(original);
	});

	it('keeps cross-segment reuse and ignores transitions, with count-only idempotent diagnostics', () => {
		const log = vi.spyOn(console, 'info').mockImplementation(() => {});
		const draft = wrap();
		draft.sections[0]!.segments.push({kind: 'factual', citations: [a]}, {kind: 'transition', citations: [a, a]});
		normalizeDraftCitations(draft);
		expect(draft.sections[0]!.segments.map(segment => segment.citations)).toEqual([[a], [a], [a, a]]);
		normalizeDraftCitations(draft);
		expect(log.mock.calls).toEqual([[JSON.stringify({event: 'episode_citations_normalized', removedCount: 1})]]);
	});

	it('does not fail when diagnostic logging is unavailable', () => {
		vi.spyOn(console, 'info').mockImplementation(() => { throw new Error('private logger error'); });
		const draft = wrap();
		expect(() => normalizeDraftCitations(draft)).not.toThrow();
		expect(draft.sections[0]!.segments[0]!.citations).toEqual([a]);
	});
});
