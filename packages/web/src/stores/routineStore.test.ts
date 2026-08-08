import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { TicketDeliverable } from '@fleex/shared';

vi.mock('../services/api', () => ({}));

import { useRoutineStore } from './routineStore';
import type { RoutineRunDetail } from '../services/api';

function deliverable(id: string, type: string): TicketDeliverable {
  return { id, type, title: `d-${id}` } as TicketDeliverable;
}

function run(id: string, deliverables: TicketDeliverable[]): RoutineRunDetail {
  return { run: { id }, deliverables } as unknown as RoutineRunDetail;
}

describe('routineStore.applyDeliverableUpdate', () => {
  beforeEach(() => {
    useRoutineStore.setState({ runs: [] });
  });

  it('replaces the deliverable in the run that holds it', () => {
    // WHY: the type is changed from the reading overlay, which lives outside the
    // routine tree. Without this patch the "Recent deliverables" list keeps the
    // type captured at fetchRoutineRuns time (#badge-not-reactive).
    useRoutineStore.setState({ runs: [run('r1', [deliverable('d1', 'report')])] });

    useRoutineStore.getState().applyDeliverableUpdate(deliverable('d1', 'briefing'));

    expect(useRoutineStore.getState().runs[0]!.deliverables[0]!.type).toBe('briefing');
  });

  it('leaves runs untouched (same reference) when the deliverable is unknown', () => {
    const runs = [run('r1', [deliverable('d1', 'report')])];
    useRoutineStore.setState({ runs });

    useRoutineStore.getState().applyDeliverableUpdate(deliverable('other', 'briefing'));

    expect(useRoutineStore.getState().runs).toBe(runs);
  });

  it('keeps the identity of runs that do not hold the deliverable', () => {
    const untouched = run('r2', [deliverable('d2', 'report')]);
    useRoutineStore.setState({ runs: [run('r1', [deliverable('d1', 'report')]), untouched] });

    useRoutineStore.getState().applyDeliverableUpdate(deliverable('d1', 'briefing'));

    expect(useRoutineStore.getState().runs[1]).toBe(untouched);
  });
});
