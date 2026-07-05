import type {AudioAsset, BriefingRun, BriefingSection, RunStatus} from '../../src/types';
import {db} from '../database';
import {sourceStore} from './sourceStore';

const cloneRun = (run: BriefingRun): BriefingRun => ({
	...run,
	sections: run.sections.map(section => ({...section, followUpPrompts: [...section.followUpPrompts], sourceItemIds: [...section.sourceItemIds]})),
	audioAsset: run.audioAsset ? {...run.audioAsset} : undefined,
});

type BriefingRunRow = {
	id: string;
	title: string;
	status: RunStatus;
	created_at: string;
	completed_at: string | null;
	summary: string | null;
};

type BriefingSectionRow = {
	id: string;
	title: string;
	type: BriefingSection['type'];
	spoken_text: string;
	source_item_ids_json: string;
	importance_score: number;
	follow_up_prompts_json: string;
};

type AudioAssetRow = {
	id: string;
	url: string;
	duration_ms: number;
	format: string;
};

const initialRun: BriefingRun = {
	id: 'run-1',
	title: 'Morning Briefing',
	status: 'complete',
	createdAt: new Date(Date.now() - 86400000).toISOString(),
	completedAt: new Date(Date.now() - 86400000 + 300000).toISOString(),
	summary: "A quick overview of today's top stories in AI and tech startups.",
	audioAsset: {id: 'audio-1', url: '#', durationMs: 270000, format: 'mp3'},
	sections: [
		{
			id: 'sec-1',
			title: 'Technology & Startups',
			type: 'news_summary',
			spokenText:
				"In today's top news from TechCrunch, several major funding rounds were announced in the autonomous vehicle space. Analysts note that this signals a resurgence in hard-tech investments. Meanwhile, the AI sector continues to dominate headlines with the release of new models focused on reasoning over pure generation.",
			sourceItemIds: ['src-1', 'src-2'],
			importanceScore: 8,
			followUpPrompts: ['What were the specific funding rounds mentioned?', 'Can you elaborate on the new reasoning models?'],
		},
	],
};

const initialRunSourceIds = ['src-1', 'src-2'];

const createId = (prefix: string): string => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const parseStringArray = (value: string): string[] => {
	try {
		const parsed = JSON.parse(value) as unknown;
		return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : [];
	} catch {
		return [];
	}
};

const sectionFromRow = (row: BriefingSectionRow): BriefingSection => ({
	id: row.id,
	title: row.title,
	type: row.type,
	spokenText: row.spoken_text,
	sourceItemIds: parseStringArray(row.source_item_ids_json),
	importanceScore: row.importance_score,
	followUpPrompts: parseStringArray(row.follow_up_prompts_json),
});

const audioAssetFromRow = (row: AudioAssetRow): AudioAsset => ({
	id: row.id,
	url: row.url,
	durationMs: row.duration_ms,
	format: row.format,
});

class BriefingStore {
	constructor() {
		sourceStore.listSources();
		this.seedRunsIfEmpty();
	}

	private seedRunsIfEmpty(): void {
		const row = db.prepare('SELECT COUNT(*) AS count FROM briefing_runs').get() as {count: number};
		if (row.count > 0) return;

		const seed = db.transaction(() => {
			this.insertRun(initialRun);
			this.replaceRunSourceIds(initialRun.id, initialRunSourceIds);
			this.replaceSections(initialRun.id, initialRun.sections);
			if (initialRun.audioAsset) this.replaceAudioAsset(initialRun.id, initialRun.audioAsset);
		});

		seed();
	}

	listRuns(): BriefingRun[] {
		const rows = db.prepare('SELECT * FROM briefing_runs ORDER BY datetime(created_at) DESC').all() as BriefingRunRow[];
		return rows.map(row => cloneRun(this.hydrateRun(row)));
	}

	getRun(id: string): BriefingRun | undefined {
		const row = db.prepare('SELECT * FROM briefing_runs WHERE id = ?').get(id) as BriefingRunRow | undefined;
		return row ? cloneRun(this.hydrateRun(row)) : undefined;
	}

	createRun(sourceIds: string[]): BriefingRun {
		const run: BriefingRun = {
			id: createId('run'),
			title: `Briefing - ${new Date().toLocaleDateString()}`,
			status: 'queued',
			createdAt: new Date().toISOString(),
			sections: [],
		};

		const create = db.transaction(() => {
			this.insertRun(run);
			this.replaceRunSourceIds(run.id, sourceIds);
		});

		create();
		return cloneRun(run);
	}

