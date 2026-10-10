import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {useState} from 'react';
import {ArrowLeft, CheckCircle2, Clock, Download, FileText, Loader2, PlayCircle, RefreshCw, TriangleAlert} from 'lucide-react';
import {Link} from 'react-router-dom';
import {briefingService} from '../../services';
import type {BriefingRun} from '../../types';
import EpisodeChat from './EpisodeChat';

interface BriefingDetailProps {
  runId: string;
  onBack: () => void;
  onPlay: (run: BriefingRun) => void;
}

const safeUrl = (value?: string): string | undefined => {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
};

const generationSteps = [
  {id: 'queued', label: 'Queued'},
  {id: 'syncing', label: 'Synchronizing selected sources'},
  {id: 'selecting', label: 'Freezing supplied evidence'},
  {id: 'drafting', label: 'Drafting transcript'},
  {id: 'validating', label: 'Validating citations'},
  {id: 'rendering_audio', label: 'Synthesizing AI audio'},
] as const;

export default function BriefingDetailView({runId, onBack, onPlay}: BriefingDetailProps) {
  const queryClient = useQueryClient();
  const [retryError, setRetryError] = useState<string>();
  const episode = useQuery({
    queryKey: ['episode', runId],
    queryFn: () => briefingService.getRun(runId),
    refetchInterval: query => {
      const status = query.state.data?.status;
      return status && !['complete', 'failed'].includes(status) ? 1_000 : false;
    },
  });
  const retry = useMutation({
    mutationFn: () => briefingService.retryRun(runId),
    onSuccess: async run => {
      setRetryError(undefined);
      queryClient.setQueryData(['episode', runId], run);
      await queryClient.invalidateQueries({queryKey: ['episodes']});
      requestAnimationFrame(() => document.getElementById('generation-title')?.focus());
    },
    onError: (error: Error) => setRetryError(error.message),
  });

  if (episode.isLoading) return <p className="loading-message" role="status">Loading episode details...</p>;
  if (!episode.data) return <p className="empty-state" role="alert">This episode could not be loaded.</p>;
  const run = episode.data;
  const isGenerating = !['complete', 'failed'].includes(run.status);
  const currentStepIndex = generationSteps.findIndex(step => step.id === run.status);
  const currentStepLabel = generationSteps.find(step => step.id === run.status)?.label || run.status;
  const statusAnnouncement = run.status === 'complete'
    ? 'Generation complete. Transcript, citations, and audio are available.'
    : `Generation phase: ${currentStepLabel}.`;

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
      <button onClick={onBack} className="button button--plain"><ArrowLeft size={16} aria-hidden="true" /> Back to episodes</button>
      {run.status !== 'failed' && <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">{statusAnnouncement}</p>}
      {episode.isError && <p className="inline-notice" role="status">The API is temporarily unavailable. Showing the last persisted episode state while LocalCast reconnects.</p>}
      <div className="page-header">
        <div>
          <h1 tabIndex={-1} className="page-title">{run.title}</h1>
          <div className="detail-meta">
            <Clock size={16} aria-hidden="true" />
            <span>{new Date(run.createdAt).toLocaleString()}</span>
            {run.mode && <><span>•</span><span>{run.mode}</span></>}
            {run.status === 'complete' && <><span>•</span><CheckCircle2 size={16} aria-hidden="true" className="icon-success" /><span>Completed</span></>}
            {run.status === 'failed' && <><span>•</span><TriangleAlert size={16} aria-hidden="true" /><span>Failed</span></>}
          </div>
        </div>
        {run.status === 'complete' && <button onClick={exportJson} className="button button--secondary"><Download size={16} aria-hidden="true" /> Export JSON</button>}
      </div>

      {run.warnings && run.warnings.length > 0 && (
        <section className="card card--padded warning-card" aria-labelledby="source-warning-title">
          <h2 id="source-warning-title" className="card__title"><TriangleAlert size={18} aria-hidden="true" /> Source refresh warning</h2>
          <ul className="section-subgroup">
            {run.warnings.map((warning, index) => (
              <li key={`${warning.code}-${warning.sourceName}-${index}`}>
                <strong>{warning.sourceName}</strong>: {warning.message}
                <span className="field-help"> Code {warning.code}{warning.occurredAt ? ` · ${new Date(warning.occurredAt).toLocaleString()}` : ''}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {isGenerating && (
        <section className="card card--padded-lg generation-card" aria-labelledby="generation-title">
          <h2 id="generation-title" tabIndex={-1} className="generation-card__title"><Loader2 size={18} aria-hidden="true" className="icon-primary is-spinning" /> Generation in progress</h2>
          <ol className="steps">
            {generationSteps.map((step, index) => {
              const state = run.status === step.id ? 'active' : currentStepIndex > index ? 'past' : 'upcoming';
              return (
                <li key={step.id} className="step" data-state={state} aria-current={state === 'active' ? 'step' : undefined}>
                  <div className="step__marker" aria-hidden="true">{state === 'past' ? <CheckCircle2 size={16} /> : <div className="step__dot" />}</div>
                  <span className="step__label">{step.label}</span>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {run.status === 'failed' && (
        <section className="card card--padded-lg generation-failure" aria-labelledby="failure-title">
          <h2 id="failure-title" className="card__title">Generation failed</h2>
          <p role="alert">{run.job?.errorMessage || 'LocalCast could not complete this episode.'}</p>
          <p className="field-help">
            Code: {run.job?.errorCode || 'GENERATION_FAILED'} · failed during {run.job?.failedPhase || 'job validation'} · attempt {run.job?.attemptCount || 1} · {run.job?.retryable ? 'retryable' : 'this attempt cannot be retried'}
          </p>
          {run.job?.diagnosticReference && <p className="field-help">Diagnostic reference: {run.job.diagnosticReference}</p>}
          {run.job?.attempts && run.job.attempts.length > 0 && (
            <details>
              <summary>Attempt history</summary>
              <ol>
                {run.job.attempts.map(attempt => <li key={attempt.attemptNumber}>Attempt {attempt.attemptNumber}: {attempt.outcome}{attempt.errorCode ? ` (${attempt.errorCode})` : ''}</li>)}
              </ol>
            </details>
          )}
          {run.job?.retryable ? (
            <>
              {!run.job.evidenceFrozen && (
                <p className="inline-notice" role="note">
                  This retry occurs before evidence is frozen. Any selected RSS/Atom sources will be resynchronized; if generation continues, OpenAI receives the selected supplied material under the existing external-provider disclosure. LocalCast does not search the web.
                </p>
              )}
              <button className="button button--primary" disabled={retry.isPending} onClick={() => retry.mutate()}>
                <RefreshCw size={16} aria-hidden="true" /> {retry.isPending
                  ? 'Retrying...'
                  : run.job.evidenceFrozen ? 'Retry same evidence' : 'Retry before freezing evidence'}
              </button>
            </>
          ) : (
            <p>
              {run.job?.errorCode === 'INSUFFICIENT_SOURCE_MATERIAL'
                ? 'New or changed input is required: the supplied evidence is insufficient for this mode. '
                : run.job?.errorCode === 'INVALID_CITATIONS' || run.job?.errorCode === 'UNSUPPORTED_GENERATED_CLAIM'
                ? 'The generated output failed evidence validation; this does not establish that the supplied material is invalid. '
                : 'Review the failure and supplied material before starting again. '}
              <Link to="/stations">Review station and generation options.</Link> A new generation is a separate action and may incur provider costs. Nothing is retried automatically.
            </p>
          )}
          {retryError && <p role="alert" className="field-help">Retry could not be started: {retryError}</p>}
        </section>
      )}

      {run.status === 'complete' && run.audioAsset && (
        <>
          <section className="audio-ready-card" aria-labelledby="audio-title">
            <div className="audio-ready-card__content">
              <div className="audio-ready-card__header">
                <div className="audio-ready-card__label"><PlayCircle size={24} aria-hidden="true" /> <span id="audio-title">AI-generated LocalCast audio</span></div>
                <div className="audio-ready-card__badge">Validated MP3</div>
              </div>
              <p className="audio-ready-card__help">This voice and audio were generated by AI from the cited supplied material.</p>
              <div className="page-actions page-actions--wrap">
                <button className="button button--inverse button--pill" onClick={() => onPlay(run)}>Open player</button>
                <a className="button button--inverse button--pill" href={run.audioAsset.url} download={`localcast-${run.id}.mp3`}><Download size={16} aria-hidden="true" /> Download MP3</a>
              </div>
              <p className="audio-ready-card__help">
                {(run.audioAsset.durationMs / 1000).toFixed(1)} seconds · {run.audioAsset.byteLength?.toLocaleString()} bytes · {run.audioAsset.model} / {run.audioAsset.voice}
              </p>
              {run.providers && (
                <p className="audio-ready-card__help">Text: {run.providers.text.adapter} / {run.providers.text.model} · Speech: {run.providers.speech.adapter} / {run.providers.speech.model}{run.providers.speech.voice ? ` / ${run.providers.speech.voice}` : ''}</p>
              )}
            </div>
          </section>

          <section className="transcript-stack" aria-labelledby="transcript-heading">
            <h2 id="transcript-heading" className="section-heading"><FileText size={20} aria-hidden="true" className="icon-muted" /> Transcript & validated citations</h2>
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
                {(section.segments?.length ? section.segments : [{id: section.id, kind: 'transition' as const, text: section.spokenText, supportStatus: 'not_required' as const, speakerRole: 'host' as const, citations: []}]).map(segment => (
                  <div key={segment.id} className="transcript-quote">
                    {segment.speakerLabel && <p className="transcript-speaker">{segment.speakerLabel}</p>}
                    <p>{segment.text}</p>
                    {segment.citations.length > 0 && (
                      <ul className="section-subgroup" aria-label={`Validated citations for transcript segment ${segment.id}`}>
                        {segment.citations.map((citation, citationIndex) => {
                          const link = safeUrl(citation.originalUrl);
                          return (
                            <li key={`${citation.snapshotId}-${citationIndex}`}>
                              <strong>{citation.title}</strong> <span className="badge badge--primary">{citation.kind}</span>
                              <span> · {citation.sourceName}</span>
                              {citation.author && <span> · {citation.author}</span>}
                              {citation.publishedAt && <span> · <time dateTime={citation.publishedAt}>{new Date(citation.publishedAt).toLocaleString()}</time></span>}
                              <blockquote>{citation.excerpt}</blockquote>
                              {link && <a href={link} target="_blank" rel="noopener noreferrer">Open provenance for {citation.title}</a>}
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

          <EpisodeChat runId={run.id} />
        </>
      )}
    </div>
  );
}
