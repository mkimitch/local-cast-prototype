import {describe, expect, it} from 'vitest';
import {assertChatCitations} from '../../server/chat/validation';
import type {SupportedChatClaim} from '../../server/chat/types';
import type {EpisodeEvidence} from '../../server/episodes/types';
import {parseChatQuestionRequest, parseIdempotencyKey} from '../../server/validation';

const evidence: EpisodeEvidence[] = [{
	id: 'snapshot-chat-bounds',
	kind: 'note',
	title: 'Synthetic chat bounds',
	body: `${'a'.repeat(600)} beta gamma delta epsilon`,
	contentSha256: 'a'.repeat(64),
	networkScope: 'user_supplied',
}];

const claim = (overrides: Partial<SupportedChatClaim> = {}): SupportedChatClaim => ({
	id: 'chat-claim-bounds',
	text: 'Synthetic supported claim.',
	citations: [{snapshotId: evidence[0]!.id, excerpt: 'aaaaa'}],
	supportStatus: 'supported',
	...overrides,
});

describe('bounded chat validation', () => {
	it.each([
		['one character', 'q', true],
		['exact maximum', 'q'.repeat(1_000), true],
		['empty', '', false],
		['whitespace only', '   ', false],
		['above maximum', 'q'.repeat(1_001), false],
		['embedded NUL', 'bad\0question', false],
		['lone high surrogate', 'bad\ud800question', false],
		['lone low surrogate', 'bad\udc00question', false],
		['valid non-BMP', '😀 question', true],
	] as const)('validates %s question input', (_name, question, accepted) => {
		expect(parseChatQuestionRequest({question}).ok).toBe(accepted);
	});

	it('rejects every client-authored grounding field at the API schema', () => {
		for (const key of ['context', 'citations', 'evidence', 'excerpts', 'sourceIds', 'snapshotIds']) {
			expect(parseChatQuestionRequest({question: 'Synthetic question?', [key]: 'forged'})).toMatchObject({ok: false});
		}
	});

	it.each([
		['ASCII minimum', '12345678', true],
		['ASCII maximum', 'x'.repeat(200), true],
		['Unicode minimum', '😀'.repeat(8), true],
		['Unicode maximum', '😀'.repeat(200), true],
		['below minimum', '😀'.repeat(7), false],
		['above maximum', '😀'.repeat(201), false],
		['NUL at start', `\0${'x'.repeat(8)}`, false],
		['NUL in middle', 'xxxx\0xxxx', false],
		['NUL at end', `${'x'.repeat(8)}\0`, false],
		['lone high surrogate', `${'x'.repeat(8)}\ud800`, false],
		['lone low surrogate', `${'x'.repeat(8)}\udc00`, false],
	] as const)('aligns the %s idempotency-key character bound with SQLite', (_name, value, accepted) => {
		expect(parseIdempotencyKey(value).ok).toBe(accepted);
	});

	it('accepts exact answer bounds and rejects claims, citations, and excerpts above them', () => {
		const fourCitations = ['a'.repeat(600), 'aaaaaa', 'aaaaaaa', 'aaaaaaaa'].map(excerpt => ({snapshotId: evidence[0]!.id, excerpt}));
		const bounded = Array.from({length: 8}, (_value, index) => claim({
			id: `chat-claim-bounds-${index}`,
			text: index === 0 ? 'x'.repeat(1_200) : `Synthetic supported claim ${index}.`,
			citations: index === 0 ? fourCitations : claim().citations,
		}));
		expect(() => assertChatCitations(evidence, bounded)).not.toThrow();
		expect(() => assertChatCitations(evidence, [...bounded, claim({id: 'claim-nine'})])).toThrowError(expect.objectContaining({code: 'CHAT_INVALID_RESPONSE'}));
		expect(() => assertChatCitations(evidence, [claim({text: 'x'.repeat(1_201)})])).toThrowError(expect.objectContaining({code: 'CHAT_INVALID_RESPONSE'}));
		expect(() => assertChatCitations(evidence, [claim({citations: [...fourCitations, {snapshotId: evidence[0]!.id, excerpt: 'aaaaaaaaa'}]})])).toThrowError(expect.objectContaining({code: 'CHAT_INVALID_CITATIONS'}));
		expect(() => assertChatCitations(evidence, [claim({citations: [{snapshotId: evidence[0]!.id, excerpt: 'a'.repeat(601)}]})])).toThrowError(expect.objectContaining({code: 'CHAT_INVALID_CITATIONS'}));
		expect(() => assertChatCitations(evidence, [claim({text: 'Malformed\0claim'})])).toThrowError(expect.objectContaining({code: 'CHAT_INVALID_RESPONSE'}));
		expect(() => assertChatCitations(evidence, [claim({text: 'Malformed\ud800claim'})])).toThrowError(expect.objectContaining({code: 'CHAT_INVALID_RESPONSE'}));
		expect(() => assertChatCitations(evidence, [claim({citations: [{snapshotId: evidence[0]!.id, excerpt: 'aaaa\0a'}]})])).toThrowError(expect.objectContaining({code: 'CHAT_INVALID_CITATIONS'}));
		expect(() => assertChatCitations(evidence, [claim({citations: [{snapshotId: evidence[0]!.id, excerpt: 'aaaa\udc00a'}]})])).toThrowError(expect.objectContaining({code: 'CHAT_INVALID_CITATIONS'}));
	});
});
