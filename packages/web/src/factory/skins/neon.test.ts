import { describe, expect, it } from 'vitest';
import { BUILT_IN_THEMES, themeVars } from '../../lib/themes';
import { contrast } from '../floorLook';
import { KIND_LOOK } from '../machineArt';
import { TYPE_COLORS } from './fleex';
import { NIGHT, nightTheme, shine } from './neon';

/* the neon skin keeps its night whatever the theme: every ink is held to every ground it is written on, for every theme */
describe('the neon skin reads', () => {
  it('on its floor: the words, the lights, the hues of station kinds and ticket types, and the accent of every theme', () => {
    const inks = [NIGHT.text, NIGHT.text2, NIGHT.ok, NIGHT.warn, NIGHT.danger, NIGHT.fast, ...Object.values(KIND_LOOK).map((k) => k.hue), ...Object.values(TYPE_COLORS), ...BUILT_IN_THEMES.map((t) => shine(t.colors.accent))];
    for (const ground of [NIGHT.floor, NIGHT.body, NIGHT.belt]) for (const ink of inks) expect(contrast(ink, ground), `${ink} on ${ground}`).toBeGreaterThanOrEqual(4.5);
    /* what is faint on purpose still reads */
    expect(contrast(NIGHT.text3, NIGHT.floor)).toBeGreaterThanOrEqual(3);
  });

  it('in the page around the floor, whatever the theme', () => {
    for (const theme of BUILT_IN_THEMES) {
      const c = nightTheme(theme).colors;
      for (const ground of [c.bgBase, c.bgSurface, c.bgOverlay]) {
        for (const ink of [c.textPrimary, c.textSecondary, c.textMuted, c.success, c.warning, c.danger, c.accent]) expect(contrast(ink, ground), `${theme.id}: ${ink} on ${ground}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(c.textFaint, ground), `${theme.id}: faint on ${ground}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('takes the accent of the theme, lifted when it is too dark to shine, and dark tints even on a light theme', () => {
    const light = BUILT_IN_THEMES.find((t) => t.id === 'light')!, verdant = BUILT_IN_THEMES.find((t) => t.id === 'verdant')!;
    expect(nightTheme(verdant).colors.accent).toBe(verdant.colors.accent);
    expect(nightTheme(light).colors.accent).not.toBe(light.colors.accent);
    expect(nightTheme(light).colors.accent).toMatch(/^#[0-9a-f]{6}$/);
    const vars = themeVars(nightTheme(light));
    expect(vars['--theme-bg-surface']).toBe('#0e0d19');
    expect(vars['--tint-red-text']).toBe(themeVars(verdant)['--tint-red-text']);
  });
});
