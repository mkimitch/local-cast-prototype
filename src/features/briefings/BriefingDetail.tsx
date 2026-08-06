import {useQuery} from '@tanstack/react-query';
import {useState} from 'react';
import {ArrowLeft, CheckCircle2, Clock, Download, FileText, Loader2, PlayCircle} from 'lucide-react';
import {briefingService} from '../../services';
import type {BriefingRun} from '../../types';

interface BriefingDetailProps {
  runId: string;
  onBack: () => void;
  onPlay: (run: BriefingRun) => void;
}

const safeUrl = (value?: string): string | undefined => {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
};

export default function BriefingDetailView({runId, onBack, onPlay}: BriefingDetailProps) {
  const [mediaError, setMediaError] = useState(false);
  const episode = useQuery({
    queryKey: ['episode', runId],
    queryFn: () => briefingService.getRun(runId),
    refetchInterval: query => {
      const status = query.state.data?.status;
      return status && !['complete', 'failed'].includes(status) ? 1_000 : false;
    },
  });

  if (episode.isLoading) return <p className="loading-message" role="status">Loading episode details...</p>;
  if (episode.isError || !episode.data) return <p className="empty-state" role="alert">This episode could not be loaded.</p>;
  const run = episode.data;
  const isGenerating = !['complete', 'failed'].includes(run.status);
  const steps = [
    {id: 'queued', label: 'Queued'},
    {id: 'syncing', label: 'Synchronizing selected sources'},
    {id: 'selecting', label: 'Freezing supplied evidence'},
    {id: 'drafting', label: 'Drafting transcript'},
    {id: 'validating', label: 'Validating citations'},
    {id: 'rendering_audio', label: 'Synthesizing AI audio'},
  ];
  const currentStepIndex = steps.findIndex(step => step.id === run.status);
  const currentStepLabel = steps.find(step => step.id === run.status)?.label || run.status;

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(run, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `localcast-${run.id}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page page--with-player-space">
      <button onClick={onBack} className="button button--plain"><ArrowLeft size={16} /> Back to episodes</button>
      <div className="page-header">
        <div>
          <h1 className="page-title">{run.title}</h1>
          <div className="detail-meta">
            <Clock size={16} />
            <span>{new Date(run.createdAt).toLocaleString()}</span>
            {run.mode && <><span>•</span><span>{run.mode}</span></>}
            {run.completedAt && <><span>•</span><CheckCircle2 size={16} className="icon-success" /><span>Completed</span></>}
          </div>
        </div>
        {run.status === 'complete' && <button onClick={exportJson} className="button button--secondary"><Download size={16} /> Export JSON</button>}
      </div>

      {isGenerating && (
        <section className="card card--padded-lg generation-card" aria-labelledby="generation-title">
          <p role="status" aria-live="polite" className="sr-only">Generation phase: {currentStepLabel}</p>
          <h2 id="generation-title" className="generation-card__title"><Loader2 size={18} className="icon-primary is-spinning" /> Generation in progress</h2>
          <div className="steps">
            <div className="steps__track" />
            {steps.map((step, index) => {
              const state = run.status === step.id ? 'active' : currentStepIndex > index ? 'past' : 'upcoming';
              return (
                <div key={step.id} className="step" data-state={state}>
                  <div className="step__marker">{state === 'past' ? <CheckCircle2 size={16} /> : <div className="step__dot" />}</div>
                  <span className="step__label">{step.label}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {run.status === 'failed' && (
        <section className="card card--padded-lg" role="alert">
          <h2 className="card__title">Generation failed</h2>
          <p>{run.job?.errorMessage || 'LocalCast could not complete this episode.'}</p>
          <p className="field-help">Code: {run.job?.errorCode || 'GENERATION_FAILED'} · failed during {run.job?.failedPhase || 'job validation'} · attempt {run.job?.attemptCount || 1} · {run.job?.retryable ? 'retryable' : 'new or changed input required'}</p>
        </section>
      )}

      {run.status === 'complete' && run.audioAsset && (
        <>
          <section className="audio-ready-card" aria-labelledby="audio-title">
            <div className="audio-ready-card__content">
              <div className="audio-ready-card__header">
                <div className="audio-ready-card__label"><PlayCircle size={24} /> <span id="audio-title">AI-generated LocalCast audio</span></div>
                <div className="audio-ready-card__badge">Validated MP3</div>
              </div>
              <p className="field-help">This voice and audio were generated by AI from the cited supplied material.</p>
              <audio
                controls
                preload="metadata"
                src={run.audioAsset.url}
                aria-label={`Play AI-generated episode ${run.title}`}
                onError={() => setMediaError(true)}
                onLoadedMetadata={() => setMediaError(false)}
              >
                Your browser does not support audio playback.
              </audio>
              {mediaError && <p role="alert" className="field-help">Playback failed. The validated transcript and citations remain available below.</p>}
              <button className="button button--inverse button--pill" onClick={() => onPlay(run)}>Open persistent player</button>
              <p className="field-help">
                {(run.audioAsset.durationMs / 1000).toFixed(1)} seconds · {run.audioAsset.byteLength?.toLocaleString()} bytes · {run.audioAsset.model} / {run.audioAsset.voice}
              </p>
            </div>
          </section>

          <section className="transcript-stack" aria-labelledby="transcript-heading">
            <h2 id="transcript-heading" className="section-heading"><FileText size={20} className="icon-muted" /> Transcript & validated citations</h2>
            {run.sections.map((section, sectionIndex) => (
              <article key={section.id} className="card transcript-section">
                <div className="transcript-section__header">
                  <div className="transcript-section__title-row">
                    <span className="transcript-section__number">{sectionIndex + 1}</span>
                    <div>
                      <h3 className="transcript-section__title">{section.title}</h3>
                      <span className="transcript-section__type">{section.type.replace('_', ' ')}</span>
                    </div>
                  </div>
                </div>
                {(section.segments?.length ? section.segments : [{id: section.id, kind: 'transition' as const, text: section.spokenText, supportStatus: 'not_required' as const, citations: []}]).map(segment => (
                  <div key={segment.id} className="transcript-quote">
                    <p>{segment.text}</p>
                    {segment.citations.length > 0 && (
                      <ul className="section-subgroup" aria-label="Validated citations">
                        {segment.citations.map((citation, citationIndex) => {
                          const link = safeUrl(citation.originalUrl);
                          return (
                            <li key={`${citation.snapshotId}-${citationIndex}`}>
                              <strong>{citation.title}</strong> <span className="badge badge--primary">{citation.kind}</span>
                              {citation.author && <span> · {citation.author}</span>}
                              <blockquote>{citation.excerpt}</blockquote>
                              {link && <a href={link} target="_blank" rel="noreferrer">Open original provenance</a>}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                ))}
              </article>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
