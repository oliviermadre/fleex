import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULT_SHOW, loadShow, saveShow, TOGGLES } from './viewToggles';

beforeEach(() => window.localStorage.clear());

describe('what the floor shows', () => {
  it('starts with the arm rules and the grid, without every name and number', () => {
    expect(loadShow()).toEqual({ names: false, arms: true, numbers: false, grid: true });
    expect(TOGGLES.map((t) => t.key)).toEqual(['names', 'arms', 'numbers', 'grid']);
  });

  it('remembers what was chosen', () => {
    saveShow({ ...DEFAULT_SHOW, names: true, grid: false });
    expect(loadShow()).toEqual({ names: true, arms: true, numbers: false, grid: false });
  });

  it('falls back to the defaults for whatever it cannot read', () => {
    window.localStorage.setItem('fleex.factory.show', '{not json');
    expect(loadShow()).toEqual(DEFAULT_SHOW);
    window.localStorage.setItem('fleex.factory.show', JSON.stringify({ names: 'yes', arms: false, other: true }));
    expect(loadShow()).toEqual({ ...DEFAULT_SHOW, arms: false });
    window.localStorage.setItem('fleex.factory.show', '"a string"');
    expect(loadShow()).toEqual(DEFAULT_SHOW);
  });

  it('gives a fresh copy each time', () => {
    const a = loadShow(); a.names = true;
    expect(loadShow().names).toBe(false);
    expect(DEFAULT_SHOW.names).toBe(false);
  });
});
