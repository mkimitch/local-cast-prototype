import {useRef, useState} from 'react';
import {Volume2, X} from 'lucide-react';
import type {BriefingRun} from '../../types';

interface AudioPlayerProps {
  run: BriefingRun;
  onClose: () => void;
}

export default function AudioPlayer({run, onClose}: AudioPlayerProps) {
  const audio = useRef<HTMLAudioElement>(null);
  const [speed, setSpeed] = useState(1);
  const [mediaState, setMediaState] = useState('Ready');
  if (!run.audioAsset) return null;

  return (
    <section className="audio-player" aria-label="Persistent episode player">
      <div className="audio-player__inner">
        <div className="audio-player__meta">
          <div className="audio-player__thumb"><Volume2 size={24} /></div>
          <div className="audio-player__copy">
            <h2 className="audio-player__title">{run.title}</h2>
            <p className="audio-player__summary">AI-generated audio · <span aria-live="polite">{mediaState}</span></p>
          </div>
        </div>
        <audio
          ref={audio}
          controls
          autoPlay
          preload="metadata"
          src={run.audioAsset.url}
          aria-label={`Play AI-generated episode ${run.title}`}
          onLoadedMetadata={() => setMediaState('Loaded')}
          onPlay={() => setMediaState('Playing')}
          onPause={() => setMediaState('Paused')}
          onSeeking={() => setMediaState('Seeking')}
          onSeeked={() => setMediaState('Ready')}
          onEnded={() => setMediaState('Ended')}
          onError={() => setMediaState('Playback failed')}
        />
        <div className="audio-player__actions">
          <label>
            <span className="sr-only">Playback speed</span>
            <select
              value={speed}
              onChange={event => {
                const value = Number(event.target.value);
                setSpeed(value);
                if (audio.current) audio.current.playbackRate = value;
              }}
              className="control control--minimal"
              aria-label="Playback speed"
            >
              {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(value => <option key={value} value={value}>{value}x</option>)}
            </select>
          </label>
          <button onClick={onClose} className="icon-button" aria-label="Close player"><X size={18} /></button>
        </div>
      </div>
    </section>
  );
}
