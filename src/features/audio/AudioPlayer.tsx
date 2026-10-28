import {useEffect, useRef, useState} from 'react';
import {Download, Pause, Play, RotateCcw, RotateCw, Volume2, X} from 'lucide-react';
import type {BriefingRun} from '../../types';

interface AudioPlayerProps {
  run: BriefingRun;
  onClose: () => void;
}

const formatTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

export default function AudioPlayer({run, onClose}: AudioPlayerProps) {
  const audio = useRef<HTMLAudioElement>(null);
  const [speed, setSpeed] = useState(1);
  const [mediaState, setMediaState] = useState('Ready');
  const [isPlaying, setIsPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState((run.audioAsset?.durationMs || 0) / 1000);

  useEffect(() => {
    const element = audio.current;
    element?.pause();
    if (element) {
      element.currentTime = 0;
      element.playbackRate = 1;
    }
    setSpeed(1);
    setMediaState('Ready');
    setIsPlaying(false);
    setElapsed(0);
    setDuration((run.audioAsset?.durationMs || 0) / 1000);
  }, [run.id, run.audioAsset?.durationMs]);

  if (!run.audioAsset) return null;

  const seek = (seconds: number) => {
    const element = audio.current;
    if (!element) return;
    const upperBound = Number.isFinite(element.duration) && element.duration > 0 ? element.duration : duration;
    const endSafeUpperBound = upperBound > 0.05 ? upperBound - 0.05 : upperBound;
    element.currentTime = Math.max(0, Math.min(seconds >= upperBound ? endSafeUpperBound : upperBound, seconds));
    setElapsed(element.currentTime);
  };

  const togglePlayback = async () => {
    const element = audio.current;
    if (!element) return;
    if (!element.paused) {
      element.pause();
      return;
    }
    try {
      await element.play();
    } catch {
      setMediaState('Playback failed');
    }
  };

  return (
    <section className="audio-player" aria-label="Persistent episode player">
      <div className="audio-player__inner">
        <div className="audio-player__meta">
          <div className="audio-player__thumb"><Volume2 size={24} aria-hidden="true" /></div>
          <div className="audio-player__copy">
            <h2 className="audio-player__title">{run.title}</h2>
            <p className="audio-player__summary">AI-generated audio · {mediaState === 'Playback failed'
              ? <span>{mediaState}</span>
              : <span aria-live="polite" aria-atomic="true">{mediaState}</span>}</p>
          </div>
        </div>
        <audio
          ref={audio}
          preload="metadata"
          src={run.audioAsset.url}
          aria-label={`AI-generated episode media for ${run.title}`}
          onLoadedMetadata={event => {
            const measured = event.currentTarget.duration;
            if (Number.isFinite(measured) && measured > 0) setDuration(measured);
            event.currentTarget.playbackRate = speed;
            setMediaState('Loaded');
          }}
          onDurationChange={event => {
            const measured = event.currentTarget.duration;
            if (Number.isFinite(measured) && measured > 0) setDuration(measured);
          }}
          onTimeUpdate={event => setElapsed(event.currentTarget.currentTime)}
          onPlay={() => { setIsPlaying(true); setMediaState('Playing'); }}
          onPause={() => { setIsPlaying(false); setMediaState('Paused'); }}
          onSeeking={() => setMediaState('Seeking')}
          onSeeked={event => { setElapsed(event.currentTarget.currentTime); setMediaState(event.currentTarget.paused ? 'Paused' : 'Playing'); }}
          onEnded={() => { setIsPlaying(false); setMediaState('Ended'); }}
          onError={() => { setIsPlaying(false); setMediaState('Playback failed'); }}
        />
        <div className="audio-player__transport" aria-label="Playback controls">
          <button className="icon-button" onClick={() => seek(elapsed - 15)} aria-label="Skip back 15 seconds"><RotateCcw size={18} aria-hidden="true" /></button>
          <button className="icon-button" onClick={togglePlayback} aria-label={isPlaying ? 'Pause episode' : 'Play episode'}>
            {isPlaying ? <Pause size={20} aria-hidden="true" /> : <Play size={20} aria-hidden="true" />}
          </button>
          <button className="icon-button" onClick={() => seek(elapsed + 30)} aria-label="Skip forward 30 seconds"><RotateCw size={18} aria-hidden="true" /></button>
          <span className="audio-player__time" aria-label={`${formatTime(elapsed)} elapsed of ${formatTime(duration)}`}>{formatTime(elapsed)} / {formatTime(duration)}</span>
          <label className="audio-player__seek">
            <span className="sr-only">Seek through episode</span>
            <input
              type="range"
              min={0}
              max={Math.max(1, duration)}
              step={0.1}
              value={Math.min(elapsed, Math.max(1, duration))}
              onChange={event => seek(Number(event.target.value))}
              aria-label="Seek through episode"
            />
          </label>
        </div>
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
          <a className="icon-button" href={run.audioAsset.url} download={`localcast-${run.id}.mp3`} aria-label={`Download MP3 for ${run.title}`}><Download size={18} aria-hidden="true" /></a>
          <button onClick={onClose} className="icon-button" aria-label="Close player"><X size={18} aria-hidden="true" /></button>
        </div>
      </div>
      {mediaState === 'Playback failed' && <p className="audio-player__error" role="alert">Playback failed. The transcript and citations remain available on the episode page.</p>}
    </section>
  );
}
