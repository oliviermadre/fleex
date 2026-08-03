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

  it('tolerates a leading "#" copied out of list output', () => {
    const r = pickBoard(boards, '#aaaaaaaa');
    expect(r.kind).toBe('found');
    if (r.kind === 'found') expect(r.item.name).toBe('Roadmap');
  });

  it('returns none for an empty input rather than matching arbitrarily', () => {
    expect(pickBoard(boards, '').kind).toBe('none');
    expect(pickBoard(boards, '   ').kind).toBe('none');
  });

  it('reports an ambiguous id prefix instead of picking the first match', () => {
    // Silently choosing one of these would file a ticket on the wrong board.
    const twins: Board[] = [
      { id: 'eeeeeeee-1111-2222-3333-444444444444', name: 'One' },
      { id: 'eeeeeeee-9999-8888-7777-666666666666', name: 'Two' },
    ];
    const r = pickBoard(twins, 'eeeeeeee');
    expect(r.kind).toBe('ambiguous');
    if (r.kind === 'ambiguous') expect(r.matches).toHaveLength(2);
  });

  it('reports duplicate board names as ambiguous', () => {
    const dupes: Board[] = [
      { id: 'aaaaaaaa-1111-2222-3333-444444444444', name: 'Inbox' },
      { id: 'bbbbbbbb-1111-2222-3333-444444444444', name: 'inbox' },
    ];
    expect(pickBoard(dupes, 'Inbox').kind).toBe('ambiguous');
  });
});
