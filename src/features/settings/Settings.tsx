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
    <div className="max-w-3xl mx-auto space-y-8 pb-12">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-display font-semibold text-gray-900 dark:text-gray-50 tracking-tight">Settings</h1>
          <p className="mt-2 text-gray-500 dark:text-gray-400">Configure AI providers, appearance, and local integrations.</p>
        </div>
        <div className="h-8 flex items-center">
          {isSaving && (
            <span className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2 animate-pulse" role="status" aria-live="polite">
              <Save size={16} aria-hidden="true" /> Saving...
            </span>
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-800 flex items-center gap-3">
          <Eye size={20} className="text-blue-600 dark:text-blue-500" aria-hidden="true" />
          <h2 className="font-semibold text-gray-900 dark:text-gray-50 text-lg">Appearance & Accessibility</h2>
        </div>
        
        <div className="p-6 space-y-8">
          {/* Theme */}
          <fieldset>
            <legend className="text-sm font-medium text-gray-900 dark:text-gray-200 mb-3 flex items-center gap-2">
              <Sun size={16} className="text-gray-500" aria-hidden="true" /> Theme
            </legend>
            <div className="grid grid-cols-3 gap-3">
              {(['system', 'light', 'dark'] as const).map(theme => (
                <label 
                  key={theme} 
                  className={`flex flex-col items-center p-3 rounded-lg border cursor-pointer focus-within:ring-2 focus-within:ring-blue-500 transition-colors ${
                    settings.theme === theme 
                      ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300' 
                      : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="theme"
                    value={theme}
                    checked={settings.theme === theme}
                    onChange={(e) => updateSetting({...settings, theme: e.target.value as AppSettings['theme']})}
                    className="sr-only"
                  />
                  {theme === 'system' && <Monitor size={20} className="mb-2" aria-hidden="true" />}
                  {theme === 'light' && <Sun size={20} className="mb-2" aria-hidden="true" />}
                  {theme === 'dark' && <Moon size={20} className="mb-2" aria-hidden="true" />}
                  <span className="text-sm font-medium capitalize">{theme}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {/* Contrast & Vision */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label htmlFor="contrastMode" className="block text-sm font-medium text-gray-900 dark:text-gray-200 mb-2">Contrast Mode</label>
              <select
                id="contrastMode"
                value={settings.contrastMode}
                onChange={e => updateSetting({...settings, contrastMode: e.target.value as AppSettings['contrastMode']})}
                className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-50 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5 outline-none"
              >
                <option value="normal">Normal</option>
                <option value="high">High Contrast (WCAG 2.2 AAA)</option>
              </select>
            </div>
            <div>
              <label htmlFor="colorVisionMode" className="block text-sm font-medium text-gray-900 dark:text-gray-200 mb-2">Color Vision Optimization</label>
              <select
                id="colorVisionMode"
                value={settings.colorVisionMode}
                onChange={e => updateSetting({...settings, colorVisionMode: e.target.value as AppSettings['colorVisionMode']})}
                className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-50 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5 outline-none"
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label htmlFor="textSize" className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-gray-200 mb-2">
                <Type size={16} className="text-gray-500" aria-hidden="true" /> Text Size
              </label>
              <select
                id="textSize"
                value={settings.textSize}
                onChange={e => updateSetting({...settings, textSize: e.target.value as AppSettings['textSize']})}
                className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-50 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5 outline-none"
              >
                <option value="small">Small</option>
                <option value="normal">Normal</option>
                <option value="large">Large</option>
                <option value="extra-large">Extra Large</option>
              </select>
            </div>
            <div>
              <label htmlFor="density" className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-gray-200 mb-2">
                <Layout size={16} className="text-gray-500" aria-hidden="true" /> UI Density
              </label>
              <select
                id="density"
                value={settings.density}
                onChange={e => updateSetting({...settings, density: e.target.value as AppSettings['density']})}
                className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-50 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5 outline-none"
              >
                <option value="compact">Compact</option>
                <option value="normal">Normal</option>
                <option value="comfortable">Comfortable</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-800 flex items-center gap-3">
          <Server size={20} className="text-blue-600 dark:text-blue-500" />
          <h2 className="font-semibold text-gray-900 dark:text-gray-50 text-lg">AI Providers (Transcription & Synthesis)</h2>
        </div>
        <div className="p-6 space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-900 dark:text-gray-200 mb-2">Provider Engine</label>
            <select 
              value={settings.aiProvider}
              onChange={e => updateSetting({...settings, aiProvider: e.target.value as AppSettings['aiProvider']})}
              className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-50 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5"
            >
              <option value="mock">Mock Provider</option>
              <option value="gemini_placeholder">Google Gemini</option>
              <option value="openai_placeholder">OpenAI</option>
              <option value="lmstudio_placeholder">LM Studio (Local)</option>
              <option value="ollama_placeholder">Ollama (Local)</option>
            </select>
          </div>

          {settings.aiProvider !== 'mock' && (
            <div className="space-y-4">
              {(settings.aiProvider === 'lmstudio_placeholder' || settings.aiProvider === 'ollama_placeholder') && (
                <div>
                  <label className="block text-sm font-medium text-gray-900 dark:text-gray-200 mb-2">Base URL</label>
                  <input 
                    type="text" 
                    placeholder="http://localhost:11434"
                    value={settings.aiConfig.baseUrl || ''}
                    onChange={e => setSettings({ ...settings, aiConfig: { ...settings.aiConfig, baseUrl: e.target.value }})}
                    onBlur={() => handleSave(settings)}
                    className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-50 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5"
                  />
                </div>
              )}

              {(settings.aiProvider === 'gemini_placeholder' || settings.aiProvider === 'openai_placeholder' || settings.aiProvider === 'lmstudio_placeholder') && (
                <div>
                  <label className="block text-sm font-medium text-gray-900 dark:text-gray-200 mb-2 flex items-center gap-2">
                    <Key size={16} className="text-gray-400 dark:text-gray-500" />
                    API Key
                  </label>
                  <input 
                    type="password" 
                    placeholder="sk-..."
                    value={settings.aiConfig.apiKey || ''}
                    onChange={e => setSettings({ ...settings, aiConfig: { ...settings.aiConfig, apiKey: e.target.value }})}
                    onBlur={() => handleSave(settings)}
                    className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-50 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5"
                  />
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">Keys are stored locally in your browser and never sent to our servers.</p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-900 dark:text-gray-200 mb-2">Model Name</label>
                <input 
                  type="text" 
                  placeholder="e.g. gemini-2.5-flash"
                  value={settings.aiConfig.model || ''}
                  onChange={e => setSettings({ ...settings, aiConfig: { ...settings.aiConfig, model: e.target.value }})}
                  onBlur={() => handleSave(settings)}
                  className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-50 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-800 flex items-center gap-3">
          <Mic size={20} className="text-blue-600 dark:text-blue-500" />
          <h2 className="font-semibold text-gray-900 dark:text-gray-50 text-lg">Text-to-Speech (TTS)</h2>
        </div>
        <div className="p-6 space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-900 dark:text-gray-200 mb-2">Voice Engine</label>
            <select 
              value={settings.ttsProvider}
              onChange={e => updateSetting({...settings, ttsProvider: e.target.value as AppSettings['ttsProvider']})}
              className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-50 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5"
            >
              <option value="local">Web Speech API (Browser Local)</option>
              <option value="openai">OpenAI TTS</option>
              <option value="elevenlabs">ElevenLabs</option>
            </select>
          </div>
          
          {settings.ttsProvider !== 'local' && (
            <div>
              <label className="block text-sm font-medium text-gray-900 dark:text-gray-200 mb-2 flex items-center gap-2">
                <Key size={16} className="text-gray-400 dark:text-gray-500" />
                API Key
              </label>
              <input 
                type="password" 
                placeholder="Enter API Key"
                value={settings.ttsConfig.apiKey || ''}
                onChange={e => setSettings({ ...settings, ttsConfig: { ...settings.ttsConfig, apiKey: e.target.value }})}
                onBlur={() => handleSave(settings)}
                className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-50 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5"
              />
            </div>
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-800 flex items-center gap-3">
          <Palette size={20} className="text-blue-600 dark:text-blue-500" />
          <h2 className="font-semibold text-gray-900 dark:text-gray-50 text-lg">Voice Visualizer Theme</h2>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {(Object.entries(ORB_THEMES) as [OrbThemeName, typeof ORB_THEMES[OrbThemeName]][]).map(([themeName, themeConfig]) => (
              <button
                key={themeName}
                onClick={() => updateSetting({ ...settings, orbTheme: themeName })}
                className={`group relative flex flex-col items-center gap-3 p-3 rounded-xl border transition-all duration-300 ${
                  (settings.orbTheme || 'amber') === themeName 
                    ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-900/20 ring-1 ring-blue-500' 
                    : 'border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700'
                }`}
              >
                <div 
                  className="w-16 h-16 rounded-full shadow-inner flex items-center justify-center relative overflow-hidden ring-1 ring-black/5 dark:ring-white/10"
                  style={{ backgroundColor: themeConfig.background }}
                >
                  <div 
                    className={`absolute inset-0 opacity-50 transition-transform duration-700 ease-out group-hover:scale-150 ${
                      (settings.orbTheme || 'amber') === themeName ? 'scale-125' : ''
                    }`} 
                    style={{ background: `radial-gradient(circle, ${themeConfig.backgroundGlow} 0%, transparent 70%)` }}
                  ></div>
                  <div 
                    className={`w-8 h-8 rounded-full z-10 transition-all duration-700 ease-out group-hover:scale-125 ${
                      (settings.orbTheme || 'amber') === themeName ? 'scale-110 shadow-lg' : ''
                    }`}
                    style={{ 
                      background: `radial-gradient(circle, ${themeConfig.core} 0%, ${themeConfig.coreSecondary} 30%, ${themeConfig.mid} 70%, ${themeConfig.rim} 100%)`,
                      boxShadow: `0 0 10px ${themeConfig.accent}`
                    }}
                  ></div>
                </div>
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300 text-center">
                  {themeName.charAt(0).toUpperCase() + themeName.slice(1).replace(/([A-Z])/g, ' $1').trim()}
                </span>
                
                {(settings.orbTheme || 'amber') === themeName && (
                  <div className="absolute -top-2 -right-2 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center border-2 border-white dark:border-gray-900 shadow-sm">
                    <div className="w-1.5 h-1.5 bg-white rounded-full"></div>
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
