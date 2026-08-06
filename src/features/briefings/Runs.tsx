import {useQuery} from '@tanstack/react-query';
import {AlertTriangle, CheckCircle, Clock, Play} from 'lucide-react';
import {Link, useSearchParams} from 'react-router-dom';
import {briefingService} from '../../services';
import type {BriefingRun} from '../../types';

const statusIcon = (status: BriefingRun['status']) => {
  if (status === 'complete') return <CheckCircle aria-hidden="true" className="icon-success" size={20} />;
  if (status === 'failed') return <AlertTriangle aria-hidden="true" className="icon-danger" size={20} />;
  return <Clock aria-hidden="true" className="icon-primary is-pulsing" size={20} />;
};

export default function RunsView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const runs = useQuery({
    queryKey: ['episodes'],
    queryFn: () => briefingService.getRuns(),
    refetchInterval: query => query.state.data?.some(run => !['complete', 'failed'].includes(run.status)) ? 1_000 : false,
  });
  const statusFilter = searchParams.get('status') || 'all';
  const modeFilter = searchParams.get('mode') || 'all';
  const filteredRuns = (runs.data || []).filter(run => {
    const statusMatches = statusFilter === 'all'
      || statusFilter === run.status
      || statusFilter === 'running' && !['complete', 'failed'].includes(run.status);
    return statusMatches && (modeFilter === 'all' || modeFilter === run.mode);
  });
  const updateFilter = (name: 'status' | 'mode', value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value === 'all') next.delete(name);
    else next.set(name, value);
    setSearchParams(next);
  };

  return (
    <div className="page">
      <div className="page-header page-header--responsive">
        <div>
          <h1 tabIndex={-1} className="page-title">Episodes</h1>
          <p className="page-description">Durable generation history, cited transcripts, and persisted audio.</p>
        </div>
        <Link to="/stations" className="button button--primary"><Play size={16} /> Choose a station</Link>
      </div>

      {runs.isError && <p role="alert" className="empty-state">LocalCast could not load episodes from its local API.</p>}
      {runs.isLoading && <p role="status" className="loading-message">Loading episodes...</p>}

      <section className="card card--padded" aria-label="Episode filters">
        <div className="page-actions page-actions--wrap">
          <div className="field">
            <label className="form-label" htmlFor="episode-status-filter">Status</label>
            <select id="episode-status-filter" className="control" value={statusFilter} onChange={event => updateFilter('status', event.target.value)}>
              <option value="all">All statuses</option>
              <option value="running">In progress</option>
              <option value="complete">Complete</option>
              <option value="failed">Failed</option>
            </select>
          </div>
          <div className="field">
            <label className="form-label" htmlFor="episode-mode-filter">Mode</label>
            <select id="episode-mode-filter" className="control" value={modeFilter} onChange={event => updateFilter('mode', event.target.value)}>
              <option value="all">All modes</option>
              <option value="brief">Brief</option>
              <option value="deep">Deep</option>
            </select>
          </div>
        </div>
      </section>

      <div className="card">
        <div className="card-list">
          {filteredRuns.map(run => (
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
                    {run.providers?.text && <><span>•</span><span>{run.providers.text.adapter} / {run.providers.text.model}</span></>}
                    {run.warnings?.length ? <><span>•</span><span>{run.warnings.length} source warning{run.warnings.length === 1 ? '' : 's'}</span></> : null}
                    {run.status === 'failed' && run.job && <><span>•</span><span>{run.job.errorCode} · attempt {run.job.attemptCount}</span></>}
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
          {runs.data && runs.data.length > 0 && filteredRuns.length === 0 && (
            <div className="empty-state empty-state--large">
              <h2 className="empty-state__title">No episodes match these filters</h2>
              <p className="empty-state__copy">Change the status or mode filter to see other persisted runs.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
