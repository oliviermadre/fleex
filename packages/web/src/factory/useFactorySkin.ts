import { useMemo } from 'react';
import { useActiveTheme } from '../hooks/useActiveTheme';
import { useSettingsStore } from '../stores/settingsStore';
import { skinInfo, type SkinChrome, type SkinInfo } from './skins';

/** The skin chosen in Settings, and the colours it paints the page around the floor in (null: the theme's), for the theme in use. */
export function useFactorySkin(): { skin: SkinInfo; chrome: SkinChrome | null } {
  const id = useSettingsStore((s) => s.settings.factorySkin);
  const theme = useActiveTheme(), skin = skinInfo(id);
  const chrome = useMemo(() => skin.chrome(theme), [skin, theme]);
  return { skin, chrome };
}
