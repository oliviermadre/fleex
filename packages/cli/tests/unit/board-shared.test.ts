import { describe, it, expect } from 'vitest';
import { pickBoard, type Board } from '../../src/commands/board/_shared.ts';

const boards: Board[] = [
  { id: 'aaaaaaaa-1111-2222-3333-444444444444', name: 'Roadmap', emoji: '🗺️' },
  { id: 'bbbbbbbb-1111-2222-3333-444444444444', name: 'Bugs' },
  { id: 'cccccccc-1111-2222-3333-444444444444', name: 'bugs backlog' },
];

describe('pickBoard', () => {
  it('matches by full UUID', () => {
    const r = pickBoard(boards, 'bbbbbbbb-1111-2222-3333-444444444444');
    expect(r.kind).toBe('found');
    if (r.kind === 'found') expect(r.item.name).toBe('Bugs');
  });

  it('matches by 8-char id prefix', () => {
    const r = pickBoard(boards, 'aaaaaaaa');
    expect(r.kind).toBe('found');
    if (r.kind === 'found') expect(r.item.name).toBe('Roadmap');
  });

  it('matches by case-insensitive exact name', () => {
    const r = pickBoard(boards, 'roadmap');
    expect(r.kind).toBe('found');
    if (r.kind === 'found') expect(r.item.id).toBe('aaaaaaaa-1111-2222-3333-444444444444');
  });

  it('does not fuzzy/partial match names (exact only)', () => {
    // "bugs" exactly matches one board even though another contains "bugs".
    const r = pickBoard(boards, 'bugs');
    expect(r.kind).toBe('found');
    if (r.kind === 'found') expect(r.item.name).toBe('Bugs');
  });

  it('returns none when nothing matches', () => {
    expect(pickBoard(boards, 'nope').kind).toBe('none');
  });
});
