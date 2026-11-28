import { describe, expect, it } from 'vitest';
import { groupTickets, matches, shortState } from './ticketList';
import { MACHINES, tk } from './fixture';

const m = (id: string) => MACHINES.find((x) => x.id === id)!;

describe('the tickets of the floor as a list', () => {
  it('groups them by the machine they stand in, the machines from left to right, then what travels, then the floor', () => {
    const groups = groupTickets([
      tk(1, 'gate', 'review'), tk(2, 'inbound', 'zone'), tk(3, 'build', 'running'), tk(4, 'belt', 'belt'), tk(5, null, 'loose'), tk(6, 'build', 'question'), tk(7, 'arm', 'arm'),
    ], MACHINES);
    expect(groups.map((g) => [g.title, g.word, g.tickets.map((t) => t.info!.displayId)])).toEqual([
      ['Inbound', 'INBOUND', [2]], ['Build', 'AGENT', [3, 6]], ['PR Review', 'GATE', [1]], ['On its way', 'BELTS AND ARMS', [4, 7]], ['On the floor', 'NO MACHINE', [5]],
    ]);
    expect(groups[1]!.hue).toBe('#a78bfa');                 // an agent's violet, as on the floor
    expect(groups[2]!.hue).toBe('var(--theme-warning)');   // a gate's amber
    expect(groups[0]!.hue).toBeNull();
  });

  it('says which tickets a zone still holds, and leaves machines that hold nothing out', () => {
    const [inbound, ...rest] = groupTickets([tk(1, 'inbound', 'zone'), tk(2, 'inbound', 'zone', 1, { released: true }), tk(3, 'inbound', 'zone')], MACHINES);
    expect(inbound!.held.map((t) => t.info!.displayId)).toEqual([1, 3]);
    expect(rest).toEqual([]);
  });

  it('leaves items out: the phone lists tickets only', () => {
    const item = tk(9, 'inbound', 'zone', 1, { item: { source: 'gmail', author: 'a', excerpt: '', url: null, messages: 1, lastActivityAt: '' } });
    expect(groupTickets([item], MACHINES)).toEqual([]);
  });

  it('counts a ticket lying on a machine that is gone, or loose on one, as on the floor', () => {
    expect(groupTickets([tk(1, 'removed', 'running'), tk(2, 'build', 'loose')], MACHINES).map((g) => g.title)).toEqual(['On the floor']);
  });
});

describe('finding a ticket', () => {
  const t = tk(412, 'gate', 'review', 1, { title: 'Stripe webhook retries', tags: ['payments', 'type:major'] });
  it('by its number, with or without the hash, a word of its title, its type or a tag', () => {
    for (const q of ['412', '#412', 'webhook', 'STRIPE', 'bug', 'paym', 'type:maj', '  ', '']) expect(matches(t, q)).toBe(true);
    for (const q of ['413', 'deploy', 'feature']) expect(matches(t, q)).toBe(false);
  });
  it('never matches a ticket whose details are not known, unless nothing is asked', () => {
    expect(matches({ ...t, info: null }, '412')).toBe(false);
    expect(matches({ ...t, info: null }, '')).toBe(true);
  });
});

describe('where a ticket is at, in a word', () => {
  it('says so, and whether it waits for someone', () => {
    expect(shortState(tk(1, 'gate', 'review'), m('gate'))).toEqual({ text: 'decision', needs: true });
    expect(shortState(tk(1, 'build', 'running'), m('build'))).toEqual({ text: 'running', needs: false });
    expect(shortState(tk(1, 'inbound', 'zone'), m('inbound'))).toEqual({ text: 'held', needs: false });
    expect(shortState(tk(1, 'inbound', 'zone', 1, { released: true }), m('inbound'))).toEqual({ text: 'released', needs: false });
    expect(shortState(tk(1, 'qa', 'zone'), m('qa'))).toEqual({ text: 'for you', needs: true });
    expect(shortState(tk(1, 'belt', 'belt', 1, { outcome: 'question' }), m('belt'))).toEqual({ text: 'on its way', needs: true });
  });
});
