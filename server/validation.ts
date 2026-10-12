import {z} from 'zod';
import {defaultBriefLengthPreset, type AppSettings, type EpisodeMode} from '../src/types';
import {isBoundedLocalCastText, isWellFormedLocalCastText} from '../src/types';
import type {CreateSourceInput, UpdateSourceInput} from './services/sourceStore';
import type {SaveNoteInput, SaveStationInput} from './services/stationStore';
import {hasEmbeddedUrlCredential} from './services/safeFeedFetcher';
import {openAiApiKeySchema} from './credentials/openAiCredentialStore';

type ValidationResult<T> = {ok: true; value: T} | {ok: false; error: string};
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
	briefLengthPreset: z.enum(['compact', 'standard']).optional().default(defaultBriefLengthPreset),
	noteIds: z.array(z.string().trim().min(1).max(200)).max(200),
	sourceIds: z.array(z.string().trim().min(1).max(200)).max(20),
}).strict();

const chatQuestionSchema = z.object({question: z.string()}).strict();

const idempotencyKeySchema = z.string().refine(value => (
	value === value.trim() && isBoundedLocalCastText(value, 8, 200)
), {message: 'Idempotency-Key must contain between 8 and 200 valid characters without surrounding whitespace'});

const settingsSchema = z.object({
	orbTheme: z.string().trim().min(1).max(80).optional(),
	theme: z.enum(['system', 'light', 'dark']),
	contrastMode: z.enum(['normal', 'high']),
	colorVisionMode: z.enum(['default', 'protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia']),
	textSize: z.enum(['small', 'normal', 'large', 'extra-large']),
	density: z.enum(['compact', 'normal', 'comfortable']),
}).strict();

const openAiCredentialSchema = z.object({apiKey: openAiApiKeySchema}).strict();

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
	return parse(idempotencyKeySchema, value);
};

export const parseChatQuestionRequest = (body: unknown): ValidationResult<{question: string}> => {
	const parsed = parse(chatQuestionSchema, body);
	if (!parsed.ok) return parsed;
	const question = parsed.value.question.trim();
	if (!isWellFormedLocalCastText(parsed.value.question) || !isBoundedLocalCastText(question, 1, 1_000)) {
		return {ok: false, error: 'Question must contain between 1 and 1000 well-formed characters'};
	}
	return {ok: true, value: {question}};
};

export const parseSettingsBody = (body: unknown): ValidationResult<Partial<AppSettings>> => parse(settingsSchema, body);

export const parseOpenAiCredentialBody = (body: unknown): ValidationResult<{apiKey: string}> => parse(openAiCredentialSchema, body);