	updateRun(id: string, patch: Partial<BriefingRun>): BriefingRun | undefined {
		const current = this.getRun(id);
		if (!current) return undefined;

		const update = db.transaction(() => {
			const assignments: string[] = [];
			const values: Record<string, string | null> = {id};

			if (patch.title !== undefined) {
				assignments.push('title = @title');
				values.title = patch.title;
			}

			if (patch.status !== undefined) {
				assignments.push('status = @status');
				values.status = patch.status;
			}

			if (patch.createdAt !== undefined) {
				assignments.push('created_at = @createdAt');
				values.createdAt = patch.createdAt;
			}

			if (patch.completedAt !== undefined) {
				assignments.push('completed_at = @completedAt');
				values.completedAt = patch.completedAt;
			}

			if (patch.summary !== undefined) {
				assignments.push('summary = @summary');
				values.summary = patch.summary;
			}

			if (assignments.length > 0) {
				db.prepare(`UPDATE briefing_runs SET ${assignments.join(', ')} WHERE id = @id`).run(values);
			}

			if (patch.sections !== undefined) this.replaceSections(id, patch.sections);
			if (patch.audioAsset !== undefined) this.replaceAudioAsset(id, patch.audioAsset);
		});

		update();
		return this.getRun(id);
	}

	updateStatus(id: string, status: RunStatus): BriefingRun | undefined {
		return this.updateRun(id, {status});
	}

	getRunSourceIds(id: string): string[] {
		const rows = db.prepare('SELECT source_id FROM briefing_run_sources WHERE run_id = ? ORDER BY source_id').all(id) as {source_id: string}[];
		return rows.map(row => row.source_id);
	}

	private hydrateRun(row: BriefingRunRow): BriefingRun {
		const sectionRows = db.prepare('SELECT * FROM briefing_sections WHERE run_id = ? ORDER BY sort_order ASC').all(row.id) as BriefingSectionRow[];
		const audioRow = db.prepare('SELECT * FROM audio_assets WHERE run_id = ?').get(row.id) as AudioAssetRow | undefined;

		return {
			id: row.id,
			title: row.title,
			status: row.status,
			createdAt: row.created_at,
			completedAt: row.completed_at || undefined,
			summary: row.summary || undefined,
			sections: sectionRows.map(sectionFromRow),
			audioAsset: audioRow ? audioAssetFromRow(audioRow) : undefined,
		};
	}

	private insertRun(run: BriefingRun): void {
		db.prepare(`
			INSERT INTO briefing_runs (id, title, status, created_at, completed_at, summary)
			VALUES (@id, @title, @status, @createdAt, @completedAt, @summary)
		`).run({
			id: run.id,
			title: run.title,
			status: run.status,
			createdAt: run.createdAt,
			completedAt: run.completedAt ?? null,
			summary: run.summary ?? null,
		});
	}

	private replaceRunSourceIds(runId: string, sourceIds: string[]): void {
		db.prepare('DELETE FROM briefing_run_sources WHERE run_id = ?').run(runId);

		const insert = db.prepare('INSERT OR IGNORE INTO briefing_run_sources (run_id, source_id) VALUES (?, ?)');
		for (const sourceId of sourceIds) insert.run(runId, sourceId);
	}

	private replaceSections(runId: string, sections: BriefingSection[]): void {
		db.prepare('DELETE FROM briefing_sections WHERE run_id = ?').run(runId);

		const insert = db.prepare(`
			INSERT INTO briefing_sections (
				id,
				run_id,
				title,
				type,
				spoken_text,
				source_item_ids_json,
				importance_score,
				follow_up_prompts_json,
				sort_order
			)
			VALUES (@id, @runId, @title, @type, @spokenText, @sourceItemIdsJson, @importanceScore, @followUpPromptsJson, @sortOrder)
		`);

		sections.forEach((section, index) => {
			insert.run({
				id: section.id,
				runId,
				title: section.title,
				type: section.type,
				spokenText: section.spokenText,
				sourceItemIdsJson: JSON.stringify(section.sourceItemIds),
				importanceScore: section.importanceScore,
				followUpPromptsJson: JSON.stringify(section.followUpPrompts),
				sortOrder: index,
			});
		});
	}

	private replaceAudioAsset(runId: string, audioAsset: AudioAsset | undefined): void {
		db.prepare('DELETE FROM audio_assets WHERE run_id = ?').run(runId);
		if (!audioAsset) return;

		db.prepare(`
			INSERT INTO audio_assets (id, run_id, url, duration_ms, format)
			VALUES (@id, @runId, @url, @durationMs, @format)
		`).run({
			id: audioAsset.id,
			runId,
			url: audioAsset.url,
			durationMs: audioAsset.durationMs,
			format: audioAsset.format,
		});
	}
}

export const briefingStore = new BriefingStore();
