import { useEffect } from 'react';
import { useSettingsStore } from '../stores/settingsStore';
import { resolveTheme, applyTheme } from '../lib/themes';
import { terminalManager } from '../services/terminalManager';
import { FORCED_THEME_ID } from '../lib/demoMode';

export function useTheme() {
  // `?theme=<id>` (screenshot tool) wins over the saved choice.
  const activeThemeId = useSettingsStore((s) => FORCED_THEME_ID ?? s.settings.activeThemeId);
  const customThemes = useSettingsStore((s) => s.settings.customThemes);

  useEffect(() => {
    const theme = resolveTheme(activeThemeId, customThemes);
    applyTheme(theme);
    terminalManager.updateTheme(theme);
  }, [activeThemeId, customThemes]);
}
