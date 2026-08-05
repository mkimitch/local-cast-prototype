import { useEffect, useState } from 'react';
import { Play, Clock, CheckCircle, AlertTriangle } from 'lucide-react';
import { briefingService, providerService, sourceService } from '../../services';
import { AppSettings, BriefingRun } from '../../types';

interface RunsProps {
  onNavigateToRun: (id: string) => void;
}

export default function RunsView({ onNavigateToRun }: RunsProps) {
  const [runs, setRuns] = useState<BriefingRun[]>([]);
  const [activeSourcesCount, setActiveSourcesCount] = useState(0);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loadError, setLoadError] = useState<string>();
  const [isEnqueueing, setIsEnqueueing] = useState(false);

  const loadData = async () => {
    try {
      const [allRuns, allSources, appSettings] = await Promise.all([
        briefingService.getRuns(),
        sourceService.getSources(),
        providerService.getSettings()
      ]);
      setRuns(allRuns);
      setActiveSourcesCount(allSources.filter(s => s.isActive && s.type === 'rss').length);
      setSettings(appSettings);
      setLoadError(undefined);
    } catch {
      setLoadError('LocalCast could not load briefing runs from its local API.');
    }
  };

  useEffect(() => {
    loadData();
    // Auto refresh runs list periodically to catch background updates
    const interval = setInterval(() => {
      loadData();
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleGenerate = async () => {
    if (isEnqueueing) return;
    setIsEnqueueing(true);
    try {
      const allSources = await sourceService.getSources();
      const activeSourceIds = allSources.filter(s => s.isActive && s.type === 'rss').map(s => s.id);
      const newRun = await briefingService.startRun(activeSourceIds);
      onNavigateToRun(newRun.id);
    } catch {
      setLoadError('LocalCast could not enqueue this briefing. Check provider status and try again.');
      setIsEnqueueing(false);
    }
  };

  const canGenerate = Boolean(settings?.generationEnabled) && activeSourcesCount > 0;
  const generationHelp = !settings?.generationEnabled
    ? 'Generation is unavailable until text and speech providers are configured on the server.'
    : activeSourcesCount === 0
      ? 'Add and enable at least one source before generating.'
      : 'Synchronize active sources and create a briefing.';

  const getStatusIcon = (status: BriefingRun['status']) => {
    switch (status) {
      case 'complete': return <CheckCircle className="icon-success" size={20} />;
      case 'failed': return <AlertTriangle className="icon-danger" size={20} />;
      default: return <Clock className="icon-primary is-pulsing" size={20} />;
    }
  };

  return (
    <div className="page">
      <div className="page-header page-header--responsive">
        <div>
          <h1 className="page-title">Briefing Runs</h1>
          <p className="page-description">History of your generated personal podcasts.</p>
        </div>
        <button
          onClick={handleGenerate}
          disabled={!canGenerate || isEnqueueing}
          aria-describedby="runs-generation-help"
          className="button button--primary"
        >
          <Play size={16} />
          {isEnqueueing ? 'Enqueueing...' : 'Sync and generate'}
        </button>
      </div>

      <p id="runs-generation-help" className="page-description">{generationHelp}</p>
      {loadError && <p role="alert" className="empty-state">{loadError}</p>}

      <div className="card">
        <div className="card-list">
          {runs.map(run => (
            <button
              type="button"
              key={run.id} 
              className="run-row"
              onClick={() => onNavigateToRun(run.id)}
            >
              <div className="run-row__main">
                <div className="run-row__status">
                  {getStatusIcon(run.status)}
                </div>
                <div>
                  <h3 className="run-row__title">{run.title}</h3>
                  <div className="run-row__meta">
                    <span className="run-row__status-text">{run.status.replace('_', ' ')}</span>
                    <span>•</span>
                    <span>Started {new Date(run.createdAt).toLocaleString()}</span>
                  </div>
                </div>
              </div>
              <div className="run-row__cta">
                View Details
              </div>
            </button>
          ))}
          {runs.length === 0 && (
            <div className="empty-state empty-state--large">
              <div className="empty-state__icon">
                <Play size={24} />
              </div>
              <h3 className="empty-state__title">No runs yet</h3>
              <p className="empty-state__copy">Create your first audio briefing from supplied material.</p>
              <button
                onClick={handleGenerate}
                disabled={!canGenerate || isEnqueueing}
                aria-describedby="runs-generation-help"
                className="button button--secondary"
              >
                {isEnqueueing ? 'Enqueueing...' : 'Sync and generate'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
