import {z} from 'zod';
import type {EpisodeRequestSnapshot, GeneratedSection} from './types';
import type {ResolvedReferenceSection} from './evidenceCatalog';
import {aiAudioDisclosure} from './modePolicy';

const citationReferenceSchema = z.string().min(3).max(32);

const segmentSchema = z.object({
	kind: z.literal('factual'),
	text: z.string().min(1).max(1_200),
	citations: z.array(citationReferenceSchema).min(1).max(4),
}).strict();

export const episodeDraftSchema = z.object({
	sections: z.array(z.object({
		title: z.string().min(1).max(120),
		type: z.enum(['intro', 'news_summary', 'deep_dive', 'outro']),
		segments: z.array(segmentSchema).min(1).max(10),
	}).strict()).min(1).max(6),
}).strict();

export const sectionsForResolvedDraft = (request: EpisodeRequestSnapshot, resolvedDraft: ResolvedReferenceSection[]): GeneratedSection[] => {
	const sectionTitles: Record<GeneratedSection['type'], string> = {
		intro: 'Introduction',
		news_summary: 'Source summary',
		deep_dive: 'Deep dive',
		outro: 'Closing',
	};
	const sections: GeneratedSection[] = resolvedDraft.map((section, sectionIndex) => ({
		id: `section-${request.runId}-${sectionIndex}`,
		title: sectionTitles[section.type],
		type: section.type,
		segments: section.segments.map((segment, segmentIndex) => ({
			id: `claim-${request.runId}-${sectionIndex}-${segmentIndex}`,
			kind: segment.kind,
			text: segment.text,
			citations: segment.citations,
			supportStatus: 'supported' as const,
			speakerRole: 'host' as const,
		})),
	}));

	const disclosure: GeneratedSection = {
		id: `section-${request.runId}-disclosure`,
		title: 'AI audio disclosure',
		type: 'intro',
		segments: [{
			id: `claim-${request.runId}-disclosure`,
			kind: 'transition',
			text: aiAudioDisclosure,
			citations: [],
			supportStatus: 'not_required',
			speakerRole: 'host',
		}],
	};
	const publishedSections = [disclosure, ...sections];
	return publishedSections;
};
