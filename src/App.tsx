import {useEffect, useRef, useState, useLayoutEffect} from 'react';
import {AnimatePresence, motion, useReducedMotion} from 'motion/react';
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

const routeHeading = (pathname: string): string | undefined => {
  if (pathname === '/') return 'Dashboard';
  if (pathname === '/sources') return 'Sources';
  if (pathname.startsWith('/stations')) return 'Stations & Notes';
  if (pathname === '/episodes') return 'Episodes';
  if (pathname === '/settings') return 'Settings';
  return undefined;
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
  const prefersReducedMotion = useReducedMotion();
  const main = useRef<HTMLElement>(null);
  const priorPath = useRef(location.pathname);
  const pendingFocusPath = useRef<string | null>(null);
  const hasMountedRoute = useRef(false);
  const playerReturnFocus = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (priorPath.current === location.pathname) return;
    priorPath.current = location.pathname;
    pendingFocusPath.current = location.pathname;
  }, [location.pathname]);

  const focusCurrentRouteHeading = () => {
    if (pendingFocusPath.current !== location.pathname) return;
    const frame = [...(main.current?.querySelectorAll<HTMLElement>('[data-route-content]') || [])]
      .find(candidate => candidate.dataset.routeContent === location.pathname);
    const focusTarget = frame?.querySelector<HTMLElement>('h1');
    if (!focusTarget) return;
    const expectedHeading = routeHeading(location.pathname);
    if (expectedHeading && focusTarget.textContent?.trim() !== expectedHeading) return;
    focusTarget.focus();
    pendingFocusPath.current = null;
  };

  useEffect(() => {
    if (pendingFocusPath.current !== location.pathname) return;
    focusCurrentRouteHeading();
    if (pendingFocusPath.current !== location.pathname || !main.current) return;
    const observer = new MutationObserver(focusCurrentRouteHeading);
    observer.observe(main.current, {childList: true, subtree: true});
    let frames = 0;
    let frame = 0;
    const retryFocus = () => {
      focusCurrentRouteHeading();
      if (pendingFocusPath.current !== location.pathname) return;
      if (frames++ >= 90) {
        main.current?.focus();
        pendingFocusPath.current = null;
        return;
      }
      frame = requestAnimationFrame(retryFocus);
    };
    frame = requestAnimationFrame(retryFocus);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [location.pathname]);

  useEffect(() => {
    if (!hasMountedRoute.current) {
      hasMountedRoute.current = true;
      return;
    }
    const expectedHeading = routeHeading(location.pathname);
    if (!expectedHeading || !main.current) return;
    const focusExpectedHeading = () => {
      const heading = [...main.current?.querySelectorAll<HTMLElement>('h1') || []]
        .find(candidate => candidate.textContent?.trim() === expectedHeading);
      if (!heading) return false;
      heading.focus();
      return true;
    };
    if (focusExpectedHeading()) return;
    const observer = new MutationObserver(() => {
      if (focusExpectedHeading()) observer.disconnect();
    });
    observer.observe(main.current, {childList: true, subtree: true});
    return () => observer.disconnect();
  }, [location.pathname]);

  const navigateView = (view: ViewState) => navigate(viewPath[view]);
  const navigateRun = (id: string) => navigate(`/episodes/${encodeURIComponent(id)}`);
  const openPlayer = (run: BriefingRun) => {
    playerReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPlayingRun(run);
  };
  const closePlayer = () => {
    setPlayingRun(null);
    requestAnimationFrame(() => playerReturnFocus.current?.focus());
  };

  return (
    <div className={`app-shell${playingRun ? ' app-shell--with-player' : ''}`}>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <Sidebar />
      <main ref={main} id="main-content" tabIndex={-1} className="app-main">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={prefersReducedMotion ? false : {opacity: 0, y: 10}}
            animate={{opacity: 1, y: 0}}
            exit={prefersReducedMotion ? {opacity: 1} : {opacity: 0, y: -10}}
            transition={{duration: prefersReducedMotion ? 0 : 0.2}}
            className="view-frame"
            onAnimationComplete={() => {
              focusCurrentRouteHeading();
            }}
          >
            <div data-route-content={location.pathname}>
              <Routes location={location}>
                <Route path="/" element={<Dashboard onNavigateToRun={navigateRun} onNavigate={navigateView} />} />
                <Route path="/sources" element={<SourcesView />} />
                <Route path="/stations" element={<StationsView />} />
                <Route path="/stations/:stationId" element={<StationsView />} />
                <Route path="/episodes" element={<RunsView />} />
                <Route path="/episodes/:runId" element={<EpisodeRoute onPlay={openPlayer} />} />
                <Route path="/settings" element={<SettingsView />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </div>
          </motion.div>
        </AnimatePresence>
      </main>
      {playingRun && <AudioPlayer run={playingRun} onClose={closePlayer} />}
    </div>
  );
}
