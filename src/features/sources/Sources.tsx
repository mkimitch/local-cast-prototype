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
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-semibold text-gray-900 dark:text-gray-50 tracking-tight">Sources</h1>
          <p className="mt-2 text-gray-500 dark:text-gray-400">Manage the content feeds and topics that fuel your briefings.</p>
        </div>
        <div className="flex items-center gap-3">
          {categories.length > 1 && (
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              {categories.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          )}
          <button
            onClick={() => setShowAddForm(true)}
            className="flex items-center gap-2 px-4 py-2 bg-gray-900 dark:bg-gray-50 text-white dark:text-gray-900 rounded-lg hover:bg-gray-800 dark:hover:bg-gray-200 transition-colors text-sm font-medium shadow-sm whitespace-nowrap"
          >
            <Plus size={16} />
            Add Source
          </button>
        </div>
      </div>

      {showAddForm && (
        <div className="bg-white dark:bg-gray-900 p-6 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm animate-in fade-in slide-in-from-top-4 duration-200">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900 dark:text-gray-50">Add New Source</h2>
            <button onClick={() => setShowAddForm(false)} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">×</button>
          </div>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" checked={newType === 'rss'} onChange={() => setNewType('rss')} className="text-blue-600 dark:text-blue-500" />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">RSS Feed</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" checked={newType === 'manual_topic'} onChange={() => setNewType('manual_topic')} className="text-blue-600 dark:text-blue-500" />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Topic / Instructions</span>
              </label>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Source Name</label>
                <input 
                  type="text" 
                  value={newName} 
                  onChange={e => setNewName(e.target.value)}
                  className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-50 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500" 
                  placeholder={newType === 'rss' ? 'e.g. TechCrunch' : 'e.g. AI Research'}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Category (Optional)</label>
                <input 
                  type="text" 
                  value={newCategory} 
                  onChange={e => setNewCategory(e.target.value)}
                  className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-50 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500" 
                  placeholder="e.g. Tech, News, Work"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {newType === 'rss' ? 'RSS URL' : 'Topic Instructions'}
                </label>
                <input 
                  type="text" 
                  value={newUrlOrDesc} 
                  onChange={e => setNewUrlOrDesc(e.target.value)}
                  className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-50 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500" 
                  placeholder={newType === 'rss' ? 'https://...' : 'Describe what to gather...'}
                  required
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button 
                type="button" 
                onClick={() => setShowAddForm(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100"
              >
                Cancel
              </button>
              <button 
                type="submit"
                className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Save Source
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {filteredSources.map(source => (
            <div key={source.id} className={`p-5 flex items-start gap-4 transition-colors ${source.isActive ? 'bg-white dark:bg-gray-900' : 'bg-gray-50 dark:bg-gray-800/50'}`}>
              <div className="mt-1 shrink-0 text-gray-400 dark:text-gray-500">
                {source.type === 'rss' ? <Rss size={20} /> : <Hash size={20} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className={`font-semibold ${source.isActive ? 'text-gray-900 dark:text-gray-50' : 'text-gray-500 dark:text-gray-400'}`}>{source.name}</h3>
                  {source.category && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border border-blue-100 dark:border-blue-800">
                      {source.category}
                    </span>
                  )}
                  {!source.isActive && <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">Inactive</span>}
                </div>
                <p className={`text-sm mt-1 truncate ${source.isActive ? 'text-gray-600 dark:text-gray-300' : 'text-gray-400 dark:text-gray-500'}`}>
                  {source.type === 'rss' ? source.url : source.description}
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <div className="text-xs text-gray-400 dark:text-gray-500">Added {new Date(source.addedAt).toLocaleDateString()}</div>
                  {source.status && source.isActive && (
                    <>
                      <span className="text-gray-300 dark:text-gray-600">•</span>
                      <div className="flex items-center gap-1">
                        {source.status === 'healthy' && <CheckCircle2 size={12} className="text-green-500" />}
                        {source.status === 'error' && <AlertCircle size={12} className="text-red-500" />}
                        {source.status === 'syncing' && <RefreshCw size={12} className="text-blue-500 animate-spin" />}
                        <span className={`text-xs capitalize font-medium ${
                          source.status === 'healthy' ? 'text-green-600 dark:text-green-400' :
                          source.status === 'error' ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400'
                        }`}>
                          {source.status}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => handleToggle(source.id, source.isActive)}
                  className={`p-2 rounded-lg transition-colors ${source.isActive ? 'text-green-600 dark:text-green-500 hover:bg-green-50 dark:hover:bg-green-900/20' : 'text-gray-400 dark:text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                  title={source.isActive ? 'Deactivate' : 'Activate'}
                >
                  {source.isActive ? <Power size={18} /> : <PowerOff size={18} />}
                </button>
                <button
                  onClick={() => handleDelete(source.id)}
                  className="p-2 text-gray-400 dark:text-gray-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                  title="Delete"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
          ))}
          {filteredSources.length === 0 && (
            <div className="p-8 text-center text-gray-500 dark:text-gray-400">
              {sources.length === 0 ? "No sources added yet." : "No sources match the selected category."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
