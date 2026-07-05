import { useEffect, useState } from 'react';
import { Play, Activity, Clock, Rss, Calendar, RefreshCw, AlertCircle } from 'lucide-react';
import { sourceService, briefingService, providerService } from '../../services';
import { Source, BriefingRun, AppSettings } from '../../types';
import { ViewState } from '../../App';

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

  if (isLoading || !settings) return <div className="loading-skeleton" aria-label="Loading dashboard" />;

  return (
    <div className="page page--wide">
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-description">Welcome to LocalCast. Manage your personal audio briefings.</p>
        </div>
      </div>

      <div className="metrics-grid">
        <div className="card metric-card">
          <div className="metric-card__label">
            <Rss size={20} />
            <h3>Active Sources</h3>
          </div>
          <div className="metric-card__value-row">
            <p className="metric-card__value">{sources.length}</p>
            <div className="metric-card__badges">
              {sources.some(s => s.status === 'syncing') && (
                <div className="badge badge--primary">
                  <RefreshCw size={12} className="is-spinning" />
                  <span>Syncing</span>
                </div>
              )}
              {sources.some(s => s.status === 'error') && (
                <div className="badge badge--danger">
                  <AlertCircle size={12} />
                  <span>Failed</span>
                </div>
              )}
            </div>
          </div>
          <button 
            onClick={() => onNavigate('sources')}
            className="button button--link metric-card__link"
          >
            Manage sources &rarr;
          </button>
        </div>

        <div className="card metric-card">
          <div className="metric-card__label">
            <Activity size={20} />
            <h3>Total Runs</h3>
          </div>
          <p className="metric-card__value">{runs.length}</p>
          <button 
            onClick={() => onNavigate('runs')}
            className="button button--link metric-card__link"
          >
            View history &rarr;
          </button>
        </div>

        <div className="card metric-card schedule-card">
          <div>
            <div className="schedule-card__header">
              <div className="metric-card__label">
                <Calendar size={20} />
                <h3>Schedule</h3>
              </div>
              <button 
                onClick={toggleSchedule}
                className="switch"
                data-active={settings.isScheduleActive ? 'true' : 'false'}
                aria-pressed={settings.isScheduleActive}
                aria-label="Toggle schedule"
              >
                <span className="switch__thumb" />
              </button>
            </div>
            
            {settings.isScheduleActive ? (
              <input 
                type="time" 
                value={settings.scheduleTime || '07:00'}
                onChange={e => updateScheduleTime(e.target.value)}
                className="control control--time"
              />
            ) : (
              <p className="schedule-card__off">Off</p>
            )}
          </div>
        </div>

        <div className="hero-action-card">
          <h3 className="hero-action-card__title">Ready to listen?</h3>
          <button 
            onClick={handleQuickGenerate}
            disabled={sources.length === 0}
            className="button button--inverse"
          >
            <Play size={18} />
            Generate
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card__header">
          <h2 className="card__title">Recent Briefings</h2>
        </div>
        <div className="card-list">
          {runs.slice(0, 5).map(run => (
            <div key={run.id} className="briefing-row">
              <div className="briefing-row__main">
                <div className="run-avatar" data-status={run.status === 'complete' ? 'complete' : 'pending'}>
                  {run.status === 'complete' ? <Play size={20} /> : <Clock size={20} />}
                </div>
                <div>
                  <h3 className="briefing-row__title">{run.title}</h3>
                  <p className="briefing-row__meta briefing-row__meta--status">{run.status.replace('_', ' ')} • {new Date(run.createdAt).toLocaleDateString()}</p>
                </div>
              </div>
              <button
                onClick={() => onNavigateToRun(run.id)}
                className="button button--secondary"
              >
                View
              </button>
            </div>
          ))}
          {runs.length === 0 && (
            <div className="empty-state">
              No briefings generated yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
