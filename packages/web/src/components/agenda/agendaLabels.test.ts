import { describe, it, expect } from 'vitest';
import type { AgendaItem } from '@fleex/shared';
import { BASE_SWATCHES, chipStyle, colorToken, itemHue, labelHue, routineColorKey } from './agendaLabels';

const run = (routineId: string): AgendaItem => ({
  id: `routine.run:${routineId}`, type: 'routine.run', shape: 'block', start: '', title: routineId,
  routine: { id: routineId, name: routineId, emoji: '' },
});

describe('agenda colours', () => {
  it('draws merged PRs in GitHub\'s merged purple, as the Tasks PR glyph does', () => {
    expect(labelHue('pr.merged')).toBe('purple');
  });

  it('routine runs no longer share the merged-PR purple by default', () => {
    expect(labelHue('routine.run')).not.toBe(labelHue('pr.merged'));
  });

  it('resolves an item hue most specific first: routine pick, then label pick, then default', () => {
    const colors = { 'routine.run': 'teal', [routineColorKey('sync')]: 'orange' };
    expect(itemHue(run('sync'), colors)).toBe('orange');
    expect(itemHue(run('other'), colors)).toBe('teal');
    expect(itemHue(run('other'), {})).toBe(labelHue('routine.run'));
  });

  it('keeps a custom hex pick, ignores anything else', () => {
    expect(labelHue('pr.merged', { 'pr.merged': '#FF0000' })).toBe('#ff0000');
    expect(labelHue('pr.merged', { 'pr.merged': 'red; background: url(x)' })).toBe('purple');
    expect(labelHue('pr.merged', { 'pr.merged': '#fff' })).toBe('purple');
  });

  it('offers 15 distinct base colours', () => {
    expect(new Set(BASE_SWATCHES).size).toBe(15);
  });

  it('draws a custom hex with derived, theme-relative tokens', () => {
    expect(colorToken('teal', 'bg')).toBe('var(--tint-teal-bg)');
    expect(colorToken('#123abc', 'solid')).toBe('#123abc');
    expect(colorToken('#123abc', 'bg')).toContain('color-mix');
    expect(chipStyle(run('sync'), { [routineColorKey('sync')]: '#123abc' }).borderLeft).toContain('#123abc');
  });

  it('keeps the left accent border solid on upcoming and skipped chips — only the outline is dashed', () => {
    for (const type of ['routine.upcoming', 'routine.skipped'] as const) {
      const style = chipStyle({ ...run('sync'), type, shape: 'point' });
      expect(style.borderLeft).toMatch(/^3px solid /);
      expect(style.border).toMatch(/dashed/);
    }
  });
});
