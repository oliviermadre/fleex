import { describe, it, expect } from 'vitest';
import { resolveTheme, THEME_LIGHT, THEME_VERDANT, type Theme } from './themes';

/** A custom theme saved before `syntax` existed (2026-04): only colors + terminal. */
function legacyTheme(overrides: Partial<Theme['colors']> = {}): Theme {
  const { syntax: _syntax, ...rest } = THEME_VERDANT;
  return {
    ...rest,
    id: 'legacy',
    name: 'Legacy',
    builtIn: false,
    colors: { ...THEME_VERDANT.colors, accent: '#ff69b4', ...overrides },
  } as unknown as Theme;
}

describe('resolveTheme', () => {
  it('backfills syntax colors missing from a legacy custom theme', () => {
    const theme = resolveTheme('legacy', [legacyTheme()]);
    expect(theme.syntax).toEqual(THEME_VERDANT.syntax);
    expect(theme.colors.accent).toBe('#ff69b4');
  });

  it('backfills from the light theme when the custom theme is light', () => {
    const theme = resolveTheme('legacy', [legacyTheme({ bgBase: '#ffffff' })]);
    expect(theme.syntax).toEqual(THEME_LIGHT.syntax);
  });

  it('fills individual missing keys and keeps the ones the theme has', () => {
    const partial = {
      ...legacyTheme(),
      syntax: { keyword: '#123456' },
      terminal: undefined,
    } as unknown as Theme;
    const theme = resolveTheme('legacy', [partial]);
    expect(theme.syntax.keyword).toBe('#123456');
    expect(theme.syntax.string).toBe(THEME_VERDANT.syntax.string);
    expect(theme.terminal).toEqual(THEME_VERDANT.terminal);
  });

  it('falls back to Verdant for an unknown id', () => {
    expect(resolveTheme('nope', [])).toBe(THEME_VERDANT);
  });
});
