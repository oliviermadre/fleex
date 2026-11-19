import { describe, expect, it } from 'vitest';
import { channels, contrast, fadeIn, floorLook, isLight, legible, luminance, mix, veil } from './floorLook';
import { KIND_LOOK } from './machineArt';


describe('theme colours', () => {
  it('reads the short and the long hexadecimal forms', () => {
    expect(channels('#22c55e')).toEqual([34, 197, 94]);
    expect(channels(' #FFF ')).toEqual([255, 255, 255]);
  });

  it('refuses what it cannot read, and then paints nothing', () => {
    expect(channels('oklch(70% 0.2 150)')).toBeNull();
    expect(channels('#12345')).toBeNull();
    expect(veil('var(--x)', 0.5)).toBe('rgba(0,0,0,0)');
  });

  it('gives a colour an opacity, kept between 0 and 1', () => {
    expect(veil('#22c55e', 0.2)).toBe('rgba(34,197,94,0.2)');
    expect(veil('#22c55e', 3)).toBe('rgba(34,197,94,1)');
    expect(veil('#22c55e', -1)).toBe('rgba(34,197,94,0)');
  });

  it('moves a colour towards another, and leaves alone one it cannot read', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('rgb(128,128,128)');
    expect(mix('#18181b', '#000000', 0)).toBe('rgb(24,24,27)');
    expect(mix('#18181b', '#000000', 1)).toBe('rgb(0,0,0)');
    expect(mix('#18181b', '#ffffff', 5)).toBe('rgb(255,255,255)');
    expect(mix('var(--floor)', '#000000', 0.4)).toBe('var(--floor)');
  });

  it('tells a light floor from a dark one, whatever the theme', () => {
    for (const dark of ['#18181b', '#1e293b', '#0a0a0a', '#292018']) expect(isLight(dark)).toBe(false);
    for (const light of ['#ffffff', '#fffbeb']) expect(isLight(light)).toBe(true);
    expect(isLight('not a colour')).toBe(false);
  });
});

describe('writing on a light theme', () => {
  it('reads a colour written as rgb() or rgba() too, leaving its opacity aside', () => {
    expect(channels('rgb(10, 20, 30)')).toEqual([10, 20, 30]);
    expect(channels('rgba(9,9,11,0.84)')).toEqual([9, 9, 11]);
    expect(mix('rgb(0,0,0)', '#ffffff', 0.5)).toBe('rgb(128,128,128)');
  });

  it('counts how light a colour is, and the contrast of two', () => {
    expect(luminance('#000000')).toBe(0);
    expect(luminance('#ffffff')).toBeCloseTo(1);
    expect(luminance('nope')).toBeNull();
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21);
    expect(contrast('#777777', '#777777')).toBeCloseTo(1);
  });

  it('darkens the floor\'s light colours until they read on a light ground, keeping what already does', () => {
    const body = '#e4e4e7', white = '#ffffff';
    /* the hues of the station kinds, the paint of zones, amber and the pastel inks: all picked on a dark floor */
    for (const hue of [...Object.values(KIND_LOOK).map((k) => k.hue), '#60a5fa', '#fb923c', '#c084fc', '#22c55e', '#facc15', '#fde68a', '#f4f4f5', '#fb7185', '#22d3ee', '#a1a1aa']) {
      expect([hue, contrast(hue, body) < 3.2]).toEqual([hue, true]);               // as it is, it does not read on a light body
      expect([hue, contrast(legible(hue, 1), body) >= 4.5]).toEqual([hue, true]);  // darkened, it does
      expect(contrast(legible(hue, 1), white)).toBeGreaterThan(4.5);
    }
    expect(legible('#18181b', 1)).toBe('#18181b');
    expect(legible('#646469', 1)).toBe('#646469');                                  // a light theme's own muted text is left alone
  });

  it('turns an ink too dark to read on a dark ground near white, and leaves a light one alone', () => {
    expect(legible('#18181b', 0.02)).toBe('#f4f4f5');
    expect(legible('#052e16', 0.1)).toBe('#f4f4f5');
    expect(legible('#fde68a', 0.02)).toBe('#fde68a');
    expect(legible('not a colour', 1)).toBe('not a colour');
  });
});

describe('the look of the floor', () => {
  it('adds light on a dark floor and only shades a light one, more faintly', () => {
    const dark = floorLook('#18181b'), light = floorLook('#ffffff');
    expect(dark.dot).toContain('255,255,255');
    expect(light.dot).toContain('0,0,0');
    expect(light.light).toBe(0);
    expect(dark.light).toBeGreaterThan(0);
    expect(light.glow).toBeLessThan(dark.glow);
    const alpha = (c: string) => Number(/,([\d.]+)\)$/.exec(c)![1]);
    expect(alpha(light.shadow)).toBeLessThan(alpha(dark.shadow));
    expect(light.dusk).toBeLessThan(dark.dusk);
  });

  it('draws the stronger dot more strongly than the plain one', () => {
    const alpha = (c: string) => Number(/,([\d.]+)\)$/.exec(c)![1]);
    for (const f of ['#18181b', '#ffffff']) expect(alpha(floorLook(f).major)).toBeGreaterThan(alpha(floorLook(f).dot));
  });
});

describe('what comes in with the zoom', () => {
  it('is absent below, whole above, and ramps between', () => {
    expect(fadeIn(5, 8, 12)).toBe(0);
    expect(fadeIn(8, 8, 12)).toBe(0);
    expect(fadeIn(10, 8, 12)).toBe(0.5);
    expect(fadeIn(12, 8, 12)).toBe(1);
    expect(fadeIn(40, 8, 12)).toBe(1);
  });
});
