import { describe, expect, it } from 'vitest';
import { BUILT_IN_THEMES, themeVars } from '../../lib/themes';
import { contrast, isLight } from '../floorLook';
import { CREAM, NIGHT, PIXEL_STEPS, ART, workshopAccent, workshopTheme } from './pixel';

/* the pixel skin is a workshop by day on a light theme, at night on a dark one: every ink on every ground, for every theme */
describe('the pixel skin reads', () => {
  it('on its floor and on its bodies, by day and at night, the accent of every theme included', () => {
    for (const w of [CREAM, NIGHT]) {
      const inks = [w.text, w.text2, w.ok, w.warn, w.danger, ...BUILT_IN_THEMES.map((t) => workshopAccent(t.colors.accent, w.light))];
      for (const ground of [w.floor, w.body]) {
        for (const ink of inks) expect(contrast(ink, ground), `${ink} on ${ground}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(w.text3, ground), `faint on ${ground}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('in the page around the floor, whatever the theme', () => {
    for (const theme of BUILT_IN_THEMES) {
      const c = workshopTheme(theme).colors;
      for (const ground of [c.bgBase, c.bgSurface, c.bgOverlay]) {
        for (const ink of [c.textPrimary, c.textSecondary, c.textMuted, c.success, c.warning, c.danger, c.accent]) expect(contrast(ink, ground), `${theme.id}: ${ink} on ${ground}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(c.textFaint, ground), `${theme.id}: faint on ${ground}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('follows the theme: by day on a light one, at night on a dark one, with the tints that go', () => {
    for (const theme of BUILT_IN_THEMES) expect(isLight(workshopTheme(theme).colors.bgSurface), theme.id).toBe(isLight(theme.colors.bgSurface));
    const light = BUILT_IN_THEMES.find((t) => t.id === 'light')!, verdant = BUILT_IN_THEMES.find((t) => t.id === 'verdant')!;
    expect(themeVars(workshopTheme(light))['--tint-red-text']).toBe(themeVars(light)['--tint-red-text']);
    expect(themeVars(workshopTheme(verdant))['--tint-red-text']).toBe(themeVars(verdant)['--tint-red-text']);
  });

  it('rests its zoom where pixels are whole: whole multiples of its art, and two far steps under it', () => {
    for (const z of PIXEL_STEPS) expect(z < ART || z % ART === 0, String(z)).toBe(true);
    expect(PIXEL_STEPS.filter((z) => z < ART)).toHaveLength(2);
  });
});
