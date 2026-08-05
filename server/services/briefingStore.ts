import type {AudioAsset, BriefingRun, BriefingSection, RunStatus} from '../../src/types';
import {db} from '../database/index';

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
	listRuns(): BriefingRun[] {
		const rows = db.prepare('SELECT * FROM briefing_runs ORDER BY datetime(created_at) DESC').all() as BriefingRunRow[];
		return rows.map(row => cloneRun(this.hydrateRun(row)));
	}

	getRun(id: string): BriefingRun | undefined {
		const row = db.prepare('SELECT * FROM briefing_runs WHERE id = ?').get(id) as BriefingRunRow | undefined;
		return row ? cloneRun(this.hydrateRun(row)) : undefined;
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
