import { describe, expect, it } from 'vitest';
import { builtBox, hallOf, propsIn, ROOM, treesIn, WALL_H, wallThings } from './decor';
import { layout } from './shots/fixture';
import type { FactoryLayout } from './types';

const floor = { x: -150, y: -70, w: 330, h: 160 };
const view = { x: -20, y: -20, w: 70, h: 50 };

describe('the decor', () => {
  it('builds its hall round what is built, a few tiles off, or at the edge of the floor', () => {
    const b = builtBox(layout.machines)!, hall = hallOf(layout, floor, 'built');
    expect(hall).toEqual({ x: b.x - ROOM, y: Math.min(b.y, ...layout.machines.map((m) => m.y)) - ROOM, w: hall.w, h: hall.h });
    for (const m of layout.machines) expect(m.x >= hall.x && m.y >= hall.y && m.x + m.w <= hall.x + hall.w && m.y + m.h <= hall.y + hall.h, m.id).toBe(true);
    expect(hallOf(layout, floor, 'map')).toMatchObject({ x: floor.x + 1, y: floor.y + WALL_H });
  });

  it('puts props on free tiles only, a tile off every machine, and the same ones each time', () => {
    const hall = hallOf(layout, floor, 'built'), props = propsIn(layout, hall, view, 2);
    expect(props.length).toBeGreaterThan(5);
    expect(propsIn(layout, hall, view, 2)).toEqual(props);
    for (const p of props) for (const m of layout.machines) {
      if (m.kind === 'label') continue;
      const pad = m.kind === 'area' ? 0 : 1;
      expect(p.x >= m.x - pad && p.x < m.x + m.w + pad && p.y >= m.y - pad && p.y < m.y + m.h + pad, `${p.kind} at ${p.x},${p.y} by ${m.id}`).toBe(false);
    }
    expect(propsIn(layout, hall, view, 0)).toEqual([]);
    expect(propsIn(layout, hall, view, 1).length).toBeLessThan(props.length);
  });

  it('moves with the floor: a machine built on a prop takes its place', () => {
    const hall = hallOf(layout, floor, 'built'), p = propsIn(layout, hall, view, 2)[0]!;
    const more: FactoryLayout = { ...layout, machines: [...layout.machines, { id: 'new', kind: 'belt', x: p.x, y: p.y, w: 1, h: 1, dir: 0 }] };
    expect(propsIn(more, hallOf(more, floor, 'built'), view, 2).some((q) => q.x === p.x && q.y === p.y)).toBe(false);
  });

  it('hangs its sign over what is built, and nothing on the wall overlaps', () => {
    const hall = hallOf(layout, floor, 'built'), things = wallThings(hall, builtBox(layout.machines));
    expect(things.filter((t) => t.kind === 'sign')).toHaveLength(1);
    for (let i = 1; i < things.length; i++) expect(things[i]!.x).toBeGreaterThanOrEqual(things[i - 1]!.x + things[i - 1]!.w);
    for (const t of things) expect(t.x >= hall.x && t.x + t.w <= hall.x + hall.w).toBe(true);
  });

  it('keeps its trees in the yard, off the walls and apart', () => {
    const hall = hallOf(layout, floor, 'built'), trees = treesIn(hall, floor, { x: -40, y: -40, w: 110, h: 90 });
    expect(trees.length).toBeGreaterThan(3);
    for (const t of trees) expect(t.x + 2 <= hall.x - 1 || t.x > hall.x + hall.w || t.y + 2 <= hall.y - WALL_H || t.y > hall.y + hall.h).toBe(true);
  });
});
