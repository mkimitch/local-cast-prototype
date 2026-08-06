import {useQuery} from '@tanstack/react-query';
import {AlertTriangle, CheckCircle, Clock, Play} from 'lucide-react';
import {Link} from 'react-router-dom';
import {briefingService} from '../../services';
import type {BriefingRun} from '../../types';

const statusIcon = (status: BriefingRun['status']) => {
  if (status === 'complete') return <CheckCircle className="icon-success" size={20} />;
  if (status === 'failed') return <AlertTriangle className="icon-danger" size={20} />;
  return <Clock className="icon-primary is-pulsing" size={20} />;
};

export default function RunsView() {
  const runs = useQuery({
    queryKey: ['episodes'],
    queryFn: () => briefingService.getRuns(),
    refetchInterval: query => query.state.data?.some(run => !['complete', 'failed'].includes(run.status)) ? 1_000 : false,
  });

  return (
    <div className="page">
      <div className="page-header page-header--responsive">
        <div>
          <h1 className="page-title">Episodes</h1>
          <p className="page-description">Durable generation history, cited transcripts, and persisted audio.</p>
        </div>
        <Link to="/stations" className="button button--primary"><Play size={16} /> Choose a station</Link>
      </div>

      {runs.isError && <p role="alert" className="empty-state">LocalCast could not load episodes from its local API.</p>}
      {runs.isLoading && <p role="status" className="loading-message">Loading episodes...</p>}

      <div className="card">
        <div className="card-list">
          {runs.data?.map(run => (
            <Link key={run.id} className="run-row" to={`/episodes/${encodeURIComponent(run.id)}`}>
              <div className="run-row__main">
                <div className="run-row__status">{statusIcon(run.status)}</div>
                <div>
                  <h2 className="run-row__title">{run.title}</h2>
                  <div className="run-row__meta">
                    <span className="run-row__status-text">{run.status.replace('_', ' ')}</span>
                    {run.mode && <><span>•</span><span>{run.mode}</span></>}
                    <span>•</span>
                    <span>Started {new Date(run.createdAt).toLocaleString()}</span>
                  </div>
                </div>
              </div>
              <span className="run-row__cta">View details</span>
            </Link>
          ))}
          {runs.data?.length === 0 && (
            <div className="empty-state empty-state--large">
              <Play size={24} />
              <h2 className="empty-state__title">No episodes yet</h2>
              <p className="empty-state__copy">Save supplied material and generate from a station.</p>
              <Link to="/stations" className="button button--secondary">Open stations & notes</Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
