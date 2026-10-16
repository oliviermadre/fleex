import { describe, it, expect } from 'vitest';
import type { PlacedZone } from './layoutTimeline';
import { placeZoneMetrics } from './TimelineZones';

function zone(x0: number, x1: number, extra: Partial<PlacedZone> = {}): PlacedZone {
  return {
    status: 'doing', from: 0, to: 1, actorName: null, approximate: false, eventId: 'status:1',
    durationMs: 5 * 3_600_000, durationLabel: '5 h', humanActions: { total: 3, comments: 2, gates: 1, routes: 0 },
    current: false, x0, x1, ...extra,
  };
}

const view = { scrollLeft: 0, viewportWidth: 1000, nowX: 5000, last: false };

describe('placeZoneMetrics', () => {
  it('centres the badge on the zone when it is fully on screen', () => {
    const p = placeZoneMetrics(zone(100, 900), view);
    expect(p.mode).toBe('badge');
    if (p.mode === 'badge') expect(p.left).toBeGreaterThan(400);
  });

  it('centres on the VISIBLE part of a zone wider than the viewport, so it stays readable while scrolling', () => {
    const z = zone(0, 4000);
    const a = placeZoneMetrics(z, { ...view, scrollLeft: 0 });
    const b = placeZoneMetrics(z, { ...view, scrollLeft: 2000 });
    expect(a.mode === 'badge' && b.mode === 'badge').toBe(true);
    if (a.mode === 'badge' && b.mode === 'badge') {
      expect(a.left).toBeLessThan(1000);
      expect(b.left).toBeGreaterThan(2000);
      expect(b.left).toBeLessThan(3000);
    }
  });

  it('never overlaps the pill: pushed right of it, folded into it when there is no room', () => {
    // Centred would land on the pill (zone 0→200, pill ~6→60): pushed right.
    const pushed = placeZoneMetrics(zone(0, 220), view);
    expect(pushed.mode).toBe('badge');
    if (pushed.mode === 'badge') expect(pushed.left).toBeGreaterThanOrEqual(6 + 30 + 'Doing'.length * 6.5 + 8);
    expect(placeZoneMetrics(zone(0, 120), view).mode).toBe('pill');
  });

  it('leaves a narrow zone to the tooltip', () => {
    expect(placeZoneMetrics(zone(0, 50), view).mode).toBe('none');
  });

  it('stops the current zone at the now line (the rest is the fade)', () => {
    expect(placeZoneMetrics(zone(0, 1000), { ...view, nowX: 130, last: true }).mode).toBe('pill');
  });
});
