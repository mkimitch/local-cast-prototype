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
        <div className="player-expanded" style={{ backgroundColor: ORB_THEMES[orbTheme].background }}>
          <div className="player-expanded__visualizer">
            <OrbVisualizer 
              isActive={isPlaying} 
              audioLevel={audioData.level} 
              frequencies={audioData.frequencies}
              theme={orbTheme}
              className="orb-visualizer--fill"
            />
          </div>
          
          <div className="player-expanded__content">
            <div className="player-expanded__header">
              <div className="player-expanded__copy">
                <h2 className="player-expanded__title">{run.title}</h2>
                <p className="player-expanded__summary">{run.summary}</p>
              </div>
              <div>
                <button onClick={() => setIsExpanded(false)} className="icon-button player-expanded__close" aria-label="Minimize player">
                  <Minimize2 size={24} />
                </button>
              </div>
            </div>
            
            <div className="player-expanded__controls">
              <div className="player-expanded__controls-inner">
                <div className="player-progress player-progress--expanded">
                  <span>0:00</span>
                  <div className="player-progress__track">
                    <div 
                      className="player-progress__fill"
                      style={{
                        width: `${progress}%`,
                        backgroundColor: ORB_THEMES[orbTheme].core,
                        boxShadow: '0 0 10px rgb(255 255 255 / 0.5)'
                      }}
                    ></div>
                  </div>
                  <span>{durationStr}</span>
                </div>
                
                <div className="player-expanded__transport">
                  <button className="player-expanded__side-button" aria-label="Skip back"><SkipBack size={28} /></button>
                  <button 
                    onClick={onTogglePlay}
                    className="player-expanded__play"
                    aria-label={isPlaying ? 'Pause briefing' : 'Play briefing'}
                    style={{ 
                      color: ORB_THEMES[orbTheme].background,
                      boxShadow: `0 0 40px color-mix(in oklch, ${ORB_THEMES[orbTheme].accent} 20%, transparent)`
                    }}
                  >
                    {isPlaying ? <Pause size={32} /> : <Play size={32} />}
                  </button>
                  <button className="player-expanded__side-button" aria-label="Skip forward"><SkipForward size={28} /></button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className={`audio-player${isExpanded ? ' audio-player--hidden' : ''}`}>
        <div className="audio-player__inner">
          
          <div className="audio-player__meta">
            <div className="audio-player__thumb">
               {isPlaying ? (
                 <OrbVisualizer 
                  isActive={isPlaying} 
                  audioLevel={audioData.level} 
                  frequencies={audioData.frequencies}
                  theme={orbTheme}
                  className="audio-player__thumb-orb"
                 />
               ) : (
                 <Volume2 size={24} />
               )}
            </div>
            <div className="audio-player__copy">
              <h4 className="audio-player__title">{run.title}</h4>
              <p className="audio-player__summary">{run.summary || 'Daily Audio Briefing'}</p>
            </div>
          </div>

          <div className="audio-player__center">
            <div className="audio-player__controls">
              <button className="audio-player__control" aria-label="Skip back"><SkipBack size={20} /></button>
              <button 
                onClick={onTogglePlay}
                className="audio-player__play"
                aria-label={isPlaying ? 'Pause briefing' : 'Play briefing'}
              >
                {isPlaying ? <Pause size={20} /> : <Play size={20} />}
              </button>
              <button className="audio-player__control" aria-label="Skip forward"><SkipForward size={20} /></button>
            </div>
            
            <div className="player-progress">
              <span>0:00</span>
              <div className="player-progress__track">
                <div 
                  className="player-progress__fill"
                  style={{ width: `${progress}%` }}
                >
                  <div className="player-progress__thumb"></div>
                </div>
              </div>
              <span>{durationStr}</span>
            </div>
          </div>

          <div className="audio-player__actions">
            <select
              value={playbackSpeed}
              onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
              className="control control--minimal"
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
            <button onClick={() => setIsExpanded(true)} className="icon-button" aria-label="Expand player">
              <Maximize2 size={18} />
            </button>
            <button onClick={onClose} className="icon-button" aria-label="Close player">
              <X size={18} />
            </button>
          </div>

        </div>
      </div>
    </>
  );
}
