import { useEffect, useState } from 'react';
import { Play, Activity, Clock, Rss, RefreshCw, AlertCircle } from 'lucide-react';
import { sourceService, briefingService, providerService, stationService } from '../../services';
import { Source, BriefingRun, AppSettings, Station } from '../../types';
import { ViewState } from '../../App';

interface DashboardProps {
  onNavigateToRun: (id: string) => void;
  onNavigate: (view: ViewState) => void;
}

export default function Dashboard({ onNavigateToRun, onNavigate }: DashboardProps) {
  const [sources, setSources] = useState<Source[]>([]);
  const [runs, setRuns] = useState<BriefingRun[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [stations, setStations] = useState<Station[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isEnqueueing, setIsEnqueueing] = useState(false);
  const [loadError, setLoadError] = useState<string>();

  useEffect(() => {
    const load = async () => {
      try {
        const [allSources, allRuns, appSettings, savedStations] = await Promise.all([
          sourceService.getSources(),
          briefingService.getRuns(),
          providerService.getSettings(),
          stationService.getStations(),
        ]);
        setSources(allSources.filter(s => s.isActive && s.type === 'rss'));
        setRuns(allRuns);
        setSettings(appSettings);
        setStations(savedStations);
      } catch {
        setLoadError('LocalCast could not reach its local API. Check that the application service is running.');
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, []);

  const handleQuickGenerate = async () => {
    if (isEnqueueing) return;
    setIsEnqueueing(true);
    try {
      const station = stations[0];
      if (!station) return;
      const newRun = await briefingService.startStationRun(station.id, station.defaultMode);
      onNavigateToRun(newRun.id);
    } catch {
      setLoadError('LocalCast could not enqueue this briefing. Check provider status and try again.');
      setIsEnqueueing(false);
    }
  };

  if (isLoading) return <div className="loading-skeleton" aria-label="Loading dashboard" />;
  if (loadError || !settings) return <div className="empty-state" role="alert">{loadError || 'Dashboard settings are unavailable.'}</div>;

  const canGenerate = settings.generationEnabled && Boolean(stations[0] && stations[0].noteIds.length + stations[0].sourceIds.length > 0);
  const generationHelp = !settings.generationEnabled
    ? 'Generation is unavailable until text and speech providers are configured on the server.'
    : stations.length === 0
      ? 'Save a station with supplied material before generating.'
      : 'OpenAI receives the selected station direction and evidence; OpenAI TTS receives the final narration. Audio is AI-generated.';

  return (
    <div className="page page--wide">
      <div className="page-header">
        <div>
          <h1 tabIndex={-1} className="page-title">Dashboard</h1>
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

        <div className="hero-action-card">
          <h3 className="hero-action-card__title">Create on demand</h3>
          <p id="generation-help">{generationHelp}</p>
          <button 
            onClick={handleQuickGenerate}
            disabled={!canGenerate || isEnqueueing}
            aria-describedby="generation-help"
            className="button button--inverse"
          >
            <Play size={18} />
            {isEnqueueing ? 'Enqueueing...' : 'Sync and generate'}
          </button>
          {stations.length === 0 && <button className="button button--link" onClick={() => onNavigate('stations')}>Create a station &rarr;</button>}
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
