import { useEffect, useState } from 'react';
import { Save, Server, Palette, Eye, Type, Layout, Moon, Sun, Monitor } from 'lucide-react';
import { providerService } from '../../services';
import { AppSettings } from '../../types';
import { ORB_THEMES, OrbThemeName } from '../audio/OrbVisualizer';

export default function SettingsView() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string>();

  const loadSettings = async () => {
    setError(undefined);
    try {
      setSettings(await providerService.getSettings());
    } catch {
      setError('LocalCast could not load settings from its local API.');
    }
  };

  useEffect(() => {
    void loadSettings();
  }, []);

  const handleSave = async (settingsToSave: AppSettings) => {
    setIsSaving(true);
    setError(undefined);
    try {
      await providerService.saveSettings(settingsToSave);
    } catch {
      setError('LocalCast could not save appearance settings. Your previous server settings remain unchanged.');
    } finally {
      setIsSaving(false);
    }
  };

  const updateSetting = (newSettings: AppSettings) => {
    setSettings(newSettings);
    void handleSave(newSettings);
  };

  if (!settings) {
    return (
      <div className="page page--narrow">
        <h1 tabIndex={-1} className="page-title">Settings</h1>
        {error ? (
          <div className="empty-state" role="alert">
            <p>{error}</p>
            <button className="button button--secondary" onClick={() => void loadSettings()}>Try again</button>
          </div>
        ) : <p role="status">Loading settings...</p>}
      </div>
    );
  }

  return (
    <div className="page page--narrow">
      <div className="page-header page-header--bottom-aligned">
        <div>
          <h1 tabIndex={-1} className="page-title">Settings</h1>
          <p className="page-description">Review server-side provider status and adjust appearance.</p>
        </div>
        <div className="saving-status">
          {isSaving && (
            <span className="saving-status__content is-pulsing" role="status" aria-live="polite">
              <Save size={16} aria-hidden="true" /> Saving...
            </span>
          )}
        </div>
      </div>

      {error && <p className="empty-state" role="alert">{error}</p>}

      <div className="card">
        <div className="card__header card__header--plain">
          <Eye size={20} className="icon-primary" aria-hidden="true" />
          <h2 className="card__title">Appearance & Accessibility</h2>
        </div>
        
        <div className="card__body settings-stack">
          {/* Theme */}
          <fieldset>
            <legend className="field-label">
              <Sun size={16} className="icon-muted" aria-hidden="true" /> Theme
            </legend>
            <div className="choice-grid">
              {(['system', 'light', 'dark'] as const).map(theme => (
                <label 
                  key={theme} 
                  className="choice-card"
                  data-selected={settings.theme === theme ? 'true' : 'false'}
                >
                  <input
                    type="radio"
                    name="theme"
                    value={theme}
                    checked={settings.theme === theme}
                    onChange={(e) => updateSetting({...settings, theme: e.target.value as AppSettings['theme']})}
                  />
                  {theme === 'system' && <Monitor size={20} aria-hidden="true" />}
                  {theme === 'light' && <Sun size={20} aria-hidden="true" />}
                  {theme === 'dark' && <Moon size={20} aria-hidden="true" />}
                  <span className="choice-card__label">{theme}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {/* Contrast & Vision */}
          <div className="content-grid content-grid--two">
            <div className="field">
              <label htmlFor="contrastMode" className="field-label">Contrast Mode</label>
              <select
                id="contrastMode"
                value={settings.contrastMode}
                onChange={e => updateSetting({...settings, contrastMode: e.target.value as AppSettings['contrastMode']})}
                className="control"
              >
                <option value="normal">Normal</option>
                <option value="high">High Contrast (WCAG 2.2 AAA)</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="colorVisionMode" className="field-label">Color Vision Optimization</label>
              <select
                id="colorVisionMode"
                value={settings.colorVisionMode}
                onChange={e => updateSetting({...settings, colorVisionMode: e.target.value as AppSettings['colorVisionMode']})}
                className="control"
              >
                <option value="default">Default</option>
                <option value="protanopia">Protanopia (Red-blind)</option>
                <option value="deuteranopia">Deuteranopia (Green-blind)</option>
                <option value="tritanopia">Tritanopia (Blue-blind)</option>
                <option value="achromatopsia">Achromatopsia (Grayscale)</option>
              </select>
            </div>
          </div>

          {/* Text Size & Density */}
          <div className="content-grid content-grid--two">
            <div className="field">
              <label htmlFor="textSize" className="field-label">
                <Type size={16} className="icon-muted" aria-hidden="true" /> Text Size
              </label>
              <select
                id="textSize"
                value={settings.textSize}
                onChange={e => updateSetting({...settings, textSize: e.target.value as AppSettings['textSize']})}
                className="control"
              >
                <option value="small">Small</option>
                <option value="normal">Normal</option>
                <option value="large">Large</option>
                <option value="extra-large">Extra Large</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="density" className="field-label">
                <Layout size={16} className="icon-muted" aria-hidden="true" /> UI Density
              </label>
              <select
                id="density"
                value={settings.density}
                onChange={e => updateSetting({...settings, density: e.target.value as AppSettings['density']})}
                className="control"
              >
                <option value="compact">Compact</option>
                <option value="normal">Normal</option>
                <option value="comfortable">Comfortable</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card__header card__header--plain">
          <Server size={20} className="icon-primary" aria-hidden="true" />
          <h2 className="card__title">Provider Status</h2>
        </div>
        <div className="card__body settings-stack">
          <p className="field-help">
            Provider credentials and endpoints are configured only on the LocalCast server. They are never entered or stored in this browser.
          </p>
          <p className="field-help">
            On explicit generation, OpenAI text receives station direction plus selected supplied titles, URLs, notes, and evidence; OpenAI TTS receives the final narration. A later follow-up question sends that episode&apos;s transcript, cited evidence, and the question. LocalCast does not authorize autonomous web research. Generated voices and audio are AI-generated.
          </p>
          <dl className="content-grid content-grid--two">
            {(['text', 'speech'] as const).map(kind => {
              const provider = settings.providers[kind];
              return (
                <div className="card card--padded" key={kind}>
                  <dt className="field-label">{kind === 'text' ? 'Text generation' : 'Speech generation'}</dt>
                  <dd>
                    <strong>{provider.adapter}</strong>
                    <p>
                      <span className={`badge ${provider.status === 'NOT CONFIGURED' ? 'badge--warning' : 'badge--primary'}`}>
                        {provider.status}
                      </span>
                    </p>
                    <p className="field-help">{provider.reason}</p>
                    {provider.model && <p className="field-help">Model: {provider.model}{provider.voice ? ` · voice: ${provider.voice}` : ''}</p>}
                    {provider.verifiedAt && <p className="field-help">Verified: {new Date(provider.verifiedAt).toLocaleString()}</p>}
                  </dd>
                </div>
              );
            })}
          </dl>
          {!settings.generationEnabled && (
            <p className="empty-state" role="status">
              Sync and generate remains disabled until both providers are configured on the server.
            </p>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card__header card__header--plain">
          <Palette size={20} className="icon-primary" />
          <h2 className="card__title">Voice Visualizer Theme</h2>
        </div>
        <div className="card__body">
          <div className="orb-theme-grid">
            {(Object.entries(ORB_THEMES) as [OrbThemeName, typeof ORB_THEMES[OrbThemeName]][]).map(([themeName, themeConfig]) => (
              <button
                key={themeName}
                onClick={() => updateSetting({ ...settings, orbTheme: themeName })}
                className="orb-theme-option"
                data-active={(settings.orbTheme || 'amber') === themeName ? 'true' : 'false'}
              >
                <div 
                  className="orb-theme-preview"
                  style={{ backgroundColor: themeConfig.background }}
                >
                  <div 
                    className="orb-theme-preview__glow" 
                    style={{ background: `radial-gradient(circle, ${themeConfig.backgroundGlow} 0%, transparent 70%)` }}
                  ></div>
                  <div 
                    className="orb-theme-preview__core"
                    style={{ 
                      background: `radial-gradient(circle, ${themeConfig.core} 0%, ${themeConfig.coreSecondary} 30%, ${themeConfig.mid} 70%, ${themeConfig.rim} 100%)`,
                      boxShadow: `0 0 10px ${themeConfig.accent}`
                    }}
                  ></div>
                </div>
                <span className="orb-theme-label">
                  {themeName.charAt(0).toUpperCase() + themeName.slice(1).replace(/([A-Z])/g, ' $1').trim()}
                </span>
                
                {(settings.orbTheme || 'amber') === themeName && (
                  <div className="orb-theme-check" aria-hidden="true">
                    <div className="orb-theme-check__dot"></div>
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
