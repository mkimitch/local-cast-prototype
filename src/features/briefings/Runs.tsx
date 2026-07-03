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
      case 'complete': return <CheckCircle className="text-green-500" size={20} />;
      case 'failed': return <AlertTriangle className="text-red-500" size={20} />;
      default: return <Clock className="text-blue-500 animate-pulse" size={20} />;
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-semibold text-gray-900 dark:text-gray-50 tracking-tight">Briefing Runs</h1>
          <p className="mt-2 text-gray-500 dark:text-gray-400">History of your generated personal podcasts.</p>
        </div>
        <button
          onClick={handleGenerate}
          disabled={activeSourcesCount === 0}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 dark:bg-blue-500 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 transition-colors text-sm font-medium shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Play size={16} />
          Generate New
        </button>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {runs.map(run => (
            <div 
              key={run.id} 
              className="p-6 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer"
              onClick={() => onNavigateToRun(run.id)}
            >
              <div className="flex items-center gap-5">
                <div className="shrink-0 mt-1">
                  {getStatusIcon(run.status)}
                </div>
                <div>
                  <h3 className="text-lg font-medium text-gray-900 dark:text-gray-50">{run.title}</h3>
                  <div className="flex items-center gap-3 mt-1 text-sm text-gray-500 dark:text-gray-400">
                    <span className="capitalize">{run.status.replace('_', ' ')}</span>
                    <span>•</span>
                    <span>Started {new Date(run.createdAt).toLocaleString()}</span>
                  </div>
                </div>
              </div>
              <div className="text-blue-600 dark:text-blue-400 font-medium text-sm px-4 py-2 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/30">
                View Details
              </div>
            </div>
          ))}
          {runs.length === 0 && (
            <div className="p-12 text-center">
              <div className="w-12 h-12 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4 text-gray-400 dark:text-gray-500">
                <Play size={24} />
              </div>
              <h3 className="text-lg font-medium text-gray-900 dark:text-gray-50 mb-2">No runs yet</h3>
              <p className="text-gray-500 dark:text-gray-400 mb-6 max-w-md mx-auto">Generate your first audio briefing based on your active sources.</p>
              <button
                onClick={handleGenerate}
                disabled={activeSourcesCount === 0}
                className="px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 font-medium disabled:opacity-50"
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
