import {FormEvent, useEffect, useRef, useState} from 'react';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {FileText, Pencil, Play, Plus, Radio, Trash2} from 'lucide-react';
import {Link, useNavigate, useParams} from 'react-router-dom';
import {briefingService, providerService, sourceService, stationService} from '../../services';
import {defaultBriefLengthPreset, type BriefLengthPreset, type EpisodeMode, type Note, type Station} from '../../types';
import ConfirmDialog from '../../components/layout/ConfirmDialog';

const emptyNote = {title: '', body: '', author: '', originalUrl: ''};
const emptyStation = {name: '', topicInstruction: '', defaultMode: 'brief' as EpisodeMode, briefLengthPreset: defaultBriefLengthPreset, noteIds: [] as string[], sourceIds: [] as string[]};

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
  const [runModes, setRunModes] = useState<Record<string, EpisodeMode>>({});
  const [error, setError] = useState<string>();
  const [pendingDelete, setPendingDelete] = useState<{kind: 'note'; item: Note} | {kind: 'station'; item: Station}>();
  const [isDeleting, setIsDeleting] = useState(false);
  const noteTitle = useRef<HTMLInputElement>(null);
  const stationName = useRef<HTMLInputElement>(null);
  const deleteTrigger = useRef<HTMLElement>();

  useEffect(() => {
    if (editingNoteId) noteTitle.current?.focus();
  }, [editingNoteId]);

  useEffect(() => {
    if (editingStationId) stationName.current?.focus();
  }, [editingStationId]);

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
    mutationFn: ({station, mode}: {station: Station; mode: EpisodeMode}) => briefingService.startStationRun(station.id, mode),
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
      briefLengthPreset: station.briefLengthPreset,
      noteIds: station.noteIds,
      sourceIds: station.sourceIds,
    });
  };

  const cancelDelete = () => {
    setPendingDelete(undefined);
    requestAnimationFrame(() => deleteTrigger.current?.focus());
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const deletedKind = pendingDelete.kind;
    setIsDeleting(true);
    setError(undefined);
    try {
      if (pendingDelete.kind === 'note') {
        await stationService.deleteNote(pendingDelete.item.id);
        await refreshNotes();
      } else {
        await stationService.deleteStation(pendingDelete.item.id);
        await refreshStations();
        if (pendingDelete.item.id === stationId) navigate('/stations');
      }
      setPendingDelete(undefined);
      requestAnimationFrame(() => (deletedKind === 'note' ? noteTitle.current : stationName.current)?.focus());
    } catch (value) {
      setError(value instanceof Error ? value.message : 'The selected item could not be deleted.');
    } finally {
      setIsDeleting(false);
    }
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
          <h1 tabIndex={-1} className="page-title">Stations & Notes</h1>
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
              <input ref={noteTitle} id="note-title" className="control" maxLength={200} required value={noteForm.title} onChange={event => setNoteForm({...noteForm, title: event.target.value})} />
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
                  <button type="button" className="icon-button" aria-label={`Delete note ${note.title}`} onClick={event => { event.preventDefault(); event.stopPropagation(); deleteTrigger.current = event.currentTarget; setPendingDelete(() => ({kind: 'note', item: note})); }}><Trash2 size={16} /></button>
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
              <input ref={stationName} id="station-name" className="control" maxLength={200} required value={stationForm.name} onChange={event => setStationForm({...stationForm, name: event.target.value})} />
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
                <option value="deep">Deep</option>
              </select>
            </div>
            <div className="field">
              <label className="form-label" htmlFor="station-brief-length">Brief length</label>
              <select
                id="station-brief-length"
                className="control"
                value={stationForm.briefLengthPreset}
                onChange={event => setStationForm({...stationForm, briefLengthPreset: event.target.value as BriefLengthPreset})}
              >
                <option value="standard">Standard — 600–1,000 words</option>
                <option value="compact">Compact — 200–350 words</option>
              </select>
              <p className="field-help">Used when this station generates in Brief mode. Deep mode is unchanged.</p>
            </div>
            <fieldset className="field">
              <legend className="form-label">Pasted notes</legend>
              <div className="station-choice-list">
                {(notes.data || []).map((note, index) => {
                  const controlId = `station-note-${index}`;
                  const selected = stationForm.noteIds.includes(note.id);
                  return (
                    <label key={note.id} className="station-choice" htmlFor={controlId} data-selected={selected ? 'true' : 'false'}>
                      <input id={controlId} type="checkbox" checked={selected} onChange={() => toggleSelection('noteIds', note.id)} />
                      <span className="station-choice__label">{note.title}</span>
                    </label>
                  );
                })}
              </div>
              {notes.data?.length === 0 && <p className="field-help">Save a note first.</p>}
            </fieldset>
            {(sources.data || []).length > 0 && (
              <fieldset className="field">
                <legend className="form-label">RSS/Atom sources</legend>
                <div className="station-choice-list">
                  {(sources.data || []).map((source, index) => {
                    const controlId = `station-source-${index}`;
                    const reasonId = `${controlId}-reason`;
                    const selected = stationForm.sourceIds.includes(source.id);
                    const unavailableReason = !source.isActive
                      ? 'Unavailable because this feed is inactive.'
                      : source.feedUrlInvalid
                        ? 'Unavailable until its feed URL is replaced.'
                        : undefined;
                    const disabled = Boolean(unavailableReason) && !selected;
                    return (
                      <label
                        key={source.id}
                        className="station-choice"
                        htmlFor={controlId}
                        data-selected={selected ? 'true' : 'false'}
                        data-disabled={disabled ? 'true' : 'false'}
                      >
                        <input
                          id={controlId}
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleSelection('sourceIds', source.id)}
                          disabled={disabled}
                          aria-describedby={unavailableReason ? reasonId : undefined}
                        />
                        <span className="station-choice__label">
                          {source.name}{!source.isActive ? ' (inactive)' : source.feedUrlInvalid ? ' (URL requires replacement)' : ''}
                        </span>
                        {unavailableReason && <span id={reasonId} className="station-choice__reason">{unavailableReason}</span>}
                      </label>
                    );
                  })}
                </div>
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
              const unavailableReason = unavailableSource ? 'Remove or repair inactive feed selections before generating.' : undefined;
              const runMode = runModes[station.id] || station.defaultMode;
              return <article key={station.id} id={`station-${station.id}`} className="briefing-row" aria-current={station.id === stationId ? 'true' : undefined}>
                <div>
                  <h3 className="briefing-row__title"><Link to={`/stations/${encodeURIComponent(station.id)}`}>{station.name}</Link></h3>
                  <p className="field-help">{station.defaultMode}{station.defaultMode === 'brief' ? ` · ${station.briefLengthPreset}` : ''} · revision {station.revision} · {station.noteIds.length} note{station.noteIds.length === 1 ? '' : 's'}</p>
                  {unavailableReason && <p className="field-help">{unavailableReason}</p>}
                </div>
                <div className="page-actions">
                  <button className="icon-button" aria-label={`Edit station ${station.name}`} onClick={() => editStation(station)}><Pencil size={16} /></button>
                  <button type="button" className="icon-button" aria-label={`Delete station ${station.name}`} onClick={event => { event.preventDefault(); event.stopPropagation(); deleteTrigger.current = event.currentTarget; setPendingDelete(() => ({kind: 'station', item: station})); }}><Trash2 size={16} /></button>
                  <label>
                    <span className="sr-only">Generation mode for {station.name}</span>
                    <select
                      className="control control--minimal"
                      aria-label={`Generation mode for ${station.name}`}
                      value={runMode}
                      onChange={event => setRunModes(current => ({...current, [station.id]: event.target.value as EpisodeMode}))}
                    >
                      <option value="brief">Brief</option>
                      <option value="deep">Deep</option>
                    </select>
                  </label>
                  <button
                    className="button button--inverse"
                    disabled={!settings.data?.generationEnabled || generate.isPending || station.noteIds.length + station.sourceIds.length === 0 || Boolean(unavailableReason)}
                    onClick={() => generate.mutate({station, mode: runMode})}
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
      {pendingDelete && (
        <ConfirmDialog
          title={`Delete ${pendingDelete.item.name || pendingDelete.item.title}?`}
          description={pendingDelete.kind === 'note'
            ? 'This removes the saved note. Completed episode evidence remains unchanged.'
            : 'This removes the saved station. Completed episode evidence remains unchanged.'}
          confirmLabel={pendingDelete.kind === 'note' ? 'Delete note' : 'Delete station'}
          busy={isDeleting}
          onCancel={cancelDelete}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </div>
  );
}
