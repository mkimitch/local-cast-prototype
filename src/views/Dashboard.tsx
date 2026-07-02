import { useEffect, useState } from 'react';
import { Play, Activity, Clock, Rss, Calendar, RefreshCw, AlertCircle } from 'lucide-react';
import { sourceService, briefingService, providerService } from '../services';
import { Source, BriefingRun, AppSettings } from '../types';
import { ViewState } from '../App';

interface DashboardProps {
  onNavigateToRun: (id: string) => void;
  onNavigate: (view: ViewState) => void;
}

export default function Dashboard({ onNavigateToRun, onNavigate }: DashboardProps) {
  const [sources, setSources] = useState<Source[]>([]);
  const [runs, setRuns] = useState<BriefingRun[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [allSources, allRuns, appSettings] = await Promise.all([
        sourceService.getSources(),
        briefingService.getRuns(),
        providerService.getSettings()
      ]);
      setSources(allSources.filter(s => s.isActive));
      setRuns(allRuns);
      setSettings(appSettings);
      setIsLoading(false);
    }
    load();
  }, []);

  useEffect(() => {
    // Simple mock scheduler check
    const interval = setInterval(async () => {
      if (!settings?.isScheduleActive || !settings?.scheduleTime) return;
      
      const now = new Date();
      const currentHours = now.getHours().toString().padStart(2, '0');
      const currentMinutes = now.getMinutes().toString().padStart(2, '0');
      const currentTimeStr = `${currentHours}:${currentMinutes}`;
      
      // Prevent multiple runs in the same minute
      const lastRunStr = localStorage.getItem('lastScheduledRunTime');
      
      if (currentTimeStr === settings.scheduleTime && lastRunStr !== currentTimeStr) {
        localStorage.setItem('lastScheduledRunTime', currentTimeStr);
        const activeSourceIds = sources.map(s => s.id);
        if (activeSourceIds.length > 0) {
          const newRun = await briefingService.startRun(activeSourceIds);
          setRuns(prev => [newRun, ...prev]);
        }
      }
    }, 30000); // Check every 30 seconds

    return () => clearInterval(interval);
  }, [settings, sources]);

  const handleQuickGenerate = async () => {
    const activeSourceIds = sources.map(s => s.id);
    const newRun = await briefingService.startRun(activeSourceIds);
    onNavigateToRun(newRun.id);
  };

  const toggleSchedule = async () => {
    if (!settings) return;
    const newSettings = { ...settings, isScheduleActive: !settings.isScheduleActive };
    setSettings(newSettings);
    await providerService.saveSettings(newSettings);
  };

  const updateScheduleTime = async (time: string) => {
    if (!settings) return;
    const newSettings = { ...settings, scheduleTime: time };
    setSettings(newSettings);
    await providerService.saveSettings(newSettings);
  };

  if (isLoading || !settings) return <div className="animate-pulse flex space-x-4"><div className="flex-1 space-y-6 py-1"><div className="h-2 bg-slate-200 rounded"></div></div></div>;

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-display font-semibold text-gray-900 dark:text-gray-50 tracking-tight">Dashboard</h1>
        <p className="mt-2 text-gray-500 dark:text-gray-400">Welcome to LocalCast. Manage your personal audio briefings.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white dark:bg-gray-900 p-6 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm md:col-span-1">
          <div className="flex items-center gap-3 text-gray-500 dark:text-gray-400 mb-3">
            <Rss size={20} />
            <h3 className="font-medium">Active Sources</h3>
          </div>
          <div className="flex items-end justify-between">
            <p className="text-3xl font-semibold text-gray-900 dark:text-gray-50">{sources.length}</p>
            <div className="flex flex-col gap-1 items-end">
              {sources.some(s => s.status === 'syncing') && (
                <div className="flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-2 py-1 rounded">
                  <RefreshCw size={12} className="animate-spin" />
                  <span>Syncing</span>
                </div>
              )}
              {sources.some(s => s.status === 'error') && (
                <div className="flex items-center gap-1.5 text-xs font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 px-2 py-1 rounded">
                  <AlertCircle size={12} />
                  <span>Failed</span>
                </div>
              )}
            </div>
          </div>
          <button 
            onClick={() => onNavigate('sources')}
            className="mt-4 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium"
          >
            Manage sources &rarr;
          </button>
        </div>

        <div className="bg-white dark:bg-gray-900 p-6 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm md:col-span-1">
          <div className="flex items-center gap-3 text-gray-500 dark:text-gray-400 mb-3">
            <Activity size={20} />
            <h3 className="font-medium">Total Runs</h3>
          </div>
          <p className="text-3xl font-semibold text-gray-900 dark:text-gray-50">{runs.length}</p>
          <button 
            onClick={() => onNavigate('runs')}
            className="mt-4 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium"
          >
            View history &rarr;
          </button>
        </div>

        <div className="bg-white dark:bg-gray-900 p-6 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm md:col-span-1 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3 text-gray-500 dark:text-gray-400">
                <Calendar size={20} />
                <h3 className="font-medium">Schedule</h3>
              </div>
              <button 
                onClick={toggleSchedule}
                className={`w-11 h-6 rounded-full transition-colors relative ${settings.isScheduleActive ? 'bg-blue-600 dark:bg-blue-500' : 'bg-gray-200 dark:bg-gray-700'}`}
              >
                <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${settings.isScheduleActive ? 'left-6' : 'left-1'}`} />
              </button>
            </div>
            
            {settings.isScheduleActive ? (
              <input 
                type="time" 
                value={settings.scheduleTime || '07:00'}
                onChange={e => updateScheduleTime(e.target.value)}
                className="mt-2 w-full text-lg font-medium text-gray-900 dark:text-gray-50 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md px-3 py-1.5 focus:ring-blue-500 focus:border-blue-500"
              />
            ) : (
              <p className="text-sm text-gray-400 dark:text-gray-500 mt-2">Off</p>
            )}
          </div>
        </div>

        <div className="bg-blue-600 p-6 rounded-xl border border-blue-700 shadow-sm text-white flex flex-col justify-center md:col-span-1">
          <h3 className="font-medium text-blue-100 mb-2">Ready to listen?</h3>
          <button 
            onClick={handleQuickGenerate}
            disabled={sources.length === 0}
            className="w-full py-2.5 px-4 bg-white text-blue-600 rounded-lg font-medium hover:bg-blue-50 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Play size={18} />
            Generate
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/50">
          <h2 className="font-medium text-gray-900 dark:text-gray-50">Recent Briefings</h2>
        </div>
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {runs.slice(0, 5).map(run => (
            <div key={run.id} className="p-6 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
              <div className="flex items-center gap-4">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${run.status === 'complete' ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400' : 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'}`}>
                  {run.status === 'complete' ? <Play size={20} /> : <Clock size={20} />}
                </div>
                <div>
                  <h3 className="font-medium text-gray-900 dark:text-gray-50">{run.title}</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 capitalize">{run.status.replace('_', ' ')} • {new Date(run.createdAt).toLocaleDateString()}</p>
                </div>
              </div>
              <button
                onClick={() => onNavigateToRun(run.id)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                View
              </button>
            </div>
          ))}
          {runs.length === 0 && (
            <div className="p-8 text-center text-gray-500 dark:text-gray-400">
              No briefings generated yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
