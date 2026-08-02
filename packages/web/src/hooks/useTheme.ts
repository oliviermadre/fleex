import { useEffect } from 'react';
import { useSettingsStore } from '../stores/settingsStore';
import { resolveTheme, applyTheme } from '../lib/themes';
import { setTerminalTheme } from '../services/terminalAppearance';

export function useTheme() {
  const activeThemeId = useSettingsStore((s) => s.settings.activeThemeId);
  const customThemes = useSettingsStore((s) => s.settings.customThemes);

  useEffect(() => {
    const theme = resolveTheme(activeThemeId, customThemes);
    applyTheme(theme);
    setTerminalTheme(theme);
  }, [activeThemeId, customThemes]);
}
