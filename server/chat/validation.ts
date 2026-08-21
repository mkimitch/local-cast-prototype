import {z} from 'zod';
import {isBoundedLocalCastText} from '../../src/types';
import type {EpisodeEvidence} from '../episodes/types';
import {GenerationError} from '../jobs/types';
import {chatLimits, type SupportedChatClaim} from './types';

const citationSchema = z.object({
	snapshotId: z.string().refine(value => isBoundedLocalCastText(value, 1, 240)),
	excerpt: z.string().refine(value => value === value.trim() && isBoundedLocalCastText(value, 5, chatLimits.excerptCharacters)),
}).strict();

export const chatDraftSchema = z.object({
	kind: z.enum(['answer', 'refusal']),
	claims: z.array(z.object({
		text: z.string().refine(value => value === value.trim() && isBoundedLocalCastText(value, 1, chatLimits.claimCharacters)),
		citations: z.array(citationSchema).min(1).max(chatLimits.maximumCitationsPerClaim),
	}).strict()).max(chatLimits.maximumClaims),
	reason: z.enum(['not_applicable', 'insufficient_evidence']),
}).strict().superRefine((value, context) => {
	if (value.kind === 'answer' && (value.claims.length === 0 || value.reason !== 'not_applicable')) {
		context.addIssue({code: 'custom', message: 'Supported answers require claims and no refusal reason'});
	}
	if (value.kind === 'refusal' && (value.claims.length !== 0 || value.reason !== 'insufficient_evidence')) {
		context.addIssue({code: 'custom', message: 'Refusals cannot include answer claims'});
	}
});

export const chatSupportSchema = z.object({
	results: z.array(z.object({
		claimId: z.string().refine(value => isBoundedLocalCastText(value, 1, 240)),
		status: z.enum(['supported', 'unsupported', 'uncertain']),
	}).strict()).max(chatLimits.maximumClaims),
}).strict();

export const assertChatCitations = (
	evidence: EpisodeEvidence[],
	claims: SupportedChatClaim[],
): void => {
	if (claims.length < 1 || claims.length > chatLimits.maximumClaims) {
		throw new GenerationError('CHAT_INVALID_RESPONSE', 'The text provider returned an invalid grounded chat answer', false);
	}

	const evidenceById = new Map(evidence.map(item => [item.id, item]));
	for (const claim of claims) {
		if (claim.text !== claim.text.trim() || !isBoundedLocalCastText(claim.text, 1, chatLimits.claimCharacters) || claim.supportStatus !== 'supported') {
			throw new GenerationError('CHAT_INVALID_RESPONSE', 'The text provider returned an invalid grounded chat answer', false);
		}
		if (claim.citations.length < 1 || claim.citations.length > chatLimits.maximumCitationsPerClaim) {
			throw new GenerationError('CHAT_INVALID_CITATIONS', 'The chat answer contained invalid evidence citations', false);
		}
		const uniqueCitations = new Set<string>();
		for (const citation of claim.citations) {
			const evidenceItem = evidenceById.get(citation.snapshotId);
			const identity = `${citation.snapshotId}\u0000${citation.excerpt}`;
			if (
				!evidenceItem
				|| citation.excerpt !== citation.excerpt.trim()
				|| !isBoundedLocalCastText(citation.snapshotId, 1, 240)
				|| !isBoundedLocalCastText(citation.excerpt, 5, chatLimits.excerptCharacters)
				|| !evidenceItem.body.includes(citation.excerpt)
				|| uniqueCitations.has(identity)
			) {
				throw new GenerationError('CHAT_INVALID_CITATIONS', 'The chat answer contained invalid evidence citations', false);
			}
			uniqueCitations.add(identity);
		}
	}
};
