import type { TicketDeliverable } from '@fleex/shared';

export interface StepDeliverableSplit {
  /** The deliverable the latest attempt produced, when it could be matched. */
  latestDeliverable: TicketDeliverable | undefined;
  /** Everything the earlier attempts left behind. */
  previousDeliverables: TicketDeliverable[];
}

/**
 * A step can run several times and each attempt may leave a deliverable, all
 * attributed to the same step. Shown as one flat list — as they used to be —
 * there is no way to tell what the run just produced from what a discarded
 * attempt produced two retries ago.
 *
 * `stepRunId` answers that exactly: it names the attempt. It is used whenever
 * the deliverable carries one.
 *
 * The title fallback is for rows written before that anchor existed, where the
 * only handle is the title carried by the latest attempt's output. Ties are
 * broken by recency because retried attempts routinely reuse the exact same
 * title, and the most recent one is by definition the latest attempt's.
 */
export function splitStepDeliverables(
  all: TicketDeliverable[],
  latestTitle: string | null | undefined,
  latestStepRunId?: string | null,
): StepDeliverableSplit {
  if (latestStepRunId) {
    // A step run can hold several deliverables (the step's own output plus any
    // the agent attached from the CLI); the newest is the one to surface.
    const anchored = all
      .filter((d) => d.stepRunId === latestStepRunId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (anchored) {
      return {
        latestDeliverable: anchored,
        previousDeliverables: all.filter((d) => d.id !== anchored.id),
      };
    }
    // No anchored row: either the latest attempt produced nothing, or this
    // step predates the anchor. Fall through to the title heuristic, which
    // returns the whole list as history when it matches nothing.
  }

  if (!latestTitle) return { latestDeliverable: undefined, previousDeliverables: all };

  const newestMatch = all
    .filter((d) => d.title === latestTitle)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  // The output claims a deliverable but none was persisted (rejected, or the
  // run is still in flight): nothing to pull out of the list.
  if (!newestMatch) return { latestDeliverable: undefined, previousDeliverables: all };

  return {
    latestDeliverable: newestMatch,
    previousDeliverables: all.filter((d) => d.id !== newestMatch.id),
  };
}
