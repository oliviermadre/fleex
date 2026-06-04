import { useSettingsStore } from '../stores/settingsStore';
import { resolveTheme, isLightTheme, type Theme } from '../lib/themes';

/**
 * The fully-resolved active Fleex theme (built-in or custom). Use when a
 * component needs concrete color values — e.g. props that end up as SVG `fill`
 * attributes (React Flow's Background/MiniMap/markers), where CSS `var()` does
 * not resolve and a literal color is required.
 */
export function useActiveTheme(): Theme {
  const activeThemeId = useSettingsStore((s) => s.settings.activeThemeId);
  const customThemes = useSettingsStore((s) => s.settings.customThemes);
  return resolveTheme(activeThemeId, customThemes);
}

/**
 * React Flow color mode ('light' | 'dark') derived from the active theme, so
 * the workflow DAG canvas (editor + ticket execution view) follows the user's
 * theme instead of being hard-coded to dark.
 */
export function useColorMode(): 'light' | 'dark' {
  return isLightTheme(useActiveTheme()) ? 'light' : 'dark';
}
