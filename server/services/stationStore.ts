import type Database from 'better-sqlite3';
import {randomUUID} from 'node:crypto';
import {defaultBriefLengthPreset, type BriefLengthPreset, type EpisodeMode, type Note, type Station} from '../../src/types';
import {db} from '../database/index';

export interface SaveNoteInput {
	title: string;
	body: string;
	author?: string;
	originalUrl?: string;
}

export interface SaveStationInput {
	name: string;
	topicInstruction: string;
	defaultMode: EpisodeMode;
	briefLengthPreset?: BriefLengthPreset;
	noteIds: string[];
	sourceIds: string[];
}

type NoteRow = {
	id: string;
	revision: number;
	title: string;
	body: string;
	author: string | null;
	original_url: string | null;
	created_at: string;
	updated_at: string;
};

type StationRow = {
	id: string;
	revision: number;
	name: string;
	topic_instruction: string;
	default_mode: EpisodeMode;
	brief_length_preset: BriefLengthPreset;
	created_at: string;
	updated_at: string;
};

const noteFromRow = (row: NoteRow): Note => ({
	id: row.id,
	revision: row.revision,
	title: row.title,
	body: row.body,
	author: row.author || undefined,
	originalUrl: row.original_url || undefined,
	createdAt: row.created_at,
	updatedAt: row.updated_at,
});

export class StationStore {
	constructor(
		private readonly database: Database.Database = db,
		private readonly now: () => string = () => new Date().toISOString(),
		private readonly createId: () => string = randomUUID,
	) {}

	listNotes(): Note[] {
		return (this.database.prepare('SELECT * FROM notes ORDER BY datetime(updated_at) DESC, id').all() as NoteRow[]).map(noteFromRow);
	}

	getNote(id: string): Note | undefined {
		const row = this.database.prepare('SELECT * FROM notes WHERE id = ?').get(id) as NoteRow | undefined;
		return row ? noteFromRow(row) : undefined;
	}

	createNote(input: SaveNoteInput): Note {
		const timestamp = this.now();
		const id = `note-${this.createId()}`;
		this.database.prepare(`
			INSERT INTO notes (id, revision, title, body, author, original_url, created_at, updated_at)
			VALUES (?, 1, ?, ?, ?, ?, ?, ?)
		`).run(id, input.title, input.body, input.author ?? null, input.originalUrl ?? null, timestamp, timestamp);
		return this.getNote(id)!;
	}

	updateNote(id: string, input: SaveNoteInput): Note | undefined {
		const result = this.database.prepare(`
			UPDATE notes
			SET revision = revision + 1, title = ?, body = ?, author = ?, original_url = ?, updated_at = ?
			WHERE id = ?
		`).run(input.title, input.body, input.author ?? null, input.originalUrl ?? null, this.now(), id);
		return result.changes === 1 ? this.getNote(id) : undefined;
	}

	deleteNote(id: string): boolean {
		const remove = this.database.transaction(() => {
			const timestamp = this.now();
			this.database.prepare(`
				UPDATE stations
				SET revision = revision + 1, updated_at = ?
				WHERE EXISTS (
					SELECT 1 FROM station_notes sn
					WHERE sn.station_id = stations.id AND sn.note_id = ?
				)
			`).run(timestamp, id);
			return this.database.prepare('DELETE FROM notes WHERE id = ?').run(id).changes === 1;
		});
		return remove.immediate();
	}

	listStations(): Station[] {
		const rows = this.database.prepare('SELECT * FROM stations ORDER BY datetime(updated_at) DESC, id').all() as StationRow[];
		return rows.map(row => this.hydrateStation(row));
	}

	getStation(id: string): Station | undefined {
		const row = this.database.prepare('SELECT * FROM stations WHERE id = ?').get(id) as StationRow | undefined;
		return row ? this.hydrateStation(row) : undefined;
	}

