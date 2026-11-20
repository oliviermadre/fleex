import { useMemo } from 'react';
import { useActiveTheme } from '../hooks/useActiveTheme';
import { useSettingsStore } from '../stores/settingsStore';
import { DECOR, decorOn, skinInfo, type SkinChrome, type SkinInfo } from './skins';
import type { FleexSkin } from './skins/fleex';

/**
 * The skin chosen in Settings, and the colours it paints the page around the floor in (null: the theme's), for the
 * theme in use; whether its floor has a decor (`factoryDecor`, skin by skin); and how to make its painter, decor
 * included. `key` changes when either does: the page then paints with a new painter.
 */
export function useFactorySkin(): { skin: SkinInfo; chrome: SkinChrome | null; decor: boolean; make: () => FleexSkin; key: string } {
  const id = useSettingsStore((s) => s.settings.factorySkin), set = useSettingsStore((s) => s.settings.factoryDecor);
  const theme = useActiveTheme(), skin = skinInfo(id), decor = decorOn(skin, set);
  const chrome = useMemo(() => skin.chrome(theme), [skin, theme]);
  const make = useMemo(() => () => skin.make().setDecor(decor ? DECOR : null), [skin, decor]);
  return { skin, chrome, decor, make, key: `${skin.id}:${decor ? 'decor' : 'plain'}` };
}
