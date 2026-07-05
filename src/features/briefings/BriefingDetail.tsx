import { useEffect, useState } from 'react';
import { ArrowLeft, PlayCircle, Clock, CheckCircle2, FileText, Loader2, Play, Download } from 'lucide-react';
import { briefingService } from '../../services';
import { BriefingRun } from '../../types';

interface BriefingDetailProps {
  runId: string;
  onBack: () => void;
  onPlay: (run: BriefingRun) => void;
}

export default function BriefingDetailView({ runId, onBack, onPlay }: BriefingDetailProps) {
  const [run, setRun] = useState<BriefingRun | null>(null);

  useEffect(() => {
    // Initial fetch
    briefingService.getRun(runId).then(r => r && setRun(r));

    // Polling while active
    const interval = setInterval(async () => {
      const updated = await briefingService.getRun(runId);
      if (updated) {
        setRun(updated);
        if (updated.status === 'complete' || updated.status === 'failed') {
          clearInterval(interval);
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [runId]);

  if (!run) return <div className="loading-message">Loading run details...</div>;

  const isGenerating = run.status !== 'complete' && run.status !== 'failed';

  const steps = [
    { id: 'gathering', label: 'Gathering Sources' },
    { id: 'summarizing_sources', label: 'Summarizing Sources' },
    { id: 'drafting', label: 'Drafting Transcript' },
    { id: 'rendering_audio', label: 'Synthesizing Audio' }
  ];

  const currentStepIndex = steps.findIndex(s => s.id === run.status);

  const exportJson = () => {
    if (!run) return;
    const dataStr = JSON.stringify(run, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `briefing-${run.id}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page page--with-player-space">
      <button 
        onClick={onBack}
        className="button button--plain"
      >
        <ArrowLeft size={16} />
        Back to Runs
      </button>

      <div className="page-header">
        <div>
          <h1 className="page-title">{run.title}</h1>
          <div className="detail-meta">
            <Clock size={16} />
            <span>{new Date(run.createdAt).toLocaleString()}</span>
            {run.completedAt && (
              <>
                <span>•</span>
                <CheckCircle2 size={16} className="icon-success" />
                <span>Completed</span>
              </>
            )}
          </div>
        </div>
        
        {run.status === 'complete' && (
          <button
            onClick={exportJson}
            className="button button--secondary"
          >
            <Download size={16} />
            Export JSON
          </button>
        )}
      </div>

      {isGenerating && (
        <div className="card card--padded-lg generation-card">
          <h3 className="generation-card__title">
            <Loader2 size={18} className="icon-primary is-spinning" />
            Generation in Progress
          </h3>
          <div className="steps">
            <div className="steps__track"></div>
            {steps.map((step, idx) => {
              const isActive = run.status === step.id;
              const isPast = currentStepIndex > idx || run.status === 'complete';
              const stepState = isActive ? 'active' : isPast ? 'past' : 'upcoming';
              
              return (
                <div key={step.id} className="step" data-state={stepState}>
                  <div className="step__marker">
                    {isPast ? <CheckCircle2 size={16} /> : <div className="step__dot" />}
                  </div>
                  <span className="step__label">
                    {step.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {run.status === 'complete' && (
        <>
          <div className="audio-ready-card">
            <div className="audio-ready-card__content">
              <div className="audio-ready-card__header">
                <div className="audio-ready-card__label">
                  <PlayCircle size={24} />
                  Audio Briefing Ready
                </div>
                <div className="audio-ready-card__badge">
                  Placeholder Audio
                </div>
              </div>
              
              <div className="audio-ready-card__body">
                <div>
                  <h3 className="audio-ready-card__title">{run.title}</h3>
                  <p className="audio-ready-card__summary">{run.summary}</p>
                </div>
                
                <button 
                  onClick={() => onPlay(run)}
                  className="button button--inverse button--pill"
                >
                  <Play size={20} />
                  Play Full Briefing
                </button>
              </div>
            </div>
          </div>

          {run.summary && (
            <div className="summary-card">
              <h3 className="summary-card__title">Briefing Summary</h3>
              <p className="summary-card__copy">{run.summary}</p>
            </div>
          )}

          <div className="transcript-stack">
            <h2 className="section-heading">
              <FileText size={20} className="icon-muted" />
              Transcript & References
            </h2>
            
            {run.sections.map((section, idx) => (
              <div key={section.id} className="card transcript-section">
                {section.importanceScore >= 8 && (
                   <div className="badge badge--warning badge--pill importance-badge">
                     Important
                   </div>
                )}
                <div className="transcript-section__header">
                  <div className="transcript-section__title-row">
                    <span className="transcript-section__number">
                      {idx + 1}
                    </span>
                    <div>
                      <h3 className="transcript-section__title">{section.title}</h3>
                      <span className="transcript-section__type">{section.type.replace('_', ' ')}</span>
                    </div>
                  </div>
                </div>
                <div className="transcript-quote">
                  <p>"{section.spokenText}"</p>
                </div>
                
                {section.sourceItemIds.length > 0 && (
                  <div className="section-subgroup">
                    <h4 className="section-subgroup__title">Sources Referenced</h4>
                    <div className="chip-list">
                      {section.sourceItemIds.map(srcId => (
                        <span key={srcId} className="chip">
                          {srcId}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {section.followUpPrompts && section.followUpPrompts.length > 0 && (
                  <div className="section-subgroup">
                    <h4 className="section-subgroup__title section-subgroup__title--primary">Follow-up Questions</h4>
                    <div className="follow-up-list">
                      {section.followUpPrompts.map((prompt, pIdx) => (
                        <button key={pIdx} className="follow-up-button">
                          &rarr; {prompt}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
