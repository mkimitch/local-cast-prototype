import {Router} from 'express';
import {stationStore} from '../services/stationStore';
import {parseNoteBody, parseStationBody} from '../validation';

export const stationsRouter = Router();

stationsRouter.get('/notes', (_req, res) => {
	res.json(stationStore.listNotes());
});

stationsRouter.post('/notes', (req, res) => {
	const parsed = parseNoteBody(req.body);
	if (parsed.ok === false) {
		res.status(400).json({code: 'INVALID_NOTE', error: parsed.error});
		return;
	}
	res.status(201).json(stationStore.createNote(parsed.value));
});

stationsRouter.put('/notes/:id', (req, res) => {
	const parsed = parseNoteBody(req.body);
	if (parsed.ok === false) {
		res.status(400).json({code: 'INVALID_NOTE', error: parsed.error});
		return;
	}
	const note = stationStore.updateNote(req.params.id, parsed.value);
	if (!note) {
		res.status(404).json({code: 'NOT_FOUND', error: 'Note not found'});
		return;
	}
	res.json(note);
});

stationsRouter.delete('/notes/:id', (req, res) => {
	if (!stationStore.deleteNote(req.params.id)) {
		res.status(404).json({code: 'NOT_FOUND', error: 'Note not found'});
		return;
	}
	res.status(204).send();
});

stationsRouter.get('/stations', (_req, res) => {
	res.json(stationStore.listStations());
});

stationsRouter.get('/stations/:id', (req, res) => {
	const station = stationStore.getStation(req.params.id);
	if (!station) {
		res.status(404).json({code: 'NOT_FOUND', error: 'Station not found'});
		return;
	}
	res.json(station);
});

stationsRouter.post('/stations', (req, res) => {
	const parsed = parseStationBody(req.body);
	if (parsed.ok === false) {
		res.status(400).json({code: 'INVALID_STATION', error: parsed.error});
		return;
	}
	try {
		res.status(201).json(stationStore.createStation(parsed.value));
	} catch {
		res.status(400).json({code: 'INVALID_STATION_SELECTION', error: 'One or more selected sources or notes do not exist'});
	}
});

stationsRouter.put('/stations/:id', (req, res) => {
	const parsed = parseStationBody(req.body);
	if (parsed.ok === false) {
		res.status(400).json({code: 'INVALID_STATION', error: parsed.error});
		return;
	}
	try {
		const station = stationStore.updateStation(req.params.id, parsed.value);
		if (!station) {
			res.status(404).json({code: 'NOT_FOUND', error: 'Station not found'});
			return;
		}
		res.json(station);
	} catch {
		res.status(400).json({code: 'INVALID_STATION_SELECTION', error: 'One or more selected sources or notes do not exist'});
	}
});

stationsRouter.delete('/stations/:id', (req, res) => {
	if (!stationStore.deleteStation(req.params.id)) {
		res.status(404).json({code: 'NOT_FOUND', error: 'Station not found'});
		return;
	}
	res.status(204).send();
});
