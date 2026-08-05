import { describe, it, expect } from 'vitest';
import type { TicketDeliverable } from '@fleex/shared';
import { splitStepDeliverables } from './stepDeliverableSplit';

function deliverable(
  id: string,
  title: string,
  createdAt: string,
  stepRunId?: string,
): TicketDeliverable {
  return { id, title, createdAt, stepRunId: stepRunId ?? null } as TicketDeliverable;
}

describe('splitStepDeliverables', () => {
  it('picks the attempt by its step run, not by its title', () => {
    // Why this beats the title heuristic: two attempts, and the *older* one
    // reused the title the latest output reports. On titles alone the discarded
    // attempt would be presented as what the run just produced.
    const all = [
      deliverable('d1', 'Review', '2026-08-01T12:00:00Z', 'sr-1'),
      deliverable('d2', 'Rapport final', '2026-08-01T10:00:00Z', 'sr-2'),
    ];

    const { latestDeliverable, previousDeliverables } = splitStepDeliverables(all, 'Review', 'sr-2');

    expect(latestDeliverable?.id).toBe('d2');
    expect(previousDeliverables.map((d) => d.id)).toEqual(['d1']);
  });

  it('falls back to the title when the step run produced nothing anchored', () => {
    // Deliverables written before the step anchor existed carry no stepRunId;
    // dropping to history wholesale would hide the run's actual output.
    const all = [deliverable('d1', 'Review', '2026-08-01T10:00:00Z')];

    const { latestDeliverable } = splitStepDeliverables(all, 'Review', 'sr-1');

    expect(latestDeliverable?.id).toBe('d1');
  });

  it('pulls the latest attempt out of the history', () => {
    // The reason the split exists: three attempts on a step used to produce one
    // flat "Deliverables" list where nothing said which one the run just made.
    const all = [
      deliverable('d1', 'Review', '2026-08-01T10:00:00Z'),
      deliverable('d2', 'Review', '2026-08-01T12:00:00Z'),
    ];

    const { latestDeliverable, previousDeliverables } = splitStepDeliverables(all, 'Review');

    // Retried attempts reuse the same title, so recency is the only tiebreak.
    expect(latestDeliverable?.id).toBe('d2');
    expect(previousDeliverables.map((d) => d.id)).toEqual(['d1']);
  });

  it('leaves the whole list as history when the output produced no deliverable', () => {
    const all = [deliverable('d1', 'Review', '2026-08-01T10:00:00Z')];

    const { latestDeliverable, previousDeliverables } = splitStepDeliverables(all, null);

    expect(latestDeliverable).toBeUndefined();
    expect(previousDeliverables).toEqual(all);
  });

  it('hides nothing when the claimed deliverable was never persisted', () => {
    // A step still running, or a deliverable rejected downstream: dropping a
    // row here on a title that matches nothing would lose real content.
    const all = [deliverable('d1', 'Old review', '2026-08-01T10:00:00Z')];

    const { latestDeliverable, previousDeliverables } = splitStepDeliverables(all, 'New review');

    expect(latestDeliverable).toBeUndefined();
    expect(previousDeliverables).toEqual(all);
  });
});
