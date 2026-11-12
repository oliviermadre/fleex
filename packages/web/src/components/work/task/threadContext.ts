/**
 * What the assistant exposed to a thread. `forwardedContext` holds the ids of
 * the ticket deliverables its target may read; threads opened before the
 * walling-off carried decorative keys (`ticket`, `pr`…), which are not ids and
 * are ignored.
 */
import type { AgentThread } from '@fleex/shared';

const DELIVERABLE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function sharedDeliverableIds(thread: Pick<AgentThread, 'forwardedContext'>): string[] {
  return thread.forwardedContext.filter((x) => DELIVERABLE_ID.test(x));
}