	createStation(input: SaveStationInput): Station {
		const id = `station-${this.createId()}`;
		const timestamp = this.now();
		const save = this.database.transaction(() => {
			this.assertSelections(input);
			this.database.prepare(`
				INSERT INTO stations (id, revision, name, topic_instruction, default_mode, brief_length_preset, created_at, updated_at)
				VALUES (?, 1, ?, ?, ?, ?, ?, ?)
			`).run(id, input.name, input.topicInstruction, input.defaultMode, input.briefLengthPreset ?? defaultBriefLengthPreset, timestamp, timestamp);
			this.replaceSelections(id, input);
		});
		save.immediate();
		return this.getStation(id)!;
	}

	updateStation(id: string, input: SaveStationInput): Station | undefined {
		if (!this.getStation(id)) return undefined;
		const save = this.database.transaction(() => {
			this.assertSelections(input);
			this.database.prepare(`
				UPDATE stations
				SET revision = revision + 1, name = ?, topic_instruction = ?, default_mode = ?, brief_length_preset = ?, updated_at = ?
				WHERE id = ?
			`).run(input.name, input.topicInstruction, input.defaultMode, input.briefLengthPreset ?? defaultBriefLengthPreset, this.now(), id);
			this.replaceSelections(id, input);
		});
		save.immediate();
		return this.getStation(id);
	}

	deleteStation(id: string): boolean {
		return this.database.prepare('DELETE FROM stations WHERE id = ?').run(id).changes === 1;
	}

	private hydrateStation(row: StationRow): Station {
		const noteIds = (this.database.prepare('SELECT note_id FROM station_notes WHERE station_id = ? ORDER BY sort_order').all(row.id) as Array<{note_id: string}>).map(value => value.note_id);
		const sourceIds = (this.database.prepare('SELECT source_id FROM station_sources WHERE station_id = ? ORDER BY sort_order').all(row.id) as Array<{source_id: string}>).map(value => value.source_id);
		return {
			id: row.id,
			revision: row.revision,
			name: row.name,
			topicInstruction: row.topic_instruction,
			defaultMode: row.default_mode,
			briefLengthPreset: row.brief_length_preset,
			noteIds,
			sourceIds,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}

	private assertSelections(input: SaveStationInput): void {
		const noteIds = [...new Set(input.noteIds)];
		const sourceIds = [...new Set(input.sourceIds)];
		const noteCount = noteIds.length === 0 ? 0 : (this.database.prepare(`SELECT COUNT(*) AS count FROM notes WHERE id IN (${noteIds.map(() => '?').join(',')})`).get(...noteIds) as {count: number}).count;
		const sourceCount = sourceIds.length === 0 ? 0 : (this.database.prepare(`SELECT COUNT(*) AS count FROM sources WHERE type = 'rss' AND id IN (${sourceIds.map(() => '?').join(',')})`).get(...sourceIds) as {count: number}).count;
		if (noteCount !== noteIds.length) throw new Error('One or more selected notes do not exist');
		if (sourceCount !== sourceIds.length) throw new Error('One or more selected RSS sources do not exist');
	}

	private replaceSelections(stationId: string, input: SaveStationInput): void {
		this.database.prepare('DELETE FROM station_notes WHERE station_id = ?').run(stationId);
		this.database.prepare('DELETE FROM station_sources WHERE station_id = ?').run(stationId);
		const insertNote = this.database.prepare('INSERT INTO station_notes (station_id, note_id, sort_order) VALUES (?, ?, ?)');
		const insertSource = this.database.prepare('INSERT INTO station_sources (station_id, source_id, sort_order) VALUES (?, ?, ?)');
		[...new Set(input.noteIds)].forEach((noteId, index) => insertNote.run(stationId, noteId, index));
		[...new Set(input.sourceIds)].forEach((sourceId, index) => insertSource.run(stationId, sourceId, index));
	}
}

export const stationStore = new StationStore();
