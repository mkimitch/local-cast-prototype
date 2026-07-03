import { useEffect, useState, useRef } from 'react';
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

  if (!run) return <div className="p-8">Loading run details...</div>;

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
    <div className="max-w-4xl mx-auto space-y-8 pb-24">
      <button 
        onClick={onBack}
        className="flex items-center gap-2 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
      >
        <ArrowLeft size={16} />
        Back to Runs
      </button>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-semibold text-gray-900 dark:text-gray-50 tracking-tight">{run.title}</h1>
          <div className="flex items-center gap-3 mt-3 text-sm text-gray-500 dark:text-gray-400">
            <Clock size={16} />
            <span>{new Date(run.createdAt).toLocaleString()}</span>
            {run.completedAt && (
              <>
                <span>•</span>
                <CheckCircle2 size={16} className="text-green-500" />
                <span>Completed</span>
              </>
            )}
          </div>
        </div>
        
        {run.status === 'complete' && (
          <button
            onClick={exportJson}
            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm font-medium shadow-sm whitespace-nowrap"
          >
            <Download size={16} />
            Export JSON
          </button>
        )}
      </div>

      {isGenerating && (
        <div className="bg-white dark:bg-gray-900 p-8 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm">
          <h3 className="font-medium text-gray-900 dark:text-gray-50 mb-6 flex items-center gap-2">
            <Loader2 size={18} className="animate-spin text-blue-600 dark:text-blue-500" />
            Generation in Progress
          </h3>
          <div className="flex items-center justify-between relative">
            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-full h-1 bg-gray-100 dark:bg-gray-800 rounded-full"></div>
            {steps.map((step, idx) => {
              const isActive = run.status === step.id;
              const isPast = currentStepIndex > idx || run.status === 'complete';
              
              return (
                <div key={step.id} className="relative flex flex-col items-center gap-3 bg-white dark:bg-gray-900 px-4">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center z-10 transition-colors ${
                    isActive ? 'bg-blue-600 text-white ring-4 ring-blue-50 dark:ring-blue-900/30' :
                    isPast ? 'bg-green-500 text-white' : 'bg-gray-200 dark:bg-gray-800 text-gray-400 dark:text-gray-500'
                  }`}>
                    {isPast ? <CheckCircle2 size={16} /> : <div className="w-2.5 h-2.5 rounded-full bg-current" />}
                  </div>
                  <span className={`text-sm font-medium whitespace-nowrap ${isActive ? 'text-blue-700 dark:text-blue-400' : isPast ? 'text-gray-900 dark:text-gray-50' : 'text-gray-400 dark:text-gray-500'}`}>
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
          <div className="bg-gradient-to-br from-blue-900 to-slate-900 rounded-2xl p-8 text-white shadow-lg overflow-hidden relative">
            {/* Ambient decoration */}
            <div className="absolute -top-24 -right-24 w-64 h-64 bg-blue-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20"></div>
            <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-indigo-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20"></div>
            
            <div className="relative z-10">
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3 text-blue-200 font-medium">
                  <PlayCircle size={24} />
                  Audio Briefing Ready
                </div>
                <div className="px-3 py-1 bg-white/10 rounded-full text-xs font-medium backdrop-blur-sm">
                  Placeholder Audio
                </div>
              </div>
              
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-2xl font-bold text-white mb-2">{run.title}</h3>
                  <p className="text-blue-200 text-sm max-w-md line-clamp-2">{run.summary}</p>
                </div>
                
                <button 
                  onClick={() => onPlay(run)}
                  className="px-6 py-3 bg-white text-blue-900 rounded-full flex items-center gap-2 hover:scale-105 transition-transform shadow-xl font-semibold"
                >
                  <Play size={20} className="ml-0.5" />
                  Play Full Briefing
                </button>
              </div>
            </div>
          </div>

          {run.summary && (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-900/50 p-6 rounded-xl text-blue-900 dark:text-blue-100 shadow-sm">
              <h3 className="font-semibold mb-2">Briefing Summary</h3>
              <p className="text-sm leading-relaxed text-blue-800 dark:text-blue-200">{run.summary}</p>
            </div>
          )}

          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-50 flex items-center gap-2">
              <FileText size={20} className="text-gray-400 dark:text-gray-500" />
              Transcript & References
            </h2>
            
            {run.sections.map((section, idx) => (
              <div key={section.id} className="bg-white dark:bg-gray-900 p-8 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm relative">
                {section.importanceScore >= 8 && (
                   <div className="absolute top-0 right-8 -translate-y-1/2 bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-400 text-xs font-bold px-3 py-1 rounded-full border border-amber-200 dark:border-amber-800">
                     Important
                   </div>
                )}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-4">
                    <span className="w-8 h-8 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-display font-bold flex items-center justify-center text-sm">
                      {idx + 1}
                    </span>
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-50">{section.title}</h3>
                      <span className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">{section.type.replace('_', ' ')}</span>
                    </div>
                  </div>
                </div>
                <div className="prose prose-blue dark:prose-invert max-w-none text-gray-700 dark:text-gray-300 leading-relaxed mb-6 bg-gray-50 dark:bg-gray-800/50 p-6 rounded-lg border border-gray-100 dark:border-gray-800 italic">
                  <p>"{section.spokenText}"</p>
                </div>
                
                {section.sourceItemIds.length > 0 && (
                  <div className="pt-6 border-t border-gray-100 dark:border-gray-800">
                    <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">Sources Referenced</h4>
                    <div className="flex flex-wrap gap-2">
                      {section.sourceItemIds.map(srcId => (
                        <span key={srcId} className="px-2.5 py-1.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md text-xs font-medium text-gray-600 dark:text-gray-400">
                          {srcId}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {section.followUpPrompts && section.followUpPrompts.length > 0 && (
                  <div className="pt-6 mt-6 border-t border-gray-100 dark:border-gray-800">
                    <h4 className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider mb-3">Follow-up Questions</h4>
                    <div className="space-y-2">
                      {section.followUpPrompts.map((prompt, pIdx) => (
                        <button key={pIdx} className="block w-full text-left px-4 py-2.5 bg-blue-50/50 dark:bg-blue-900/10 hover:bg-blue-50 dark:hover:bg-blue-900/20 border border-blue-100 dark:border-blue-900/30 rounded-lg text-sm text-blue-800 dark:text-blue-300 font-medium transition-colors">
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
