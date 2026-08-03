import { useEffect } from 'react';

import { terminalManager } from '../services/terminalManager';
import { useSettingsStore } from '../stores/settingsStore';

export function useTerminalFont() {
  const fontFamily = useSettingsStore((s) => s.settings.terminalFontFamily);
  const fontSize = useSettingsStore((s) => s.settings.terminalFontSize);
  const fontThicken = useSettingsStore((s) => s.settings.terminalFontThicken);

  useEffect(() => {
    terminalManager.updateFont(fontFamily, fontSize, fontThicken);
  }, [fontFamily, fontSize, fontThicken]);
}
