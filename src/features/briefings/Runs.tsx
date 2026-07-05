import { useEffect, useState } from 'react';
import { Play, Clock, CheckCircle, AlertTriangle } from 'lucide-react';
import { briefingService, sourceService } from '../../services';
import { BriefingRun, Source } from '../../types';

interface RunsProps {
  onNavigateToRun: (id: string) => void;
}

export default function RunsView({ onNavigateToRun }: RunsProps) {
  const [runs, setRuns] = useState<BriefingRun[]>([]);
  const [activeSourcesCount, setActiveSourcesCount] = useState(0);

  const loadData = async () => {
    const [allRuns, allSources] = await Promise.all([
      briefingService.getRuns(),
      sourceService.getSources()
    ]);
    setRuns(allRuns);
    setActiveSourcesCount(allSources.filter(s => s.isActive).length);
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
    const allSources = await sourceService.getSources();
    const activeSourceIds = allSources.filter(s => s.isActive).map(s => s.id);
    const newRun = await briefingService.startRun(activeSourceIds);
    onNavigateToRun(newRun.id);
  };

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
          disabled={activeSourcesCount === 0}
          className="button button--primary"
        >
          <Play size={16} />
          Generate New
        </button>
      </div>

      <div className="card">
        <div className="card-list">
          {runs.map(run => (
            <div 
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
            </div>
          ))}
          {runs.length === 0 && (
            <div className="empty-state empty-state--large">
              <div className="empty-state__icon">
                <Play size={24} />
              </div>
              <h3 className="empty-state__title">No runs yet</h3>
              <p className="empty-state__copy">Generate your first audio briefing based on your active sources.</p>
              <button
                onClick={handleGenerate}
                disabled={activeSourcesCount === 0}
                className="button button--secondary"
              >
                Start Generating
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
