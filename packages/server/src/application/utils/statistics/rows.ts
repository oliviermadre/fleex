/**
 * Flat, pre-parsed projections of the entities the statistics read model needs.
 *
 * Two things every row type here has in common:
 *
 * 1. It is derived from exactly one `toDTO()` call. `TicketEntity.toDTO()` alone
 *    allocates 25 fields and runs six `toISOString()` calls, and the old bucket
 *    loop re-derived it for every entity on every bucket — ~730k allocations for
 *    a year at daily granularity.
 * 2. Timestamps are carried as epoch milliseconds, already parsed. The old code
 *    re-ran `new Date(...)` inside the comparison predicate of every filter.
 *
 * Rows are intentionally dumb value objects so the aggregate modules can be
 * exercised with plain object literals.
 */
import type { TicketStatus, MentionStatus, WorkflowRunStatus } from '@fleex/shared';

export interface TicketRow {
  readonly id: string;
  readonly title: string;
  readonly status: TicketStatus;
  /** Resolved once here; missing boards fall back to "Unknown". */
  readonly boardName: string;
  readonly createdAt: Date;
  readonly createdAtMs: number;
  readonly statusChangedAt: Date;
  readonly statusChangedAtMs: number;
  readonly prLinkCount: number;
}

export interface CommentRow {
  readonly ticketId: string;
  readonly authorType: 'user' | 'agent';
  readonly createdAtMs: number;
}

export interface MentionRow {
  readonly id: string;
  readonly ticketId: string;
  readonly status: MentionStatus;
  readonly createdAtMs: number;
}

export interface DeliverableRow {
  readonly createdAtMs: number;
}

export interface ExecutionRow {
  readonly personaId: string;
  readonly mentionId: string;
  readonly status: 'running' | 'completed' | 'failed' | 'interrupted';
  /** NULL `source` is read as agentic (`sdk`). */
  readonly source: 'sdk' | 'cli';
  readonly startedAtMs: number;
  /** `null` when the run never completed — such runs are excluded from averages. */
  readonly durationMs: number | null;
  /** `null` and `undefined` both collapse to `null`, matching the old `!= null` guards. */
  readonly costUsd: number | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly isSkill: boolean;
  /** `mentionId` minus the `skill:` prefix, or `null` for a non-skill run. */
  readonly skillId: string | null;
}

export interface SessionRow {
  readonly createdAtMs: number;
  /**
   * A session counts as a worktree if it has a branch *or* is a Claude session.
   * The original expression relied on truthiness, so an empty-string branch is
   * not a worktree — `Boolean(...)` keeps that.
   */
  readonly isWorktree: boolean;
  /**
   * `SessionStatus` is `'running' | 'dead' | 'unknown'`. The original also tested
   * for `'active'`, which is not a member of the union and therefore never
   * matched — that dead comparison is gone.
   */
  readonly isActive: boolean;
}

export interface PanelEventRow {
  /**
   * The raw `panelId` payload value, kept unnormalised so the display-name
   * lookup can reproduce the original `payload['panelId'] === groupKey` match
   * exactly: an event with no panelId groups under "unknown" but does *not*
   * answer to that key, so it falls back to the id for its name.
   */
  readonly rawPanelId: unknown;
  readonly panelId: string;
  readonly panelName: string | null;
  readonly panelDisplayName: string | null;
  readonly status: string;
  readonly durationMs: number;
  readonly respondedMembers: number;
  readonly occurredAtMs: number;
}

export interface WorkflowRunRow {
  readonly ticketId: string;
  readonly templateId: string;
  readonly templateName: string | null;
  readonly status: WorkflowRunStatus;
  readonly startedAtMs: number;
  readonly durationMs: number | null;
}

/** One `ticket.moved` transition. Lists are sorted ascending by `atMs`. */
export interface TicketMove {
  readonly at: Date;
  readonly atMs: number;
  readonly to: string;
}

/** Minimal shape of a persona/skill needed for leaderboard display names. */
export interface NamedRef {
  readonly id: string;
  readonly name?: string | null;
  readonly displayName?: string | null;
}
