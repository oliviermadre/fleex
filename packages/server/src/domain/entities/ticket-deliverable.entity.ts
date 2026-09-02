import type { TicketDeliverable, DeliverableType, DeliverableStatus } from '@fleex/shared';
import { sanitizeForStorage } from '@fleex/shared';

export class TicketDeliverableEntity {
  constructor(
    public readonly id: string,
    /** Null when the deliverable was produced by a routine run (no ticket). */
    public readonly ticketId: string | null,
    public readonly agentName: string,
    public type: DeliverableType,
    public title: string,
    public content: string,
    public version: number,
    public status: DeliverableStatus,
    public readonly mentionId: string | null,
    public readonly createdAt: Date,
    public updatedAt: Date,
    /**
     * Set instead of `ticketId` for routine runs: the artifact hangs off the
     * run, which is reachable from the routine detail screen.
     */
    public readonly workflowRunId: string | null = null,
    /**
     * The step run that produced it. Narrower than `workflowRunId` and the only
     * anchor precise enough for the run graph to place the artifact on the node
     * that emitted it. Null outside a workflow, and on pre-anchor rows.
     */
    public readonly stepRunId: string | null = null,
  ) {}

  static create(params: {
    id: string;
    ticketId?: string | null;
    workflowRunId?: string | null;
    stepRunId?: string | null;
    agentName: string;
    type: DeliverableType;
    title: string;
    content: string;
    status?: DeliverableStatus;
    mentionId?: string | null;
  }): TicketDeliverableEntity {
    const now = new Date();
    return new TicketDeliverableEntity(
      params.id,
      params.ticketId ?? null,
      params.agentName,
      params.type,
      sanitizeForStorage(params.title),
      sanitizeForStorage(params.content),
      1,
      params.status ?? 'draft',
      params.mentionId ?? null,
      now,
      now,
      params.workflowRunId ?? null,
      params.stepRunId ?? null,
    );
  }

  update(changes: { title?: string; content?: string; status?: DeliverableStatus }): void {
    // Sanitize *before* comparing: the stored value is already escaped, so
    // comparing a raw resubmission against it would always look like a change
    // and bump `version` on every retry of an unchanged deliverable.
    const nextContent =
      changes.content === undefined ? undefined : sanitizeForStorage(changes.content);

    if (nextContent !== undefined && nextContent !== this.content) {
      this.content = nextContent;
      this.version += 1;
    }
    if (changes.title !== undefined) {
      this.title = sanitizeForStorage(changes.title);
    }
    if (changes.status !== undefined) {
      this.status = changes.status;
    }
    this.updatedAt = new Date();
  }

  /**
   * Reassign this deliverable to a different type (backoffice operation —
   * single edit, bulk reassign, or type rename migration). Does not bump the
   * content version since the content is unchanged.
   */
  setType(type: DeliverableType): void {
    if (type === this.type) return;
    this.type = type;
    this.updatedAt = new Date();
  }

  isOwnedBy(agentName: string): boolean {
    return this.agentName === agentName;
  }

  toDTO(): TicketDeliverable {
    return {
      id: this.id,
      ticketId: this.ticketId,
      workflowRunId: this.workflowRunId,
      stepRunId: this.stepRunId,
      agentName: this.agentName,
      type: this.type,
      title: this.title,
      content: this.content,
      version: this.version,
      status: this.status,
      mentionId: this.mentionId,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
    };
  }
}
