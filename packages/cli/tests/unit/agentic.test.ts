import { describe, it, expect } from 'vitest';

import { editDistance, handle, resolveFromList, suggest, trunc } from '../../src/core/agentic.ts';

describe('handle', () => {
  it('builds a @type:name mention token', () => {
    expect(handle('agent', 'builder')).toBe('@agent:builder');
    expect(handle('skill', 'ship')).toBe('@skill:ship');
    expect(handle('panel', 'chapeaux')).toBe('@panel:chapeaux');
    expect(handle('workflow', 'spec-dev-pr')).toBe('@workflow:spec-dev-pr');
  });
});

describe('editDistance', () => {
  it('is 0 for identical strings', () => {
    expect(editDistance('builder', 'builder')).toBe(0);
  });
  it('counts single edits', () => {
    expect(editDistance('buidler', 'builder')).toBe(2); // transposition = 2 edits
    expect(editDistance('ship', 'shp')).toBe(1);
  });
});

describe('suggest', () => {
  const names = ['builder', 'catalyst', 'reviewer'];
  it('suggests the closest candidate on a typo', () => {
    expect(suggest('buidler', names)).toBe('builder');
    expect(suggest('catalist', names)).toBe('catalyst');
  });
  it('returns undefined when nothing is close enough', () => {
    expect(suggest('zzzzzzzz', names)).toBeUndefined();
  });
});

describe('resolveFromList', () => {
  interface Item {
    id: string;
    name: string;
    displayName: string;
  }
  const list: Item[] = [
    { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', name: 'builder', displayName: 'The Builder' },
    { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', name: 'catalyst', displayName: 'The Catalyst' },
  ];
  const handleOf = (x: Item) => x.name;
  const displayOf = (x: Item) => x.displayName;

  it('matches by UUID', () => {
    expect(resolveFromList('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', list, handleOf)?.name).toBe(
      'builder',
    );
  });
  it('matches by handle name (case-insensitive)', () => {
    expect(resolveFromList('BUILDER', list, handleOf)?.name).toBe('builder');
  });
  it('falls back to displayName when provided', () => {
    expect(resolveFromList('the catalyst', list, handleOf, displayOf)?.name).toBe('catalyst');
  });
  it('returns undefined when nothing matches', () => {
    expect(resolveFromList('nope', list, handleOf, displayOf)).toBeUndefined();
  });
});

describe('trunc', () => {
  it('leaves short strings untouched', () => {
    expect(trunc('hello', 10)).toBe('hello');
  });
  it('collapses whitespace and adds an ellipsis when cut', () => {
    expect(trunc('a very  long   description here', 10)).toBe('a very lo…');
  });
});
