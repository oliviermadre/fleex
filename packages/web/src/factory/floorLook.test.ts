import { describe, expect, it } from 'vitest';
import { channels, fadeIn, floorLook, glows, isLight, mix, stationState, veil } from './floorLook';
import type { FactoryTicket } from './types';

const t = (phase: FactoryTicket['phase']): FactoryTicket => ({ ticketId: phase, machineId: 'm', info: null, x: 0, y: 0, phase, p: 0, fx: 1, fy: 0, outcome: '', released: false, since: '', runId: null, note: '', handedAt: '' });

describe('what a station is doing', () => {
  it('names the most pressing thing among its tickets', () => {
    expect(stationState([])).toBe('idle');
    expect(stationState([t('out')])).toBe('idle');
    expect(stationState([t('wait')])).toBe('queue');
    expect(stationState([t('wait'), t('running')])).toBe('running');
    expect(stationState([t('running'), t('review')])).toBe('call');
    expect(stationState([t('running'), t('question')])).toBe('call');
    expect(stationState([t('review'), t('running'), t('failed')])).toBe('failed');
  });

  it('lights the floor when it works or waits for a human, and stays dark otherwise', () => {
    expect((['failed', 'call', 'running', 'queue', 'idle'] as const).filter(glows)).toEqual(['failed', 'call', 'running']);
  });
});

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
