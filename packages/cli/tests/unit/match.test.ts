import { describe, it, expect } from 'vitest';

import { matchById } from '../../src/core/match.ts';

const items = [
  { id: 'aaaaaaaa-1111-2222-3333-444444444444', name: 'alpha' },
  { id: 'aaaaaaaa-9999-8888-7777-666666666666', name: 'alpha-2' },
  { id: 'bbbbbbbb-1111-2222-3333-444444444444', name: 'beta' },
];

describe('matchById', () => {
  it('finds a record by its full UUID', () => {
    const r = matchById(items, 'bbbbbbbb-1111-2222-3333-444444444444');
    expect(r.kind).toBe('found');
    if (r.kind === 'found') expect(r.item.name).toBe('beta');
  });

  it('finds a record by a unique id prefix', () => {
    const r = matchById(items, 'bbbbbbbb');
    expect(r.kind).toBe('found');
    if (r.kind === 'found') expect(r.item.name).toBe('beta');
  });

  it('reports ambiguity when a prefix matches several ids', () => {
    // Both alpha ids share the "aaaaaaaa" prefix.
    const r = matchById(items, 'aaaaaaaa');
    expect(r.kind).toBe('ambiguous');
    if (r.kind === 'ambiguous') expect(r.matches).toHaveLength(2);
  });

  it('prefers an exact id over a prefix collision', () => {
    // The full id is unambiguous even though its prefix collides.
    const r = matchById(items, 'aaaaaaaa-1111-2222-3333-444444444444');
    expect(r.kind).toBe('found');
    if (r.kind === 'found') expect(r.item.name).toBe('alpha');
  });

  it('tolerates a leading "#" copied from list output (prefix)', () => {
    // Lists no longer print a leading '#', but a user may still type one.
    const r = matchById(items, '#bbbbbbbb');
    expect(r.kind).toBe('found');
    if (r.kind === 'found') expect(r.item.name).toBe('beta');
  });

  it('tolerates a leading "#" on a full UUID', () => {
    const r = matchById(items, '#bbbbbbbb-1111-2222-3333-444444444444');
    expect(r.kind).toBe('found');
    if (r.kind === 'found') expect(r.item.name).toBe('beta');
  });

  it('returns none for an unknown id', () => {
    expect(matchById(items, 'zzzz').kind).toBe('none');
  });

  it('returns none for empty/whitespace input (never matches everything)', () => {
    expect(matchById(items, '').kind).toBe('none');
    expect(matchById(items, '   ').kind).toBe('none');
  });
});
