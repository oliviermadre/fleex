import { useEffect } from 'react';
import { useSettingsStore } from '../stores/settingsStore';
import { resolveTheme, applyTheme } from '../lib/themes';
import { terminalManager } from '../services/terminalManager';

export function useTheme() {
  const activeThemeId = useSettingsStore((s) => s.settings.activeThemeId);
  const customThemes = useSettingsStore((s) => s.settings.customThemes);

  useEffect(() => {
    const theme = resolveTheme(activeThemeId, customThemes);
    applyTheme(theme);
    terminalManager.updateTheme(theme);
  }, [activeThemeId, customThemes]);
}
