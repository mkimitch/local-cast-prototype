import {FormEvent, useEffect, useRef, useState} from 'react';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {AlertCircle, CheckCircle2, ExternalLink, List, Pencil, Plus, Power, PowerOff, RefreshCw, Rss, Search, Trash2, X} from 'lucide-react';
import {useSearchParams} from 'react-router-dom';
import {sourceService} from '../../services';
import type {MaterialSearchResult, Source} from '../../types';

const emptyForm = {name: '', url: '', category: ''};

const formatDateTime = (value?: string): string => {
  if (!value) return 'Not available';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not available' : date.toLocaleString();
};

const excerpt = (value: string, maxLength = 320): string => {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength).trim()}…` : normalized;
};

const safeHttpUrl = (value?: string): string | undefined => {
  if (!value || /[\u0000-\u001f\u007f]/.test(value)) return undefined;
  try {
    const url = new URL(value);
    const hasSensitiveQuery = [...url.searchParams.keys()].some(name => {
      const normalized = name.normalize('NFKC').replace(/[._-]/g, '').toLowerCase();
      return /(?:token|secret|password|passwd|apikey|authorization|credential|session|jwt|bearer|signature)/.test(normalized) || /^(?:auth|key|sig)$/.test(normalized);
    });
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password && !hasSensitiveQuery ? url.href : undefined;
  } catch {
    return undefined;
  }
};

const resultDate = (result: MaterialSearchResult): string => formatDateTime(result.publishedAt || result.updatedAt);

export default function SourcesView() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedSourceId = searchParams.get('source') || undefined;
  const activeQuery = searchParams.get('q') || '';
  const [searchValue, setSearchValue] = useState(activeQuery);
  const [showForm, setShowForm] = useState(false);
  const [editingSourceId, setEditingSourceId] = useState<string>();
  const [form, setForm] = useState(emptyForm);
  const [filterCategory, setFilterCategory] = useState('All');
  const [syncingSourceId, setSyncingSourceId] = useState<string>();
  const [announcement, setAnnouncement] = useState('');
  const [error, setError] = useState<string>();
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const restoreFocusRef = useRef<HTMLElement>();
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const sourcePanelRef = useRef<HTMLElement>(null);
  const focusPanelRef = useRef(false);

  const sources = useQuery({queryKey: ['sources'], queryFn: () => sourceService.getSources()});
  const selectedSource = sources.data?.find(source => source.id === selectedSourceId);
  const sourceItems = useQuery({
    queryKey: ['source-items', selectedSourceId],
    queryFn: () => sourceService.getSourceItems(selectedSourceId!),
    enabled: Boolean(selectedSourceId),
  });
  const search = useQuery({
    queryKey: ['materials', activeQuery],
    queryFn: () => sourceService.searchMaterials(activeQuery),
    enabled: Boolean(activeQuery.trim()),
  });

  useEffect(() => {
    if (showForm) firstFieldRef.current?.focus();
  }, [showForm]);

  useEffect(() => {
    setSearchValue(activeQuery);
  }, [activeQuery]);

  useEffect(() => {
    if (selectedSourceId && focusPanelRef.current) {
      focusPanelRef.current = false;
      sourcePanelRef.current?.focus();
    }
  }, [selectedSourceId, sourceItems.data]);

  const refreshSources = async () => {
    await Promise.all([
      queryClient.invalidateQueries({queryKey: ['sources']}),
      queryClient.invalidateQueries({queryKey: ['materials']}),
    ]);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingSourceId(undefined);
    setForm(emptyForm);
    setTimeout(() => restoreFocusRef.current?.focus(), 0);
  };

  const saveSource = useMutation({
    mutationFn: () => editingSourceId
      ? sourceService.updateSource(editingSourceId, {
          name: form.name.trim(),
          url: form.url.trim(),
          category: form.category.trim() || null,
        })
      : sourceService.addSource({
          type: 'rss',
          name: form.name.trim(),
          url: form.url.trim(),
          category: form.category.trim() || undefined,
          isActive: true,
        }),
    onSuccess: async source => {
      setError(undefined);
      setAnnouncement(`${source.name} saved.`);
      closeForm();
      await refreshSources();
    },
    onError: (value: Error) => setError(value.message),
  });

  const openAdd = (trigger: HTMLElement) => {
    restoreFocusRef.current = trigger;
    setEditingSourceId(undefined);
    setForm(emptyForm);
    setError(undefined);
    setShowForm(true);
  };

  const openEdit = (source: Source, trigger: HTMLElement) => {
    restoreFocusRef.current = trigger;
    setEditingSourceId(source.id);
    setForm({name: source.name, url: source.url || '', category: source.category || ''});
    setError(undefined);
    setShowForm(true);
  };

  const submitSource = (event: FormEvent) => {
    event.preventDefault();
    saveSource.mutate();
  };

  const updateSourceParam = (sourceId?: string) => {
    const next = new URLSearchParams(searchParams);
    if (sourceId) next.set('source', sourceId);
    else next.delete('source');
    setSearchParams(next);
  };

  const openSourceItems = (sourceId: string, trigger: HTMLElement) => {
    restoreFocusRef.current = trigger;
    focusPanelRef.current = true;
    updateSourceParam(sourceId);
  };

  const closeSourceItems = () => {
    updateSourceParam();
    setTimeout(() => restoreFocusRef.current?.focus(), 0);
  };

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    const next = new URLSearchParams(searchParams);
    const query = searchValue.trim();
    if (query) next.set('q', query);
    else next.delete('q');
    setSearchParams(next);
    setAnnouncement(query ? `Searching supplied material for ${query}.` : 'Material search cleared.');
  };

  const handleSync = async (source: Source) => {
    setSyncingSourceId(source.id);
    setError(undefined);
    setAnnouncement(`Synchronizing ${source.name}.`);
    try {
      const result = await sourceService.syncSource(source.id);
      const detail = result.notModified
        ? 'No changes were found.'
        : `${result.insertedCount} inserted and ${result.updatedCount} updated.`;
      setAnnouncement(`${source.name} synchronized. ${detail}`);
    } catch (value) {
      setError(value instanceof Error ? value.message : 'The feed could not be synchronized safely.');
    } finally {
      setSyncingSourceId(undefined);
      await refreshSources();
      await queryClient.invalidateQueries({queryKey: ['source-items', source.id]});
    }
  };

  const handleToggle = async (source: Source) => {
    setError(undefined);
    try {
      await sourceService.toggleSource(source.id, !source.isActive);
      setAnnouncement(`${source.name} ${source.isActive ? 'disabled' : 'enabled'}.`);
      await refreshSources();
    } catch (value) {
      setError(value instanceof Error ? value.message : 'The source could not be updated.');
    }
  };

  const handleDelete = async (source: Source) => {
    setError(undefined);
    try {
      await sourceService.deleteSource(source.id);
      if (selectedSourceId === source.id) updateSourceParam();
      setAnnouncement(`${source.name} deleted. Completed episode evidence remains unchanged.`);
      await refreshSources();
      addButtonRef.current?.focus();
    } catch (value) {
      setError(value instanceof Error ? value.message : 'The source could not be deleted.');
    }
  };

  const sourceList = sources.data || [];
  const categories = ['All', ...Array.from(new Set(sourceList.flatMap(source => source.category ? [source.category] : [])))];
  const filteredSources = filterCategory === 'All' ? sourceList : sourceList.filter(source => source.category === filterCategory);

  return (
    <div className="page">
      <div className="page-header page-header--responsive">
        <div>
          <h1 tabIndex={-1} className="page-title">Sources</h1>
          <p className="page-description">Manage supplied RSS and Atom feeds. LocalCast fetches feed XML only; it never retrieves linked pages.</p>
        </div>
        <div className="page-actions">
          {categories.length > 1 && (
            <select value={filterCategory} onChange={event => setFilterCategory(event.target.value)} className="control" aria-label="Filter sources by category">
              {categories.map(category => <option key={category} value={category}>{category}</option>)}
            </select>
          )}
          <button ref={addButtonRef} onClick={event => openAdd(event.currentTarget)} className="button button--dark">
            <Plus size={16} aria-hidden="true" /> Add RSS or Atom feed
          </button>
        </div>
      </div>

      <p className="field-help" role="note">
        Public feeds are allowed by default. Private/LAN hosts require an exact server-side allowlist. Under the current consent, private-feed material stays local and is not sent to OpenAI.
      </p>
      <div className="visually-hidden" role="status" aria-live="polite">{announcement}</div>
      {error && <p className="empty-state" role="alert">{error}</p>}

      {showForm && (
        <section className="card card--padded fade-slide-in" aria-labelledby="source-form-title">
          <div className="form-card-header">
            <h2 id="source-form-title" className="form-card-title">{editingSourceId ? 'Edit feed' : 'Add RSS or Atom feed'}</h2>
            <button onClick={closeForm} className="icon-button" aria-label="Close source form">×</button>
          </div>
          <form onSubmit={submitSource} className="form-stack">
            <div className="form-grid">
              <div className="field">
                <label htmlFor="source-name" className="form-label">Source name</label>
                <input ref={firstFieldRef} id="source-name" type="text" maxLength={200} value={form.name} onChange={event => setForm({...form, name: event.target.value})} className="control" required />
              </div>
              <div className="field">
                <label htmlFor="source-category" className="form-label">Category (optional)</label>
                <input id="source-category" type="text" maxLength={100} value={form.category} onChange={event => setForm({...form, category: event.target.value})} className="control" />
              </div>
              <div className="field form-grid__wide">
                <label htmlFor="source-location" className="form-label">Credential-free HTTP(S) feed URL</label>
                <input id="source-location" type="url" maxLength={2048} value={form.url} onChange={event => setForm({...form, url: event.target.value})} className="control" aria-describedby="source-url-help" placeholder="https://example.com/feed.xml" required />
                <p id="source-url-help" className="field-help">Credentials and fragments are rejected. Changing a URL clears its current mutable items; completed episode snapshots are retained.</p>
              </div>
            </div>
            <div className="form-actions">
              <button type="button" onClick={closeForm} className="button button--plain">Cancel</button>
              <button type="submit" className="button button--primary" disabled={saveSource.isPending}>
                {saveSource.isPending ? 'Saving…' : editingSourceId ? 'Save feed changes' : 'Save feed'}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="card card--padded" aria-labelledby="material-search-title">
        <h2 id="material-search-title" className="card__title"><Search size={20} aria-hidden="true" /> Search supplied material</h2>
        <form className="form-actions" onSubmit={submitSearch} role="search">
          <label className="visually-hidden" htmlFor="material-search">Search feed items and pasted notes</label>
          <input id="material-search" className="control" type="search" maxLength={200} value={searchValue} onChange={event => setSearchValue(event.target.value)} placeholder="Search feed items and pasted notes" />
          <button className="button button--primary" type="submit">Search</button>
        </form>
        {search.isFetching && <p role="status" className="field-help">Searching…</p>}
        {search.isError && <p role="alert" className="empty-state">Unable to search supplied material.</p>}
        {activeQuery && !search.isFetching && search.data && (
          <div className="source-items-list" aria-label="Material search results">
            <p className="field-help" role="status">{search.data.length} result{search.data.length === 1 ? '' : 's'} for “{activeQuery}”.</p>
            {search.data.map(result => {
              const url = safeHttpUrl(result.url);
              return <article key={`${result.kind}-${result.id}`} className="source-item-row">
                <div className="source-item-row__header">
                  <div>
                    <h3 className="source-item-row__title">{result.title}</h3>
                    <div className="source-item-row__meta">
                      <span>{result.kind === 'feed' ? 'Feed item' : 'Pasted note'}</span>
                      {result.sourceName && <span>{result.sourceName}</span>}
                      {result.author && <span>{result.author}</span>}
                      <span>{resultDate(result)}</span>
                    </div>
                  </div>
                  {url && <a href={url} target="_blank" rel="noopener noreferrer" className="source-item-row__link" aria-label={`Open original source for ${result.title}`}><ExternalLink size={16} aria-hidden="true" /> Open source</a>}
                </div>
                <p className="source-item-row__excerpt">{result.excerpt}</p>
              </article>;
            })}
            {search.data.length === 0 && <p className="empty-state">No supplied material matches this search.</p>}
          </div>
        )}
      </section>

      <div className="card" aria-busy={sources.isFetching ? 'true' : 'false'}>
        {sources.isLoading && <p role="status" className="empty-state">Loading sources…</p>}
        {sources.isError && <p role="alert" className="empty-state">Unable to load sources.</p>}
        <div className="card-list">
          {filteredSources.map(source => (
            <article key={source.id} className="source-row" data-active={source.isActive ? 'true' : 'false'}>
              <div className="source-row__icon"><Rss size={20} aria-hidden="true" /></div>
              <div className="source-row__body">
                <div className="source-row__title-line">
                  <h3 className="source-row__title">{source.name}</h3>
                  {source.category && <span className="badge badge--primary">{source.category}</span>}
                  {!source.isActive && <span className="badge badge--neutral">Inactive</span>}
                  {source.feedUrlInvalid && <span className="badge badge--neutral">URL requires replacement</span>}
                  {source.feedNetworkScope === 'private' && <span className="badge badge--neutral">LAN/private</span>}
                </div>
                <p className="source-row__description">{source.url || 'Stored URL hidden because it does not meet the credential-free feed policy.'}</p>
                <div className="source-row__meta">
                  <span>Added {new Date(source.addedAt).toLocaleDateString()}</span>
                  {source.status && source.isActive && <span className="source-row__status" data-status={source.status}>
                    {source.status === 'healthy' && <CheckCircle2 size={12} aria-hidden="true" />}
                    {source.status === 'error' && <AlertCircle size={12} aria-hidden="true" />}
                    {source.status === 'syncing' && <RefreshCw size={12} className="is-spinning" aria-hidden="true" />}
                    {source.status}
                  </span>}
                  <span>{source.itemCount || 0} items</span>
                  {source.lastCheckedAt && <span>Checked {formatDateTime(source.lastCheckedAt)}</span>}
                  {source.nextSyncAfter && <span>Retry after {formatDateTime(source.nextSyncAfter)}</span>}
                </div>
                {source.lastSyncError && <p className="field-help" role="alert">{source.lastSyncErrorCode ? `${source.lastSyncErrorCode}: ` : ''}{source.lastSyncError}</p>}
              </div>
              <div className="source-row__actions">
                <button onClick={event => openSourceItems(source.id, event.currentTarget)} className={`icon-button${selectedSourceId === source.id ? ' icon-button--success' : ' icon-button--muted'}`} aria-label={`Inspect items from ${source.name}`}><List size={18} /></button>
                <button onClick={event => openEdit(source, event.currentTarget)} className="icon-button icon-button--muted" aria-label={`Edit source ${source.name}`}><Pencil size={18} /></button>
                <button onClick={() => void handleSync(source)} className="icon-button icon-button--muted" aria-label={`Synchronize ${source.name}`} disabled={source.feedUrlInvalid || syncingSourceId === source.id || source.status === 'syncing'}>
                  <RefreshCw size={18} className={syncingSourceId === source.id || source.status === 'syncing' ? 'is-spinning' : undefined} />
                </button>
                <button onClick={() => void handleToggle(source)} className={`icon-button${source.isActive ? ' icon-button--success' : ' icon-button--muted'}`} aria-label={`${source.isActive ? 'Disable' : 'Enable'} source ${source.name}`}>
                  {source.isActive ? <Power size={18} /> : <PowerOff size={18} />}
                </button>
                <button onClick={() => void handleDelete(source)} className="icon-button icon-button--danger" aria-label={`Delete source ${source.name}`}><Trash2 size={18} /></button>
              </div>
            </article>
          ))}
          {!sources.isLoading && filteredSources.length === 0 && <div className="empty-state">{sourceList.length === 0 ? 'No sources added yet.' : 'No sources match the selected category.'}</div>}
        </div>
      </div>

      {selectedSource && (
        <section ref={sourcePanelRef} tabIndex={-1} className="card card--padded source-items-panel fade-slide-in" aria-labelledby="source-items-title" aria-busy={sourceItems.isFetching ? 'true' : 'false'}>
          <div className="source-items-panel__header">
            <div>
              <h2 id="source-items-title" className="source-items-panel__title">{selectedSource.name} items</h2>
              <p className="source-items-panel__description">Review the exact stored feed text available to a selected station.</p>
            </div>
            <button onClick={closeSourceItems} className="icon-button icon-button--muted" aria-label="Close source item review"><X size={18} /></button>
          </div>
          {sourceItems.isLoading && <div className="empty-state" role="status">Loading source items…</div>}
          {sourceItems.isError && <div className="empty-state" role="alert">Unable to load source items.</div>}
          {!sourceItems.isLoading && sourceItems.data?.length === 0 && <div className="empty-state">No source items have been stored for this source yet.</div>}
          {sourceItems.data && sourceItems.data.length > 0 && <div className="source-items-list">
            {sourceItems.data.map(item => {
              const url = safeHttpUrl(item.url);
              return <article key={item.id} className="source-item-row">
                <div className="source-item-row__header">
                  <div>
                    <h3 className="source-item-row__title">{item.title}</h3>
                    <div className="source-item-row__meta">
                      <span>{selectedSource.name}</span>
                      {item.author && <span>{item.author}</span>}
                      <span>Published {formatDateTime(item.publishedAt)}</span>
                      <span>Gathered {formatDateTime(item.gatheredAt)}</span>
                    </div>
                  </div>
                  {url && <a href={url} target="_blank" rel="noopener noreferrer" className="source-item-row__link" aria-label={`Open original source for ${item.title}`}><ExternalLink size={16} aria-hidden="true" /> Open source</a>}
                </div>
                <p className="source-item-row__excerpt">{excerpt(item.content)}</p>
              </article>;
            })}
          </div>}
        </section>
      )}
    </div>
  );
}
