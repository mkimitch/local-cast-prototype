import { useEffect, useState } from 'react';
import { Save, Server, Mic, Key, Palette, Eye, Type, Layout, Moon, Sun, Monitor } from 'lucide-react';
import { providerService } from '../../services';
import { AppSettings } from '../../types';
import { ORB_THEMES, OrbThemeName } from '../audio/OrbVisualizer';

export default function SettingsView() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    providerService.getSettings().then(setSettings);
  }, []);

  if (!settings) return null;

  const handleSave = async (settingsToSave: AppSettings) => {
    setIsSaving(true);
    await providerService.saveSettings(settingsToSave);
    setTimeout(() => setIsSaving(false), 600);
  };

  const updateSetting = (newSettings: AppSettings) => {
    setSettings(newSettings);
    handleSave(newSettings);
  };

  return (
    <div className="page page--narrow">
      <div className="page-header page-header--bottom-aligned">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-description">Configure AI providers, appearance, and local integrations.</p>
        </div>
        <div className="saving-status">
          {isSaving && (
            <span className="saving-status__content is-pulsing" role="status" aria-live="polite">
              <Save size={16} aria-hidden="true" /> Saving...
            </span>
          )}
        </div>
      </div>

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
          <Server size={20} className="icon-primary" />
          <h2 className="card__title">AI Providers (Transcription & Synthesis)</h2>
        </div>
        <div className="card__body settings-stack">
          <div className="field">
            <label className="field-label">Provider Engine</label>
            <select 
              value={settings.aiProvider}
              onChange={e => updateSetting({...settings, aiProvider: e.target.value as AppSettings['aiProvider']})}
              className="control"
            >
              <option value="mock">Mock Provider</option>
              <option value="gemini_placeholder">Google Gemini</option>
              <option value="openai_placeholder">OpenAI</option>
              <option value="lmstudio_placeholder">LM Studio (Local)</option>
              <option value="ollama_placeholder">Ollama (Local)</option>
            </select>
          </div>

          {settings.aiProvider !== 'mock' && (
            <div className="settings-stack">
              {(settings.aiProvider === 'lmstudio_placeholder' || settings.aiProvider === 'ollama_placeholder') && (
                <div className="field">
                  <label className="field-label">Base URL</label>
                  <input 
                    type="text" 
                    placeholder="http://localhost:11434"
                    value={settings.aiConfig.baseUrl || ''}
                    onChange={e => setSettings({ ...settings, aiConfig: { ...settings.aiConfig, baseUrl: e.target.value }})}
                    onBlur={() => handleSave(settings)}
                    className="control"
                  />
                </div>
              )}

              {(settings.aiProvider === 'gemini_placeholder' || settings.aiProvider === 'openai_placeholder' || settings.aiProvider === 'lmstudio_placeholder') && (
                <div className="field">
                  <label className="field-label">
                    <Key size={16} className="icon-muted" />
                    API Key
                  </label>
                  <input 
                    type="password" 
                    placeholder="sk-..."
                    value={settings.aiConfig.apiKey || ''}
                    onChange={e => setSettings({ ...settings, aiConfig: { ...settings.aiConfig, apiKey: e.target.value }})}
                    onBlur={() => handleSave(settings)}
                    className="control"
                  />
                  <p className="field-help">Keys are stored locally in your browser and never sent to our servers.</p>
                </div>
              )}

              <div className="field">
                <label className="field-label">Model Name</label>
                <input 
                  type="text" 
                  placeholder="e.g. gemini-2.5-flash"
                  value={settings.aiConfig.model || ''}
                  onChange={e => setSettings({ ...settings, aiConfig: { ...settings.aiConfig, model: e.target.value }})}
                  onBlur={() => handleSave(settings)}
                  className="control"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card__header card__header--plain">
          <Mic size={20} className="icon-primary" />
          <h2 className="card__title">Text-to-Speech (TTS)</h2>
        </div>
        <div className="card__body settings-stack">
          <div className="field">
            <label className="field-label">Voice Engine</label>
            <select 
              value={settings.ttsProvider}
              onChange={e => updateSetting({...settings, ttsProvider: e.target.value as AppSettings['ttsProvider']})}
              className="control"
            >
              <option value="local">Web Speech API (Browser Local)</option>
              <option value="openai">OpenAI TTS</option>
              <option value="elevenlabs">ElevenLabs</option>
            </select>
          </div>
          
          {settings.ttsProvider !== 'local' && (
            <div className="field">
              <label className="field-label">
                <Key size={16} className="icon-muted" />
                API Key
              </label>
              <input 
                type="password" 
                placeholder="Enter API Key"
                value={settings.ttsConfig.apiKey || ''}
                onChange={e => setSettings({ ...settings, ttsConfig: { ...settings.ttsConfig, apiKey: e.target.value }})}
                onBlur={() => handleSave(settings)}
                className="control"
              />
            </div>
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
