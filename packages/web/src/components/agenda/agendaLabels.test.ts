import { describe, it, expect } from 'vitest';
import type { AgendaItem } from '@fleex/shared';
import { BASE_SWATCHES, CHIP_BASE, chipStyle, hatchTextBackdrop, showRunDot, colorToken, itemHue, labelHue, routineColorKey } from './agendaLabels';

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

  it('never lets the hour lines show through a chip: every background ends on the opaque surface, nothing is see-through', () => {
    const ext = (rsvp: 'needsAction' | 'tentative' | 'declined' | 'accepted'): AgendaItem => ({
      id: `external:${rsvp}`, type: 'external', shape: 'block', start: '', title: rsvp,
      external: { rsvp } as AgendaItem['external'],
    });
    const items: AgendaItem[] = [
      run('sync'),
      { ...run('sync'), type: 'routine.upcoming' },
      { ...run('sync'), type: 'routine.skipped' },
      { ...run('sync'), type: 'routine.missed' },
      { ...run('sync'), overdue: true },
      ext('needsAction'), ext('tentative'), ext('declined'), ext('accepted'),
    ];
    for (const item of items) {
      const style = chipStyle(item, { [routineColorKey('sync')]: '#123abc' });
      expect(String(style.background).endsWith(CHIP_BASE)).toBe(true);
      expect(style.opacity).toBe(1);
    }
  });

  it('fades upcoming and declined chips through muted text, not opacity', () => {
    const upcoming = chipStyle({ ...run('sync'), type: 'routine.upcoming' });
    expect(upcoming.color).toBe('var(--theme-text-muted)');
    expect(upcoming.opacity).toBe(1);
  });

  it('still dims search misses: that transparency is deliberate', () => {
    expect(chipStyle(run('sync'), {}, 'dim').opacity).toBe(0.2);
  });

  it('shows a run dot only while running or when failed', () => {
    expect(showRunDot('running')).toBe(true);
    expect(showRunDot('failed')).toBe(true);
    for (const st of ['completed', 'cancelled', null, undefined]) expect(showRunDot(st)).toBe(false);
  });

  it('backs text with the chip fill only when the item has wait hatches', () => {
    expect(hatchTextBackdrop(run('sync'))).toBeNull();
    const waiting = { ...run('sync'), segments: [{ kind: 'gate' as const, stepName: 's', start: '', end: null }] } as AgendaItem;
    expect(String(hatchTextBackdrop(waiting)!.background).endsWith(CHIP_BASE)).toBe(true);
  });
});
