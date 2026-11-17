import { describe, it, expect } from 'vitest';
import { advance, ahead, follow, paceFor, TRAIL_S, type Track, type TrackPos } from './ticketMotion';

/** A line of tiles a, b, c… each carrying east; the ones in `fast` twice as fast. */
const line = (ids: string, fast = ''): Track => ({
  next: (at) => { const i = ids.indexOf(at.id); return i >= 0 && i < ids.length - 1 ? { id: ids[i + 1]!, fx: 1, fy: 0 } : null; },
  pace: (at) => (fast.includes(at.id) ? 2.4 : 1.2),
});
const at = (id: string, p: number): TrackPos => ({ id, p, fx: 1, fy: 0 });

describe('a ticket drawn along its belts between two reports', () => {
  const track = line('abcdef');

  it('measures how far ahead the server has it, along the belts', () => {
    expect(ahead(track, at('a', 0.2), at('a', 0.7))).toBeCloseTo(0.5);
    expect(ahead(track, at('a', 0.5), at('c', 0.25))).toBeCloseTo(1.75);
    expect(ahead(track, at('c', 0.5), at('a', 0.5))).toBeNull();          // behind: not something to catch up with
    expect(ahead(track, at('a', 0.5), at('z', 0.5))).toBeNull();          // not on this track
    expect(ahead(line('abcdefghijkl'), at('a', 0), at('l', 0))).toBeNull(); // too far to be the same journey
  });

  it('moves along the belts, tile after tile, and never past where the server has it', () => {
    expect(advance(track, at('a', 0.5), at('c', 0.5), 0.2)).toEqual(at('a', 0.7));
    expect(advance(track, at('a', 0.5), at('c', 0.5), 1.25)).toEqual(at('b', 0.75));
    expect(advance(track, at('a', 0.5), at('c', 0.5), 99)).toEqual(at('c', 0.5));
  });

  it('goes at the belt\'s pace at the usual lag, faster when behind, slower as it closes in', () => {
    const usual = 1.2 * TRAIL_S;
    expect(paceFor(usual, 1.2)).toBeCloseTo(1.2);
    expect(paceFor(usual * 2, 1.2)).toBeGreaterThan(1.2);
    expect(paceFor(usual * 2, 1.2)).toBeLessThanOrEqual(1.2 * 2.5);
    expect(paceFor(0, 1.2)).toBeGreaterThan(0);                            // it still arrives
    expect(paceFor(0, 1.2)).toBeLessThan(1.2);
  });

  it('never stands still while the server keeps moving the ticket, whatever the timing of the reports', () => {
    /* the server moves it 1.2 tiles a second in ticks of 250 ms, the page hears of it every 600 ms, and draws 60 times a second */
    const long = line('abcdefghijklmnopqrstuvwxyz');
    let server = 0, shown: TrackPos | undefined, told = at('a', 0), slowest = Infinity, fastest = 0;
    const where = (d: number) => at('abcdefghijklmnopqrstuvwxyz'[Math.floor(d)]!, d % 1);
    const dist = (p: TrackPos) => 'abcdefghijklmnopqrstuvwxyz'.indexOf(p.id) + p.p;
    for (let ms = 0; ms < 12_000; ms += 1000 / 60) {
      server = Math.floor(ms / 250) * 0.3;
      if (Math.floor(ms / 600) !== Math.floor((ms - 1000 / 60) / 600)) told = where(server);
      const before = shown ? dist(shown) : dist(told);
      shown = follow(long, shown, told, 1 / 60);
      const speed = (dist(shown) - before) * 60;
      if (ms > 2000) { slowest = Math.min(slowest, speed); fastest = Math.max(fastest, speed); }
      expect(dist(shown)).toBeLessThanOrEqual(dist(told) + 1e-9);
    }
    expect(slowest).toBeGreaterThan(0.5);                                   // it never stops, nor crawls
    expect(fastest).toBeLessThan(2.4);                                      // and never darts
  });

  it('stops where the ticket stopped, goes twice as fast on a fast belt, and jumps only when it has to', () => {
    let shown: TrackPos | undefined = at('a', 0.2);
    for (let i = 0; i < 240; i++) shown = follow(track, shown, at('b', 0.5), 1 / 60);
    expect(shown).toEqual(at('b', 0.5));
    const slow = follow(line('abc'), at('a', 0), at('c', 0.9), 0.1), quick = follow(line('abc', 'abc'), at('a', 0), at('c', 0.9), 0.1);
    expect(quick.p).toBeGreaterThan(slow.p * 1.3);
    /* moved by hand to somewhere else, or seen for the first time: drawn where it is */
    expect(follow(track, at('e', 0.5), at('a', 0.1), 1 / 60)).toEqual(at('a', 0.1));
    expect(follow(track, undefined, at('c', 0.3), 1 / 60)).toEqual(at('c', 0.3));
  });
});
