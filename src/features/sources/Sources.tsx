import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Power, PowerOff, Hash, Rss, AlertCircle, RefreshCw, CheckCircle2 } from 'lucide-react';
import { sourceService } from '../../services';
import { Source, SourceType } from '../../types';

export default function SourcesView() {
  const [sources, setSources] = useState<Source[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newType, setNewType] = useState<SourceType>('rss');
  const [newName, setNewName] = useState('');
  const [newUrlOrDesc, setNewUrlOrDesc] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('All');

  const loadSources = async () => {
    const data = await sourceService.getSources();
    setSources(data);
  };

  useEffect(() => {
    loadSources();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    
    await sourceService.addSource({
      type: newType,
      name: newName.trim(),
      url: newType === 'rss' ? newUrlOrDesc.trim() : undefined,
      description: newType === 'manual_topic' ? newUrlOrDesc.trim() : undefined,
      category: newCategory.trim() || undefined,
      isActive: true
    });
    
    setNewName('');
    setNewUrlOrDesc('');
    setNewCategory('');
    setShowAddForm(false);
    loadSources();
  };

  const handleToggle = async (id: string, currentActive: boolean) => {
    await sourceService.toggleSource(id, !currentActive);
    loadSources();
  };

  const handleDelete = async (id: string) => {
    await sourceService.deleteSource(id);
    loadSources();
  };

  const categories = ['All', ...Array.from(new Set(sources.map(s => s.category).filter(Boolean) as string[]))];
  const filteredSources = filterCategory === 'All' ? sources : sources.filter(s => s.category === filterCategory);

  return (
    <div className="page">
      <div className="page-header page-header--responsive">
        <div>
          <h1 className="page-title">Sources</h1>
          <p className="page-description">Manage the content feeds and topics that fuel your briefings.</p>
        </div>
        <div className="page-actions">
          {categories.length > 1 && (
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="control"
              aria-label="Filter sources by category"
            >
              {categories.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          )}
          <button
            onClick={() => setShowAddForm(true)}
            className="button button--dark"
          >
            <Plus size={16} />
            Add Source
          </button>
        </div>
      </div>

      {showAddForm && (
        <div className="card card--padded fade-slide-in">
          <div className="form-card-header">
            <h2 className="form-card-title">Add New Source</h2>
            <button onClick={() => setShowAddForm(false)} className="icon-button" aria-label="Close add source form">×</button>
          </div>
          <form onSubmit={handleAdd} className="form-stack">
            <div className="radio-group">
              <label className="radio-option">
                <input type="radio" checked={newType === 'rss'} onChange={() => setNewType('rss')} />
                <span>RSS Feed</span>
              </label>
              <label className="radio-option">
                <input type="radio" checked={newType === 'manual_topic'} onChange={() => setNewType('manual_topic')} />
                <span>Topic / Instructions</span>
              </label>
            </div>
            
            <div className="form-grid">
              <div className="field">
                <label className="form-label">Source Name</label>
                <input 
                  type="text" 
                  value={newName} 
                  onChange={e => setNewName(e.target.value)}
                  className="control" 
                  placeholder={newType === 'rss' ? 'e.g. TechCrunch' : 'e.g. AI Research'}
                  required
                />
              </div>
              <div className="field">
                <label className="form-label">Category (Optional)</label>
                <input 
                  type="text" 
                  value={newCategory} 
                  onChange={e => setNewCategory(e.target.value)}
                  className="control" 
                  placeholder="e.g. Tech, News, Work"
                />
              </div>
              <div className="field form-grid__wide">
                <label className="form-label">
                  {newType === 'rss' ? 'RSS URL' : 'Topic Instructions'}
                </label>
                <input 
                  type="text" 
                  value={newUrlOrDesc} 
                  onChange={e => setNewUrlOrDesc(e.target.value)}
                  className="control" 
                  placeholder={newType === 'rss' ? 'https://...' : 'Describe what to gather...'}
                  required
                />
              </div>
            </div>
            <div className="form-actions">
              <button 
                type="button" 
                onClick={() => setShowAddForm(false)}
                className="button button--plain"
              >
                Cancel
              </button>
              <button 
                type="submit"
                className="button button--primary"
              >
                Save Source
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="card">
        <div className="card-list">
          {filteredSources.map(source => (
            <div key={source.id} className="source-row" data-active={source.isActive ? 'true' : 'false'}>
              <div className="source-row__icon">
                {source.type === 'rss' ? <Rss size={20} /> : <Hash size={20} />}
              </div>
              <div className="source-row__body">
                <div className="source-row__title-line">
                  <h3 className="source-row__title">{source.name}</h3>
                  {source.category && (
                    <span className="badge badge--primary">
                      {source.category}
                    </span>
                  )}
                  {!source.isActive && <span className="badge badge--neutral">Inactive</span>}
                </div>
                <p className="source-row__description">
                  {source.type === 'rss' ? source.url : source.description}
                </p>
                <div className="source-row__meta">
                  <div>Added {new Date(source.addedAt).toLocaleDateString()}</div>
                  {source.status && source.isActive && (
                    <>
                      <span aria-hidden="true">•</span>
                      <div className="source-row__status" data-status={source.status}>
                        {source.status === 'healthy' && <CheckCircle2 size={12} />}
                        {source.status === 'error' && <AlertCircle size={12} />}
                        {source.status === 'syncing' && <RefreshCw size={12} className="is-spinning" />}
                        <span>{source.status}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
              <div className="source-row__actions">
                <button
                  onClick={() => handleToggle(source.id, source.isActive)}
                  className={`icon-button${source.isActive ? ' icon-button--success' : ' icon-button--muted'}`}
                  title={source.isActive ? 'Deactivate' : 'Activate'}
                  aria-label={source.isActive ? 'Deactivate source' : 'Activate source'}
                >
                  {source.isActive ? <Power size={18} /> : <PowerOff size={18} />}
                </button>
                <button
                  onClick={() => handleDelete(source.id)}
                  className="icon-button icon-button--danger"
                  title="Delete"
                  aria-label="Delete source"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
          ))}
          {filteredSources.length === 0 && (
            <div className="empty-state">
              {sources.length === 0 ? "No sources added yet." : "No sources match the selected category."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
