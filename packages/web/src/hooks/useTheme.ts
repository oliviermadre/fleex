import { useEffect } from 'react';

import { resolveTheme, applyTheme } from '../lib/themes';
import { setTerminalTheme } from '../services/terminalAppearance';
import { terminalManager } from '../services/terminalManager';
import { useSettingsStore } from '../stores/settingsStore';

export function useTheme() {
  const activeThemeId = useSettingsStore((s) => s.settings.activeThemeId);
  const customThemes = useSettingsStore((s) => s.settings.customThemes);

  useEffect(() => {
    const theme = resolveTheme(activeThemeId, customThemes);
    applyTheme(theme);
    setTerminalTheme(theme);
  }, [activeThemeId, customThemes]);
}
