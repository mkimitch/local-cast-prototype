import { useState, useEffect } from 'react';
import { Play, Pause, SkipBack, SkipForward, X, Volume2, Maximize2, Minimize2 } from 'lucide-react';
import { BriefingRun } from '../../types';
import OrbVisualizer, { ORB_THEMES, OrbThemeName } from './OrbVisualizer';
import { providerService } from '../../services';

interface AudioPlayerProps {
  run: BriefingRun;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onClose: () => void;
}

export default function AudioPlayer({ run, isPlaying, onTogglePlay, onClose }: AudioPlayerProps) {
  const [progress, setProgress] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [isExpanded, setIsExpanded] = useState(false);
  const [orbTheme, setOrbTheme] = useState<OrbThemeName>('amber');
  const [audioData, setAudioData] = useState({ level: 0, frequencies: [0,0,0] as [number,number,number] });

  useEffect(() => {
    providerService.getSettings().then(settings => {
      if (settings.orbTheme) {
        setOrbTheme(settings.orbTheme as OrbThemeName);
      }
    });
  }, [isExpanded]);

  useEffect(() => {
    let interval: any;
    if (isPlaying) {
      interval = setInterval(() => {
        setProgress(p => {
          const next = p + (0.5 * playbackSpeed);
          return next >= 100 ? 100 : next;
        });
      }, 500);
    }
    return () => clearInterval(interval);
  }, [isPlaying, playbackSpeed]);

  useEffect(() => {
    if (progress >= 100 && isPlaying) {
      onTogglePlay();
      setTimeout(() => setProgress(0), 100);
    }
  }, [progress, isPlaying, onTogglePlay]);

  useEffect(() => {
    if (isPlaying && isExpanded) {
      let t = 0;
      const audioInterval = setInterval(() => {
        t += 0.1;
        // Generate synthetic audio data for visualizer
        const baseLevel = Math.sin(t) * 0.3 + 0.3;
        const spike = Math.random() > 0.8 ? Math.random() * 0.5 : 0;
        const level = Math.max(0, Math.min(1, baseLevel + spike));
        
        const low = Math.max(0, Math.min(1, Math.sin(t * 0.5) * 0.5 + 0.5));
        const mid = Math.max(0, Math.min(1, Math.cos(t * 2) * 0.5 + spike));
        const high = Math.max(0, Math.min(1, Math.sin(t * 5) * 0.5 + spike * 1.5));
        
        setAudioData({ level, frequencies: [low, mid, high] });
      }, 50);
      return () => clearInterval(audioInterval);
    } else {
       setAudioData({ level: 0, frequencies: [0,0,0] });
    }
  }, [isPlaying, isExpanded]);

  const formatDuration = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const durationStr = run.audioAsset ? formatDuration(run.audioAsset.durationMs) : '0:00';

  return (
    <>
      {isExpanded && (
        <div className="fixed inset-0 z-[60] flex flex-col animate-in fade-in duration-300" style={{ backgroundColor: ORB_THEMES[orbTheme].background }}>
          <div className="absolute inset-0 z-0">
            <OrbVisualizer 
              isActive={isPlaying} 
              audioLevel={audioData.level} 
              frequencies={audioData.frequencies}
              theme={orbTheme}
              className="w-full h-full"
            />
          </div>
          
          <div className="relative z-10 flex-1 flex flex-col justify-between p-6 md:p-12 pointer-events-none">
            <div className="flex justify-between items-start w-full pointer-events-auto">
              <div className="text-white max-w-2xl">
                <h2 className="text-3xl md:text-4xl font-display font-bold mb-2">{run.title}</h2>
                <p className="text-white/70 text-lg line-clamp-2">{run.summary}</p>
              </div>
              <div className="flex items-center gap-4">
                <button onClick={() => setIsExpanded(false)} className="p-3 bg-white/5 hover:bg-white/10 backdrop-blur-md rounded-full text-white transition-colors">
                  <Minimize2 size={24} />
                </button>
              </div>
            </div>
            
            <div className="w-full max-w-3xl mx-auto pb-8 pointer-events-auto">
              <div className="flex flex-col items-center gap-8">
                <div className="w-full flex items-center gap-4 text-sm font-medium text-white/60">
                  <span>0:00</span>
                  <div className="flex-1 h-1.5 bg-black/40 backdrop-blur-sm rounded-full overflow-hidden cursor-pointer border border-white/5">
                    <div 
                      className="h-full rounded-full transition-all duration-500 relative shadow-[0_0_10px_rgba(255,255,255,0.5)]"
                      style={{ width: `${progress}%`, backgroundColor: ORB_THEMES[orbTheme].core }}
                    ></div>
                  </div>
                  <span>{durationStr}</span>
                </div>
                
                <div className="flex items-center gap-8">
                  <button className="text-white/60 hover:text-white transition-colors"><SkipBack size={28} /></button>
                  <button 
                    onClick={onTogglePlay}
                    className="w-20 h-20 bg-white rounded-full flex items-center justify-center hover:scale-105 transition-transform"
                    style={{ 
                      color: ORB_THEMES[orbTheme].background,
                      boxShadow: `0 0 40px color-mix(in oklch, ${ORB_THEMES[orbTheme].accent} 20%, transparent)`
                    }}
                  >
                    {isPlaying ? <Pause size={32} /> : <Play size={32} className="ml-1" />}
                  </button>
                  <button className="text-white/60 hover:text-white transition-colors"><SkipForward size={28} /></button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className={`fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 shadow-[0_-4px_20px_-10px_rgba(0,0,0,0.1)] transition-transform duration-300 ${isExpanded ? 'translate-y-full' : 'translate-y-0'}`}>
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          
          <div className="flex items-center gap-4 w-1/4 min-w-[200px]">
            <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-lg flex items-center justify-center shrink-0 shadow-sm relative overflow-hidden group">
               {isPlaying ? (
                 <OrbVisualizer 
                  isActive={isPlaying} 
                  audioLevel={audioData.level} 
                  frequencies={audioData.frequencies}
                  theme={orbTheme}
                  className="w-full h-full opacity-60 group-hover:opacity-100 transition-opacity"
                 />
               ) : (
                 <Volume2 size={24} />
               )}
            </div>
            <div className="min-w-0">
              <h4 className="font-semibold text-gray-900 dark:text-gray-50 text-sm truncate">{run.title}</h4>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">{run.summary || 'Daily Audio Briefing'}</p>
            </div>
          </div>

          <div className="flex-1 max-w-2xl flex flex-col items-center gap-2">
            <div className="flex items-center gap-6 text-gray-800 dark:text-gray-200">
              <button className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors"><SkipBack size={20} /></button>
              <button 
                onClick={onTogglePlay}
                className="w-10 h-10 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-full flex items-center justify-center hover:scale-105 transition-transform shadow-md"
              >
                {isPlaying ? <Pause size={20} /> : <Play size={20} className="ml-0.5" />}
              </button>
              <button className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors"><SkipForward size={20} /></button>
            </div>
            
            <div className="w-full flex items-center gap-3 text-xs font-medium text-gray-500 dark:text-gray-400">
              <span>0:00</span>
              <div className="flex-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden cursor-pointer">
                <div 
                  className="h-full bg-blue-600 dark:bg-blue-500 rounded-full transition-all duration-500 relative"
                  style={{ width: `${progress}%` }}
                >
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2 h-2 bg-white rounded-full shadow-sm scale-0 opacity-0 group-hover:scale-100 group-hover:opacity-100 transition-all"></div>
                </div>
              </div>
              <span>{durationStr}</span>
            </div>
          </div>

          <div className="w-1/4 flex justify-end items-center gap-3 text-gray-500 dark:text-gray-400">
            <select
              value={playbackSpeed}
              onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
              className="text-xs font-medium bg-transparent border-none focus:ring-0 cursor-pointer hover:text-gray-900 dark:hover:text-gray-100 outline-none pr-1 appearance-none text-center"
              title="Playback Speed"
            >
              <option value={0.5}>0.5x</option>
              <option value={0.75}>0.75x</option>
              <option value={1}>1x</option>
              <option value={1.25}>1.25x</option>
              <option value={1.5}>1.5x</option>
              <option value={1.75}>1.75x</option>
              <option value={2}>2x</option>
            </select>
            <button onClick={() => setIsExpanded(true)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors">
              <Maximize2 size={18} />
            </button>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors">
              <X size={18} />
            </button>
          </div>

        </div>
      </div>
    </>
  );
}
