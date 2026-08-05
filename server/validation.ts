import {z} from 'zod';
import type {AppSettings} from '../src/types';
import type {CreateSourceInput, UpdateSourceInput} from './services/sourceStore';

type ValidationResult<T> = {ok: true; value: T} | {ok: false; error: string};

const optionalTrimmedString = z.string().trim().min(1).optional();
const sourceStatusSchema = z.enum(['healthy', 'error', 'syncing']);

const createSourceSchema = z.object({
	type: z.literal('rss'),
	name: z.string().trim().min(1).max(200),
	url: z.string().trim().url().max(2048),
	description: optionalTrimmedString,
	category: optionalTrimmedString,
	isActive: z.boolean().default(true),
	status: sourceStatusSchema.default('healthy'),
}).strict();

const updateSourceSchema = z.object({
	type: z.literal('rss').optional(),
	name: z.string().trim().min(1).max(200).optional(),
	url: z.union([z.string().trim().min(1), z.null()]).optional(),
	description: z.union([z.string().trim().min(1), z.null()]).optional(),
	category: z.union([z.string().trim().min(1), z.null()]).optional(),
	isActive: z.boolean().optional(),
	status: sourceStatusSchema.optional(),
}).strict().refine(value => Object.keys(value).length > 0, {message: 'at least one source field is required'});

const briefingRunSchema = z.object({
	sourceIds: z.array(z.string().trim().min(1)).min(1).max(200),
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

export const parseCreateSourceInput = (body: unknown): ValidationResult<CreateSourceInput> => parse(createSourceSchema, body);

export const parseUpdateSourceInput = (body: unknown): ValidationResult<UpdateSourceInput> => {
	const parsed = parse(updateSourceSchema, body);
	if (!parsed.ok) return parsed;

	return {
		ok: true,
		value: {
			...parsed.value,
			url: parsed.value.url ?? undefined,
			description: parsed.value.description ?? undefined,
			category: parsed.value.category ?? undefined,
		},
	};
};

export const parseBriefingRunRequest = (body: unknown): ValidationResult<{sourceIds: string[]}> => parse(briefingRunSchema, body);

export const parseIdempotencyKey = (value: unknown): ValidationResult<string | undefined> => {
	if (value === undefined) return {ok: true, value: undefined};
	return parse(z.string().trim().min(8).max(200), value);
};

export const parseFollowUpRequest = (body: unknown): ValidationResult<{question: string; context?: string; runId?: string}> => parse(followUpSchema, body);

export const parseSettingsBody = (body: unknown): ValidationResult<Partial<AppSettings>> => parse(settingsSchema, body);
