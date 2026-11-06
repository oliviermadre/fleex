import type { DeliverableOrigin, TicketDeliverable } from '@fleex/shared';

export type ListedDeliverable = TicketDeliverable & { origin: DeliverableOrigin | null };

/** A deliverable without its content — what a list shows. */
export function deliverableSummary(d: ListedDeliverable) {
  return {
    id: d.id, title: d.title, type: d.type, status: d.status, agentName: d.agentName,
    origin: d.origin ? { kind: d.origin.kind, id: d.origin.id, label: d.origin.label } : null,
    ticketId: d.ticketId, workflowRunId: d.workflowRunId ?? null,
    createdAt: d.createdAt, updatedAt: d.updatedAt, size: d.content?.length ?? 0,
  };
}
