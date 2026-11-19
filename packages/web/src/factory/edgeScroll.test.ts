import { describe, it, expect } from 'vitest';
import { EDGE_FAST, EDGE_SLOW, EDGE_ZONE, edgeCursorCss, edgeDir, edgePush } from './edgeScroll';

const page = { left: 64, top: 44, right: 1440, bottom: 860 };

describe('gliding the view by the edges of the page', () => {
  it('does nothing away from every edge, nor outside the page', () => {
    expect(edgePush(700, 400, page)).toEqual({ vx: 0, vy: 0 });
    expect(edgePush(64 + EDGE_ZONE, 400, page)).toEqual({ vx: 0, vy: 0 });      // the zone starts just inside this
    expect(edgePush(30, 400, page)).toEqual({ vx: 0, vy: 0 });                  // over the app's own navigation
    expect(edgePush(700, 20, page)).toEqual({ vx: 0, vy: 0 });                  // over the top bar
  });

  it('starts barely moving at the start of the zone and is fastest against the edge', () => {
    const start = edgePush(64 + EDGE_ZONE - 1, 400, page).vx, mid = edgePush(64 + EDGE_ZONE / 2, 400, page).vx, edge = edgePush(64, 400, page).vx;
    expect(start).toBeLessThan(0);                                                // towards the left edge
    expect(-start).toBeGreaterThanOrEqual(EDGE_SLOW);
    expect(-start).toBeLessThan(EDGE_SLOW + 5);
    expect(-mid).toBeGreaterThan(-start);
    expect(-mid).toBeLessThan((EDGE_SLOW + EDGE_FAST) / 2);                       // it eases in: half way is well under half speed
    expect(-edge).toBe(EDGE_FAST);
  });

  it('pulls towards each of the four edges, and both ways in a corner', () => {
    expect(edgeDir(...Object.values(edgePush(70, 400, page)) as [number, number])).toBe('w');
    expect(edgeDir(...Object.values(edgePush(1435, 400, page)) as [number, number])).toBe('e');
    expect(edgeDir(...Object.values(edgePush(700, 50, page)) as [number, number])).toBe('n');
    expect(edgeDir(...Object.values(edgePush(700, 855, page)) as [number, number])).toBe('s');   // the bottom of the window, under the console
    expect(edgeDir(...Object.values(edgePush(70, 855, page)) as [number, number])).toBe('sw');
    expect(edgeDir(0, 0)).toBeNull();
  });

  it('has an arrowhead for each of the eight directions', () => {
    const css = edgeCursorCss('.page');
    for (const d of ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']) expect(css).toContain(`.page[data-edge="${d}"] *`);
    expect(css.match(/!important/g)).toHaveLength(8);
  });
});
