import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import Sidebar from './components/Sidebar';
import Dashboard from './views/Dashboard';
import SourcesView from './views/Sources';
import RunsView from './views/Runs';
import BriefingDetailView from './views/BriefingDetail';
import SettingsView from './views/Settings';
import AudioPlayer from './components/AudioPlayer';
import { BriefingRun } from './types';
import { useAppearanceSettings } from './hooks/useAppearanceSettings';

export type ViewState = 'dashboard' | 'sources' | 'runs' | 'settings';

export default function App() {
  useAppearanceSettings();
  
  const [currentView, setCurrentView] = useState<ViewState>('dashboard');
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [playingRun, setPlayingRun] = useState<BriefingRun | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const navigateTo = (view: ViewState) => {
    setCurrentView(view);
    setSelectedRunId(null);
  };

  const navigateToRun = (id: string) => {
    setCurrentView('runs');
    setSelectedRunId(id);
  };

  const handlePlayRun = (run: BriefingRun) => {
    setPlayingRun(run);
    setIsPlaying(true);
  };

  return (
    <div className={`flex h-screen w-full overflow-hidden font-sans bg-gray-50 dark:bg-gray-950 transition-all ${playingRun ? 'pb-20' : ''}`}>
      <Sidebar currentView={currentView} onNavigate={navigateTo} />
      
      <main className="flex-1 overflow-y-auto relative">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentView + (selectedRunId || '')}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="min-h-full p-8"
          >
            {currentView === 'dashboard' && <Dashboard onNavigateToRun={navigateToRun} onNavigate={navigateTo} />}
            {currentView === 'sources' && <SourcesView />}
            {currentView === 'runs' && !selectedRunId && <RunsView onNavigateToRun={navigateToRun} />}
            {currentView === 'runs' && selectedRunId && <BriefingDetailView runId={selectedRunId} onBack={() => setSelectedRunId(null)} onPlay={handlePlayRun} />}
            {currentView === 'settings' && <SettingsView />}
          </motion.div>
        </AnimatePresence>
      </main>

      {playingRun && (
        <AudioPlayer 
          run={playingRun}
          isPlaying={isPlaying}
          onTogglePlay={() => setIsPlaying(!isPlaying)}
          onClose={() => { setPlayingRun(null); setIsPlaying(false); }}
        />
      )}
    </div>
  );
}
