import { describe, it, expect, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, cleanup } from '@testing-library/react';
import type { PlacedZone } from './layoutTimeline';
import { placeZoneMetrics, TimelineZonePills } from './TimelineZones';

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

  it('clears a pill with a long actor name (workflow runs): the pill is capped, the badge sits past the cap', () => {
    // "Doing par workflow:Spec Dev PR (HITL)" ≈ 270 px of text: the rendered pill is capped at
    // 150 px (actor truncated). A badge placed against an uncapped estimate — or a pill left
    // uncapped — would overlap the pill's text.
    const z = zone(0, 600, { actorName: 'workflow:Spec Dev PR (HITL)' });
    const p = placeZoneMetrics(z, view);
    expect(p.mode).toBe('badge');
    if (p.mode === 'badge') expect(p.left).toBeGreaterThanOrEqual(6 + 150 + 8);
  });

  it('leaves a narrow zone to the tooltip', () => {
    expect(placeZoneMetrics(zone(0, 50), view).mode).toBe('none');
  });

  it('stops the current zone at the now line (the rest is the fade)', () => {
    expect(placeZoneMetrics(zone(0, 1000), { ...view, nowX: 130, last: true }).mode).toBe('pill');
  });
});

describe('TimelineZonePills', () => {
  afterEach(cleanup);

  const renderPill = (z: PlacedZone, scrollLeft = 0) => {
    const { container } = render(createElement(TimelineZonePills, {
      zones: [z], events: new Map(), scrollLeft, viewportWidth: 1000, nowX: 5000,
    }));
    return container.querySelector<HTMLElement>('[data-timeline-node]')!;
  };

  it('caps a pill with a long actor at the width the badge is placed against, so the badge never covers it', () => {
    const pill = renderPill(zone(0, 600, { actorName: 'workflow:Spec Dev PR (HITL)' }));
    expect(parseFloat(pill.style.maxWidth)).toBeLessThanOrEqual(150);
  });

  it('keeps a pill with folded-in metrics inside its zone while scrolling to its end', () => {
    // Zone 0→220 with a long actor: no room for a badge, so the metrics fold into the pill,
    // which grows to the zone's width (208 px). Scrolled to the zone's end, the sticky pill must
    // stop at x1 − its real width − 6, not at x1 − 150 (it would spill ~50 px into the next zone).
    const z = zone(0, 220, { actorName: 'workflow:Spec Dev PR (HITL)' });
    expect(placeZoneMetrics(z, { ...view, scrollLeft: 200 }).mode).toBe('pill');
    const pill = renderPill(z, 200);
    expect(parseFloat(pill.style.left) + parseFloat(pill.style.maxWidth)).toBeLessThanOrEqual(220);
  });
});
