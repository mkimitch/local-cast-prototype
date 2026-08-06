import {z} from 'zod';
import type {AppSettings} from '../src/types';
import type {EpisodeMode} from '../src/types';
import type {CreateSourceInput, UpdateSourceInput} from './services/sourceStore';
import type {SaveNoteInput, SaveStationInput} from './services/stationStore';
import {hasEmbeddedUrlCredential} from './services/safeFeedFetcher';

type ValidationResult<T> = {ok: true; value: T} | {ok: false; error: string};

const optionalTrimmedString = z.string().trim().min(1).optional();
const feedUrlSchema = z.string().trim().url().max(2048).refine(value => {
	const url = new URL(value);
	return (url.protocol === 'http:' || url.protocol === 'https:') && !hasEmbeddedUrlCredential(url) && !url.hash;
}, {message: 'feed URL must be a credential-free HTTP(S) URL without a fragment'}).transform(value => new URL(value).href);

const createSourceSchema = z.object({
	type: z.literal('rss'),
	name: z.string().trim().min(1).max(200),
	url: feedUrlSchema,
	description: z.string().trim().min(1).max(2_000).optional(),
	category: z.string().trim().min(1).max(100).optional(),
	isActive: z.boolean().default(true),
}).strict();

const updateSourceSchema = z.object({
	name: z.string().trim().min(1).max(200).optional(),
	url: feedUrlSchema.optional(),
	description: z.union([z.string().trim().min(1).max(2_000), z.null()]).optional(),
	category: z.union([z.string().trim().min(1).max(100), z.null()]).optional(),
	isActive: z.boolean().optional(),
}).strict().refine(value => Object.keys(value).length > 0, {message: 'at least one source field is required'});

const stationBriefingRunSchema = z.object({
	stationId: z.string().trim().min(1).max(200),
	mode: z.enum(['brief', 'deep']).optional(),
}).strict();

const httpUrlSchema = z.string().trim().url().max(2048).refine(value => {
	const url = new URL(value);
	return (url.protocol === 'http:' || url.protocol === 'https:') && !hasEmbeddedUrlCredential(url);
}, {message: 'original URL must use http or https'});

const noteSchema = z.object({
	title: z.string().trim().min(1).max(200),
	body: z.string().trim().min(1).max(50_000),
	author: z.string().trim().min(1).max(200).optional(),
	originalUrl: httpUrlSchema.optional(),
}).strict();

const stationSchema = z.object({
	name: z.string().trim().min(1).max(200),
	topicInstruction: z.string().trim().min(1).max(4_000),
	defaultMode: z.enum(['brief', 'deep']),
	noteIds: z.array(z.string().trim().min(1).max(200)).max(200),
	sourceIds: z.array(z.string().trim().min(1).max(200)).max(20),
}).strict();

const followUpSchema = z.object({
	question: z.string().trim().min(1).max(4000),
	context: optionalTrimmedString,
	runId: optionalTrimmedString,
}).strict();

const settingsSchema = z.object({
	orbTheme: z.string().trim().min(1).max(80).optional(),
	theme: z.enum(['system', 'light', 'dark']),
	contrastMode: z.enum(['normal', 'high']),
	colorVisionMode: z.enum(['default', 'protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia']),
	textSize: z.enum(['small', 'normal', 'large', 'extra-large']),
	density: z.enum(['compact', 'normal', 'comfortable']),
}).strict();

const parse = <T>(schema: z.ZodType<T>, value: unknown): ValidationResult<T> => {
	const result = schema.safeParse(value);
	if (result.success) return {ok: true, value: result.data};

	return {ok: false, error: result.error.issues[0]?.message || 'Request validation failed'};
};

export const parseCreateSourceInput = (body: unknown): ValidationResult<CreateSourceInput> => parse(createSourceSchema as z.ZodType<CreateSourceInput>, body);

export const parseUpdateSourceInput = (body: unknown): ValidationResult<UpdateSourceInput> => {
	const parsed = parse(updateSourceSchema, body);
	if (!parsed.ok) return parsed;
	return {ok: true, value: parsed.value};
};

export type BriefingRunRequest = {stationId: string; mode?: EpisodeMode};

export const parseBriefingRunRequest = (body: unknown): ValidationResult<BriefingRunRequest> => parse(stationBriefingRunSchema, body);

export const parseNoteBody = (body: unknown): ValidationResult<SaveNoteInput> => parse(noteSchema, body);

export const parseStationBody = (body: unknown): ValidationResult<SaveStationInput> => parse(stationSchema, body);

export const parseIdempotencyKey = (value: unknown): ValidationResult<string | undefined> => {
	if (value === undefined) return {ok: true, value: undefined};
	return parse(z.string().trim().min(8).max(200), value);
};

export const parseFollowUpRequest = (body: unknown): ValidationResult<{question: string; context?: string; runId?: string}> => parse(followUpSchema, body);

export const parseSettingsBody = (body: unknown): ValidationResult<Partial<AppSettings>> => parse(settingsSchema, body);
