import {FormEvent, useState} from 'react';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {FileText, Pencil, Play, Plus, Radio, Trash2} from 'lucide-react';
import {Link, useNavigate, useParams} from 'react-router-dom';
import {briefingService, providerService, sourceService, stationService} from '../../services';
import type {EpisodeMode, Note, Station} from '../../types';

const emptyNote = {title: '', body: '', author: '', originalUrl: ''};
const emptyStation = {name: '', topicInstruction: '', defaultMode: 'brief' as EpisodeMode, noteIds: [] as string[], sourceIds: [] as string[]};

export default function StationsView() {
  const navigate = useNavigate();
  const {stationId} = useParams();
  const queryClient = useQueryClient();
  const notes = useQuery({queryKey: ['notes'], queryFn: () => stationService.getNotes()});
  const stations = useQuery({queryKey: ['stations'], queryFn: () => stationService.getStations()});
  const sources = useQuery({queryKey: ['sources'], queryFn: () => sourceService.getSources()});
  const settings = useQuery({queryKey: ['settings'], queryFn: () => providerService.getSettings()});
  const [noteForm, setNoteForm] = useState(emptyNote);
  const [editingNoteId, setEditingNoteId] = useState<string>();
  const [stationForm, setStationForm] = useState(emptyStation);
  const [editingStationId, setEditingStationId] = useState<string>();
  const [error, setError] = useState<string>();

  const refreshNotes = async () => {
    await Promise.all([
      queryClient.invalidateQueries({queryKey: ['notes']}),
      queryClient.invalidateQueries({queryKey: ['stations']}),
    ]);
  };
  const refreshStations = () => queryClient.invalidateQueries({queryKey: ['stations']});

  const saveNote = useMutation({
    mutationFn: () => stationService.saveNote({
      title: noteForm.title,
      body: noteForm.body,
      author: noteForm.author.trim() || undefined,
      originalUrl: noteForm.originalUrl.trim() || undefined,
    }, editingNoteId),
    onSuccess: async () => {
      setNoteForm(emptyNote);
      setEditingNoteId(undefined);
      setError(undefined);
      await refreshNotes();
    },
    onError: (value: Error) => setError(value.message),
  });

  const saveStation = useMutation({
    mutationFn: () => stationService.saveStation(stationForm, editingStationId),
    onSuccess: async station => {
      setStationForm(emptyStation);
      setEditingStationId(undefined);
      setError(undefined);
      await refreshStations();
      navigate(`/stations/${encodeURIComponent(station.id)}`);
    },
    onError: (value: Error) => setError(value.message),
  });

  const generate = useMutation({
    mutationFn: (station: Station) => briefingService.startStationRun(station.id, station.defaultMode),
    onSuccess: run => navigate(`/episodes/${encodeURIComponent(run.id)}`),
    onError: (value: Error) => setError(value.message),
  });

  const submitNote = (event: FormEvent) => {
    event.preventDefault();
    saveNote.mutate();
  };

  const submitStation = (event: FormEvent) => {
    event.preventDefault();
    saveStation.mutate();
  };

  const editNote = (note: Note) => {
    setEditingNoteId(note.id);
    setNoteForm({title: note.title, body: note.body, author: note.author || '', originalUrl: note.originalUrl || ''});
  };

  const editStation = (station: Station) => {
    setEditingStationId(station.id);
    setStationForm({
      name: station.name,
      topicInstruction: station.topicInstruction,
      defaultMode: station.defaultMode,
      noteIds: station.noteIds,
      sourceIds: station.sourceIds,
    });
  };

  const toggleSelection = (kind: 'noteIds' | 'sourceIds', id: string) => {
    setStationForm(current => ({
      ...current,
      [kind]: current[kind].includes(id) ? current[kind].filter(value => value !== id) : [...current[kind], id],
    }));
  };

  const loading = notes.isLoading || stations.isLoading || sources.isLoading || settings.isLoading;
  if (loading) return <p role="status" className="loading-message">Loading stations and notes...</p>;

  return (
    <div className="page page--wide">
      <div className="page-header">
        <div>
          <h1 className="page-title">Stations & Notes</h1>
          <p className="page-description">Save supplied facts as notes, then use a station to direct synthesis without autonomous research.</p>
        </div>
      </div>

      <div className="card card--padded" role="note" aria-label="External provider disclosure">
        <strong>External provider disclosure</strong>
        <p className="field-help">
          When you choose <strong>Sync and generate</strong>, OpenAI receives the station direction and selected pasted-note or RSS/Atom item titles, URLs, authors, dates, and bodies for drafting and support validation. OpenAI TTS then receives the final narration. LocalCast does not search the web, and all resulting audio is AI-generated.
          Private/LAN feed material remains local under the current consent and cannot be generated with OpenAI.
        </p>
      </div>

      {error && <p className="empty-state" role="alert">{error}</p>}
      {stationId && !stations.isLoading && !stations.data?.some(station => station.id === stationId) && (
        <p className="empty-state" role="alert">The linked station was not found.</p>
      )}

      <div className="content-grid content-grid--two">
        <section className="card card--padded">
          <h2 className="card__title"><FileText size={20} aria-hidden="true" /> {editingNoteId ? 'Edit note' : 'Add pasted note'}</h2>
          <form className="form-stack" onSubmit={submitNote}>
            <div className="field">
              <label className="form-label" htmlFor="note-title">Title</label>
              <input id="note-title" className="control" maxLength={200} required value={noteForm.title} onChange={event => setNoteForm({...noteForm, title: event.target.value})} />
            </div>
            <div className="field">
              <label className="form-label" htmlFor="note-body">Pasted factual material</label>
              <textarea id="note-body" className="control" rows={10} maxLength={50000} required value={noteForm.body} onChange={event => setNoteForm({...noteForm, body: event.target.value})} />
              <p className="field-help">This body is evidence. Station directions are stored separately and cannot be cited.</p>
            </div>
            <div className="field">
              <label className="form-label" htmlFor="note-author">Author (optional)</label>
              <input id="note-author" className="control" maxLength={200} value={noteForm.author} onChange={event => setNoteForm({...noteForm, author: event.target.value})} />
            </div>
            <div className="field">
              <label className="form-label" htmlFor="note-url">Original HTTP(S) URL (optional)</label>
              <input id="note-url" className="control" type="url" maxLength={2048} value={noteForm.originalUrl} onChange={event => setNoteForm({...noteForm, originalUrl: event.target.value})} />
            </div>
            <div className="form-actions">
              {editingNoteId && <button type="button" className="button button--plain" onClick={() => { setEditingNoteId(undefined); setNoteForm(emptyNote); }}>Cancel</button>}
              <button className="button button--primary" disabled={saveNote.isPending}>
                <Plus size={16} aria-hidden="true" /> {saveNote.isPending ? 'Saving...' : editingNoteId ? 'Save note changes' : 'Save note'}
              </button>
            </div>
          </form>

          <div className="card-list" aria-label="Saved notes">
            {notes.data?.map(note => (
              <article key={note.id} className="briefing-row">
                <div>
                  <h3 className="briefing-row__title">{note.title}</h3>
                  <p className="field-help">Revision {note.revision} · {note.body.slice(0, 100)}{note.body.length > 100 ? '…' : ''}</p>
                </div>
                <div className="page-actions">
                  <button className="icon-button" aria-label={`Edit note ${note.title}`} onClick={() => editNote(note)}><Pencil size={16} /></button>
                  <button className="icon-button" aria-label={`Delete note ${note.title}`} onClick={async () => { await stationService.deleteNote(note.id); await refreshNotes(); }}><Trash2 size={16} /></button>
                </div>
              </article>
            ))}
            {notes.data?.length === 0 && <p className="empty-state">No pasted notes yet.</p>}
          </div>
        </section>

        <section className="card card--padded">
          <h2 className="card__title"><Radio size={20} aria-hidden="true" /> {editingStationId ? 'Edit station' : 'Create station'}</h2>
          <form className="form-stack" onSubmit={submitStation}>
            <div className="field">
              <label className="form-label" htmlFor="station-name">Station name</label>
              <input id="station-name" className="control" maxLength={200} required value={stationForm.name} onChange={event => setStationForm({...stationForm, name: event.target.value})} />
            </div>
            <div className="field">
              <label className="form-label" htmlFor="station-topic">Topic and editorial direction</label>
              <textarea id="station-topic" className="control" rows={5} maxLength={4000} required value={stationForm.topicInstruction} onChange={event => setStationForm({...stationForm, topicInstruction: event.target.value})} />
              <p className="field-help">Direction shapes the episode; it is not factual evidence and never triggers web research.</p>
            </div>
            <div className="field">
              <label className="form-label" htmlFor="station-mode">Default mode</label>
              <select id="station-mode" className="control" value={stationForm.defaultMode} onChange={event => setStationForm({...stationForm, defaultMode: event.target.value as EpisodeMode})}>
                <option value="brief">Brief</option>
                <option value="deep">Deep (not yet available)</option>
              </select>
            </div>
            <fieldset className="field">
              <legend className="form-label">Pasted notes</legend>
              {(notes.data || []).map(note => (
                <label key={note.id} className="choice-card">
                  <input type="checkbox" checked={stationForm.noteIds.includes(note.id)} onChange={() => toggleSelection('noteIds', note.id)} />
                  <span>{note.title}</span>
                </label>
              ))}
              {notes.data?.length === 0 && <p className="field-help">Save a note first.</p>}
            </fieldset>
            {(sources.data || []).length > 0 && (
              <fieldset className="field">
                <legend className="form-label">RSS/Atom sources</legend>
                {(sources.data || []).map(source => (
                  <label key={source.id} className="choice-card">
                    <input
                      type="checkbox"
                      checked={stationForm.sourceIds.includes(source.id)}
                      onChange={() => toggleSelection('sourceIds', source.id)}
                      disabled={(!source.isActive || source.feedUrlInvalid) && !stationForm.sourceIds.includes(source.id)}
                    />
                    <span>{source.name}{!source.isActive ? ' (inactive)' : source.feedUrlInvalid ? ' (URL requires replacement)' : ''}</span>
                  </label>
                ))}
                <p className="field-help">Only selected active feeds are synchronized when you explicitly generate. Linked article pages are never fetched.</p>
              </fieldset>
            )}
            <div className="form-actions">
              {editingStationId && <button type="button" className="button button--plain" onClick={() => { setEditingStationId(undefined); setStationForm(emptyStation); }}>Cancel</button>}
              <button className="button button--primary" disabled={saveStation.isPending}>
                <Plus size={16} aria-hidden="true" /> {saveStation.isPending ? 'Saving...' : editingStationId ? 'Save station changes' : 'Save station'}
              </button>
            </div>
          </form>

          <div className="card-list" aria-label="Saved stations">
            {stations.data?.map(station => {
              const unavailableSource = station.sourceIds.some(sourceId => {
                const source = sources.data?.find(candidate => candidate.id === sourceId);
                return !source || !source.isActive || source.feedUrlInvalid;
              });
              const unavailableReason = station.defaultMode === 'deep'
                ? 'Deep generation becomes available with the Slice 3 mode contract.'
                : unavailableSource
                  ? 'Remove or repair inactive feed selections before generating.'
                  : undefined;
              return <article key={station.id} id={`station-${station.id}`} className="briefing-row" aria-current={station.id === stationId ? 'true' : undefined}>
                <div>
                  <h3 className="briefing-row__title"><Link to={`/stations/${encodeURIComponent(station.id)}`}>{station.name}</Link></h3>
                  <p className="field-help">{station.defaultMode} · revision {station.revision} · {station.noteIds.length} note{station.noteIds.length === 1 ? '' : 's'}</p>
                  {unavailableReason && <p className="field-help">{unavailableReason}</p>}
                </div>
                <div className="page-actions">
                  <button className="icon-button" aria-label={`Edit station ${station.name}`} onClick={() => editStation(station)}><Pencil size={16} /></button>
                  <button className="icon-button" aria-label={`Delete station ${station.name}`} onClick={async () => { await stationService.deleteStation(station.id); await refreshStations(); if (station.id === stationId) navigate('/stations'); }}><Trash2 size={16} /></button>
                  <button
                    className="button button--inverse"
                    disabled={!settings.data?.generationEnabled || generate.isPending || station.noteIds.length + station.sourceIds.length === 0 || Boolean(unavailableReason)}
                    onClick={() => generate.mutate(station)}
                  >
                    <Play size={16} aria-hidden="true" /> {generate.isPending ? 'Starting...' : 'Sync and generate'}
                  </button>
                </div>
              </article>;
            })}
            {stations.data?.length === 0 && <p className="empty-state">No stations yet.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
