import { describe, it, expect } from 'vitest';
import type { AgendaItem } from '@fleex/shared';
import { itemHue, labelHue, routineColorKey } from './agendaLabels';

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

  it('ignores a stored colour that is not a known tint', () => {
    expect(labelHue('pr.merged', { 'pr.merged': '#ff0000' })).toBe('purple');
  });
});
