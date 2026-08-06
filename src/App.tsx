import {useState} from 'react';
import {AnimatePresence, motion} from 'motion/react';
import {Navigate, Route, Routes, useLocation, useNavigate, useParams} from 'react-router-dom';
import Sidebar from './components/layout/Sidebar';
import AudioPlayer from './features/audio/AudioPlayer';
import BriefingDetailView from './features/briefings/BriefingDetail';
import RunsView from './features/briefings/Runs';
import Dashboard from './features/dashboard/Dashboard';
import SettingsView from './features/settings/Settings';
import SourcesView from './features/sources/Sources';
import StationsView from './features/stations/Stations';
import {useAppearanceSettings} from './hooks/useAppearanceSettings';
import type {BriefingRun} from './types';

export type ViewState = 'dashboard' | 'sources' | 'stations' | 'runs' | 'settings';

const viewPath: Record<ViewState, string> = {
  dashboard: '/',
  sources: '/sources',
  stations: '/stations',
  runs: '/episodes',
  settings: '/settings',
};

const EpisodeRoute = ({onPlay}: {onPlay: (run: BriefingRun) => void}) => {
  const navigate = useNavigate();
  const {runId = ''} = useParams();
  return <BriefingDetailView runId={runId} onBack={() => navigate('/episodes')} onPlay={onPlay} />;
};

export default function App() {
  useAppearanceSettings();
  const location = useLocation();
  const navigate = useNavigate();
  const [playingRun, setPlayingRun] = useState<BriefingRun | null>(null);

  const navigateView = (view: ViewState) => navigate(viewPath[view]);
  const navigateRun = (id: string) => navigate(`/episodes/${encodeURIComponent(id)}`);

  return (
    <div className={`app-shell${playingRun ? ' app-shell--with-player' : ''}`}>
      <Sidebar />
      <main className="app-main">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{opacity: 0, y: 10}}
            animate={{opacity: 1, y: 0}}
            exit={{opacity: 0, y: -10}}
            transition={{duration: 0.2}}
            className="view-frame"
          >
            <Routes location={location}>
              <Route path="/" element={<Dashboard onNavigateToRun={navigateRun} onNavigate={navigateView} />} />
              <Route path="/sources" element={<SourcesView />} />
              <Route path="/stations" element={<StationsView />} />
              <Route path="/stations/:stationId" element={<StationsView />} />
              <Route path="/episodes" element={<RunsView />} />
              <Route path="/episodes/:runId" element={<EpisodeRoute onPlay={setPlayingRun} />} />
              <Route path="/settings" element={<SettingsView />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </motion.div>
        </AnimatePresence>
      </main>
      {playingRun && <AudioPlayer run={playingRun} onClose={() => setPlayingRun(null)} />}
    </div>
  );
}
