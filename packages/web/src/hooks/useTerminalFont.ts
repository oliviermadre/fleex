import { useEffect } from 'react';
import { useSettingsStore } from '../stores/settingsStore';
import { setTerminalFont } from '../services/terminalAppearance';

export function useTerminalFont() {
  const fontFamily = useSettingsStore((s) => s.settings.terminalFontFamily);
  const fontSize = useSettingsStore((s) => s.settings.terminalFontSize);
  const fontThicken = useSettingsStore((s) => s.settings.terminalFontThicken);

  useEffect(() => {
    setTerminalFont(fontFamily, fontSize, fontThicken);
  }, [fontFamily, fontSize, fontThicken]);
}
