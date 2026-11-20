import { describe, expect, it } from 'vitest';
import { hallOf } from './decor';
import { Crowd, pathOn, spotAt, walkable } from './people';
import { layout } from './shots/fixture';

const floor = { x: -150, y: -70, w: 330, h: 160 }, hall = hallOf(layout, floor, 'built');
const gate = layout.machines.find((m) => m.id === 'st_gate')!;
const run = (c: Crowd, seconds: number, waiting = [gate], opts = { walkers: 1 as const, gate: true, hands: true }) => {
  for (let t = 0; t < seconds; t += 0.05) c.update(0.05, layout, hall, new Set(), waiting, opts);
  return c.people;
};

describe('the people of the floor', () => {
  it('walk on free tiles only: no machine, no area', () => {
    const free = walkable(layout, hall);
    for (const m of layout.machines) if (m.kind !== 'label') expect(free.has(`${m.x},${m.y}`), m.id).toBe(false);
    const path = pathOn(free, { x: hall.x, y: hall.y }, { x: hall.x + hall.w - 1, y: hall.y + hall.h - 1 })!;
    expect(path.length).toBeGreaterThan(20);
    for (const t of path) expect(free.has(`${t.x},${t.y}`)).toBe(true);
    for (let i = 1; i < path.length; i++) expect(Math.abs(path[i]!.x - path[i - 1]!.x) + Math.abs(path[i]!.y - path[i - 1]!.y)).toBe(1);
  });

  it('send someone to wait at the foot of a gate that waits, and back to walking once it no longer does', () => {
    const c = new Crowd(), spot = spotAt(gate, walkable(layout, hall))!;
    const reviewer = run(c, 40).find((p) => p.role === 'reviewer')!;
    expect({ x: Math.round(reviewer.x), y: Math.round(reviewer.y) }).toEqual(spot);
    expect(run(c, 1, []).some((p) => p.role === 'reviewer')).toBe(false);
  });

  it('are few, and stand still for whoever asked for less motion', () => {
    const c = new Crowd(), walkers = run(c, 1).filter((p) => p.role === 'walker');
    expect(walkers.length).toBeGreaterThanOrEqual(1);
    expect(walkers.length).toBeLessThanOrEqual(5);
    const still = new Crowd(), first = run(still, 0.1, [gate], { walkers: 1, gate: true, hands: true }).map((p) => [p.x, p.y]);
    for (let t = 0; t < 5; t += 0.05) still.update(0.05, layout, hall, new Set(), [gate], { walkers: 1, gate: true, hands: true, still: true });
    expect(still.people.map((p) => [p.x, p.y])).toEqual(first);
  });
});
