import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import Sidebar from './components/layout/Sidebar';
import Dashboard from './features/dashboard/Dashboard';
import SourcesView from './features/sources/Sources';
import RunsView from './features/briefings/Runs';
import BriefingDetailView from './features/briefings/BriefingDetail';
import SettingsView from './features/settings/Settings';
import AudioPlayer from './features/audio/AudioPlayer';
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
    <div className={`app-shell${playingRun ? ' app-shell--with-player' : ''}`}>
      <Sidebar currentView={currentView} onNavigate={navigateTo} />
      
      <main className="app-main">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentView + (selectedRunId || '')}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="view-frame"
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
