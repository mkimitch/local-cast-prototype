import { useEffect, useState } from 'react';
import { providerService } from '../services';
import { AppSettings } from '../types';

export function useAppearanceSettings() {
  useEffect(() => {
    let currentSettings: AppSettings | null = null;
    
    const applySettingsToDOM = (s: AppSettings) => {
      currentSettings = s;
      const html = document.documentElement;

      // Theme (Light/Dark/System)
      if (s.theme === 'dark' || (s.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        html.classList.add('dark');
      } else {
        html.classList.remove('dark');
      }

      // Contrast Mode
      if (s.contrastMode === 'high') {
        html.setAttribute('data-contrast', 'high');
      } else {
        html.removeAttribute('data-contrast');
      }

      // Color Vision Mode
      if (s.colorVisionMode !== 'default') {
        html.setAttribute('data-color-vision', s.colorVisionMode);
      } else {
        html.removeAttribute('data-color-vision');
      }

      // Text Size
      html.setAttribute('data-text-size', s.textSize);

      // Density
      html.setAttribute('data-density', s.density);
    };

    // Initial load
    providerService.getSettings().then(applySettingsToDOM);

    // Listen for changes
    const unsubscribe = providerService.onSettingsChanged(applySettingsToDOM);
    
    // Listen for OS theme changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleMediaQuery = () => {
      if (currentSettings && currentSettings.theme === 'system') {
        applySettingsToDOM(currentSettings);
      }
    };
    mediaQuery.addEventListener('change', handleMediaQuery);

    return () => {
      unsubscribe();
      mediaQuery.removeEventListener('change', handleMediaQuery);
    };
  }, []);
}
