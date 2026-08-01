/**
 * Structural view of what the stores hand back.
 *
 * Declared structurally rather than in terms of the entity classes so the
 * dataset layer stays decoupled from `domain/entities/` — and so tests can feed
 * it plain objects exposing just the members that are actually read.
 */
import type { Ticket, TicketComment, TicketMention, TicketDeliverable, AgentExecution } from '@fleex/shared';
import type { NamedRef } from './rows.js';

/** A persisted domain-event-log row, narrowed to the fields statistics reads. */
export interface RawEvent {
  readonly payload: Record<string, unknown>;
  readonly occurredAt: Date;
}

export interface RawStatsData {
  readonly tickets: readonly { toDTO(): Ticket }[];
  readonly boards: readonly { readonly id: string; readonly name: string }[];
  readonly comments: readonly { toDTO(): TicketComment }[];
  readonly mentions: readonly { toDTO(): TicketMention }[];
  readonly deliverables: readonly { toDTO(): TicketDeliverable }[];
  readonly executions: readonly AgentExecution[];
  readonly personas: readonly NamedRef[];
  readonly skills: readonly NamedRef[];
  readonly sessions: readonly {
    readonly type: string;
    readonly status: string;
    readonly worktreeBranch: string | null;
    readonly createdAt: Date;
  }[];
  readonly panelEvents: readonly RawEvent[];
  readonly moveEvents: readonly RawEvent[];
  readonly workflowRuns: readonly {
    readonly ticketId: string;
    readonly templateId: string;
    readonly templateSnapshot?: { readonly name?: string };
    readonly status: string;
    readonly startedAt: Date;
    readonly completedAt: Date | null;
  }[];
}
