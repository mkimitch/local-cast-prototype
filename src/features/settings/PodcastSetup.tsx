import {Clipboard, Radio, ShieldCheck} from 'lucide-react';
import {useEffect, useRef, useState} from 'react';
import {podcastService} from '../../services';
import type {PodcastStatus} from '../../types';

export default function PodcastSetup() {
  const [status, setStatus] = useState<PodcastStatus>();
  const [loadError, setLoadError] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied' | 'error'>('idle');
  const copyButton = useRef<HTMLButtonElement>(null);

  const load = async () => {
    setLoadError(false);
    try {
      setStatus(await podcastService.getStatus());
    } catch {
      setLoadError(true);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (copyState !== 'copied' && copyState !== 'error') return;
    const frame = requestAnimationFrame(() => copyButton.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [copyState]);

  const copySubscription = async () => {
    setCopyState('copying');
    try {
      await podcastService.copySubscriptionUrlToClipboard();
      setCopyState('copied');
    } catch {
      setCopyState('error');
    }
  };

  return (
    <section className="card" aria-labelledby="podcast-setup-title">
      <div className="card__header card__header--plain">
        <Radio size={20} className="icon-primary" aria-hidden="true" />
        <h2 id="podcast-setup-title" className="card__title">Private podcast delivery</h2>
      </div>
      <div className="card__body settings-stack podcast-setup">
        <div>
          <p>
            LocalCast publishes one token-protected RSS feed on the trusted LAN. Every episode voice and audio is AI-generated, with its transcript and validated citations kept in LocalCast.
          </p>
          <p className="field-help">
            The subscription URL is a bearer credential. Copying exposes it to the operating-system clipboard. Keep gPodder file logging, gPodder.net sync, vendor accounts, cloud backup, and OPML sharing disabled.
          </p>
        </div>

        {loadError ? (
          <div className="inline-notice" role="alert">
            <p>Private podcast status could not be loaded.</p>
            <button className="button button--secondary" onClick={() => void load()}>Try again</button>
          </div>
        ) : !status ? (
          <p role="status">Loading private podcast status...</p>
        ) : (
          <div className="podcast-setup__controls">
            <div className="podcast-setup__status">
              <ShieldCheck size={18} className={status.configured ? 'icon-success' : 'icon-muted'} aria-hidden="true" />
              <div>
                <strong>{status.configured ? 'Private feed configured' : 'Private feed not configured'}</strong>
                <p className="field-help">
                  {status.publicBaseUrl ? `Canonical LAN origin: ${status.publicBaseUrl}` : 'Configure the canonical HTTPS origin and protected server token file.'}
                </p>
                <p className="podcast-setup__masked" aria-label="Private subscription URL is masked">•••••••••••• / feed.xml</p>
              </div>
            </div>
            <button
              ref={copyButton}
              className="button button--primary"
              disabled={!status.configured || copyState === 'copying'}
              onClick={() => void copySubscription()}
            >
              <Clipboard size={16} aria-hidden="true" />
              <span>{copyState === 'copying' ? 'Copying...' : 'Copy private RSS URL'}</span>
            </button>
          </div>
        )}

        <div>
          {copyState === 'copied' && <p role="status" className="inline-notice">Private RSS URL copied. Paste it directly into gPodder, then clear the clipboard when finished.</p>}
          {copyState === 'error' && <p role="alert" className="inline-notice">The private RSS URL could not be copied. Use this page over trusted HTTPS and allow clipboard access.</p>}
        </div>
      </div>
    </section>
  );
}
