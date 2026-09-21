/**
 * Pure view-model logic for the Work view: how the flat task list partitions
 * into the three queue sections, how an agent's pending question is parsed into
 * inline answer options, and how ticket activity turns into stream event lines.
 * Kept free of store/React imports so it is unit tested in isolation
 * (selectors.test.ts).
 */
import type { AgentExecution, AgentQuestion, AgentThread, TicketActivity, TicketComment, TicketDeliverable } from '@fleex/shared';

/** The activity bucket a task falls in, mirrored from ticketActivityStore. */
export type QueueActivity = 'waiting' | 'running' | 'idle';

/**
 * A task as the queue needs it — a normalised projection of a ticket plus its
 * live activity, built in the component from ticketStore + ticketActivityStore.
 * The selectors below never touch a store, only this shape.
 */
export interface QueueItem {
  id: string;
  title: string;
  boardId: string | null;
  boardName: string | null;
  activity: QueueActivity;
  /** ms epoch the current activity started (for NEEDS YOU / RUNNING ordering). */
  since: number | null;
  /** ms epoch of the last activity of any kind (for IDLE ordering). */
  lastActivityAt: number | null;
}

/**
 * The ISO timestamp an idle task's age (and IDLE ordering) is measured from.
 * The last SDK activity wins. Without one, a closed ticket falls back to when it
 * was closed: its `updatedAt` keeps moving on technical writes long after
 * closure (e.g. `fleex worktree cleanup` unlinking its worktree), which made
 * months-old Done tickets read "2d" and float to the top. Open tickets keep
 * `updatedAt`, so a manual edit still bumps them.
 */
export function idleActivitySource(
  ticket: { status: string; updatedAt: string; statusChangedAt: string },
  lastSdkActivityAt: string | null | undefined,
): string {
  if (lastSdkActivityAt) return lastSdkActivityAt;
  return ticket.status === 'done' || ticket.status === 'cancelled' ? ticket.statusChangedAt : ticket.updatedAt;
}

export interface PartitionedQueue {
  needs: QueueItem[];
  running: QueueItem[];
  idle: QueueItem[];
}

/**
 * Split tasks into the three sections and order each per SPEC §3:
 *   NEEDS YOU (waiting) — oldest question first (since ascending)
 *   RUNNING           — most recently started first (since descending)
 *   IDLE              — most recently active first (lastActivityAt descending)
 * A task appears in exactly one section. Ordering is stable for ties.
 */
export function partitionQueue(tasks: readonly QueueItem[]): PartitionedQueue {
  const needs: QueueItem[] = [];
  const running: QueueItem[] = [];
  const idle: QueueItem[] = [];

  for (const t of tasks) {
    if (t.activity === 'waiting') needs.push(t);
    else if (t.activity === 'running') running.push(t);
    else idle.push(t);
  }

  needs.sort((a, b) => (a.since ?? 0) - (b.since ?? 0));
  running.sort((a, b) => (b.since ?? 0) - (a.since ?? 0));
  idle.sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0));

  return { needs, running, idle };
}

/** A contextual next-step chip shown above the composer. */
export interface Suggestion {
  id: string;
  label: string;
  /** A ticket status this chip moves the ticket to, when that's its action. */
  moveTo?: 'reviewing' | 'done';
  /** An @mention this chip seeds into the composer, when that's its action. */
  mention?: string;
}

export interface SuggestionInput {
  status: string;
  type: string | null;
  hasPR: boolean;
}

/**
 * The ordered suggestion chips for a task (SPEC §5), limited to what Phase 1 can
 * actually perform: the two status moves, and two persona mentions the composer
 * seeds (real delegation threads are Phase 3). Workflow/panel/attach chips join
 * as their backing actions land, so the rule set stays truthful about what a
 * click does.
 */
export function suggestionsFor(t: SuggestionInput): Suggestion[] {
  const out: Suggestion[] = [];
  if (t.status === 'doing') out.push({ id: 'move-reviewing', label: '→ Move to Reviewing', moveTo: 'reviewing' });
  if (t.status === 'reviewing') out.push({ id: 'mark-done', label: '✓ Mark done', moveTo: 'done' });
  // The chip seeds a sentence for the assistant (every Work message goes through
  // it); the @agent: tag is its explicit delegation instruction.
  out.push({ id: 'see-with-dev', label: '⇄ See with the dev', mention: 'Vois ça avec @agent:builder : ' });
  if (t.type === 'think') out.push({ id: 'see-with-pm', label: '⇄ See with the PM', mention: 'Vois ça avec @agent:pm : ' });
  return out;
}

// ── Agent personas (SPEC §6.1 AGENTS) ─────────────────────────────────────

export type PersonaState = 'running' | 'waiting' | 'idle';

/** A persona row in the Context panel: who has worked the ticket, and its state. */
export interface TicketPersona {
  id: string;
  name: string;
  state: PersonaState;
}

/** Minimal execution shape the derivation needs (subset of AgentExecution). */
export interface PersonaExecutionInput {
  personaId: string;
  status: 'running' | 'completed' | 'failed' | 'interrupted';
}

const STATE_RANK: Record<PersonaState, number> = { running: 0, waiting: 1, idle: 2 };

/**
 * The personas that have worked a ticket, with a state, for the AGENTS section
 * (SPEC §6.1). Built from the ticket's executions (which personas ran) crossed
 * with persona display metadata and each persona's live status. State is
 * best-effort: `running` when this ticket has a running execution or the persona
 * is live-running; `waiting` when it has pending mentions (persona-global —
 * refined to per-ticket when agent threads land in Phase 3); else `idle`.
 * Rows are de-duplicated per persona and ordered running → waiting → idle, then
 * by name, so the ones needing attention sit on top.
 */
export function personasForTicket(
  executions: readonly PersonaExecutionInput[],
  personas: readonly { id: string; displayName: string }[],
  statuses: Record<string, { running: boolean; pendingMentions: number }>,
): TicketPersona[] {
  const nameById = new Map(personas.map((p) => [p.id, p.displayName]));
  const ticketRunning = new Set<string>();
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const e of executions) {
    if (!seen.has(e.personaId)) {
      seen.add(e.personaId);
      ids.push(e.personaId);
    }
    if (e.status === 'running') ticketRunning.add(e.personaId);
  }

  const rows = ids.map((id): TicketPersona => {
    const live = statuses[id];
    const state: PersonaState =
      ticketRunning.has(id) || live?.running
        ? 'running'
        : (live?.pendingMentions ?? 0) > 0
          ? 'waiting'
          : 'idle';
    return { id, name: nameById.get(id) ?? id, state };
  });

  rows.sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state] || a.name.localeCompare(b.name));
  return rows;
}

// ── Event lines (SPEC §5) ─────────────────────────────────────────────────

function cap(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

/** Human label for a link type in an event line, or null for internal links. */
function linkLabel(type: string, attached: boolean): string | null {
  switch (type) {
    case 'repository':
      return `Repo ${attached ? 'attached' : 'detached'}`;
    case 'github_pr':
      return `PR ${attached ? 'linked' : 'unlinked'}`;
    case 'github_issue':
      return `Issue ${attached ? 'linked' : 'unlinked'}`;
    case 'worktree':
      return `Worktree ${attached ? 'created' : 'removed'}`;
    default:
      // session and other internal links produce no event line.
      return null;
  }
}

/**
 * Turn one ticket activity row into the short grey event line shown in the
 * stream (SPEC §5), or null when it shouldn't surface. `commented` is dropped —
 * comments already render as messages — as are edits and internal book-keeping,
 * so the stream stays a meaningful history rather than an audit dump.
 */
export function formatActivity(a: TicketActivity): string | null {
  switch (a.action) {
    case 'created':
      return 'Ticket created';
    case 'moved': {
      const to = a.changes.status?.to;
      return typeof to === 'string' ? `Moved to ${cap(to)}` : null;
    }
    case 'linked':
    case 'unlinked': {
      const attached = a.action === 'linked';
      const change = a.changes.link;
      const link = (attached ? change?.to : change?.from) as { type?: string; ref?: string } | undefined;
      if (link?.type) {
        const label = linkLabel(link.type, attached);
        return label && link.ref ? `${label} · ${link.ref}` : label;
      }
      if (a.changes.worktree) return `Worktree ${attached ? 'created' : 'removed'}`;
      return null; // session link etc. — internal
    }
    case 'archived':
      return 'Archived';
    case 'unarchived':
      return 'Unarchived';
    case 'panel_executed':
      return 'Panel concluded';
    default:
      // commented (already a message), updated, answer, assigned, mention_*, and
      // deliverable_submitted (rendered as a rich deliverable card) — skip.
      return null;
  }
}

/**
 * One entry in the merged conversation stream. `run` is an agent execution (its
 * card links to the execution log); `deliverable` is an artifact card; `comment`
 * and `event` are the message bubbles and grey history lines.
 */
export type StreamEntry =
  | { kind: 'run'; at: number; execution: AgentExecution }
  | { kind: 'comment'; at: number; comment: TicketComment }
  | { kind: 'deliverable'; at: number; deliverable: TicketDeliverable }
  | { kind: 'event'; at: number; id: string; text: string }
  | { kind: 'delegation'; at: number; thread: AgentThread };

// Tie-break order for entries sharing a timestamp: a run precedes the comment it
// produced, which precedes that run's deliverable, and grey event lines come last.
const STREAM_RANK: Record<StreamEntry['kind'], number> = { run: 0, comment: 1, delegation: 1, deliverable: 2, event: 3 };

/**
 * Merge agent runs, comments, deliverables and activity event lines into one
 * chronological stream, oldest first. A run sits at its `startedAt` (so it lands
 * just before the comment it produced); a deliverable at its `createdAt` (just
 * after). Activities that {@link formatActivity} drops are excluded. Ordering is
 * stable and, for equal timestamps, follows STREAM_RANK.
 *
 * `source: 'cli'` executions are skipped: they are manual `claude` CLI sessions
 * ingested at session end (no Fleex persona, no replayable event log), already
 * represented in the stream by their "CLI session summary" deliverable — a run
 * card for them would be redundant and broken.
 */
export function buildStream(
  comments: readonly TicketComment[],
  activity: readonly TicketActivity[],
  executions: readonly AgentExecution[] = [],
  deliverables: readonly TicketDeliverable[] = [],
  threads: readonly AgentThread[] = [],
): StreamEntry[] {
  const entries: StreamEntry[] = [];
  for (const execution of executions) {
    if (execution.source === 'cli') continue;
    // Assistant turns are plumbing, not runs the user follows: no run card.
    if (execution.mentionId.startsWith('assistant:')) continue;
    entries.push({ kind: 'run', at: Date.parse(execution.startedAt), execution });
  }
  for (const comment of comments) {
    // Thread turns live in the Threads panel; the main stream shows the card.
    if (comment.threadId) continue;
    entries.push({ kind: 'comment', at: Date.parse(comment.createdAt), comment });
  }
  for (const thread of threads) {
    entries.push({ kind: 'delegation', at: Date.parse(thread.createdAt), thread });
  }
  for (const deliverable of deliverables) {
    entries.push({ kind: 'deliverable', at: Date.parse(deliverable.createdAt), deliverable });
  }
  for (const a of activity) {
    const text = formatActivity(a);
    if (text) entries.push({ kind: 'event', at: Date.parse(a.createdAt), id: a.id, text });
  }
  // Stable sort (V8): equal timestamps keep insertion order; STREAM_RANK breaks
  // a same-millisecond tie into run → comment → deliverable → event.
  entries.sort((x, y) => x.at - y.at || STREAM_RANK[x.kind] - STREAM_RANK[y.kind]);
  return entries;
}


// ── Assistant threads (SPEC §6.2 / §9) ────────────────────────────────────

/** The turns of one thread, oldest first. */
export function threadTurns(comments: readonly TicketComment[], threadId: string): TicketComment[] {
  return comments
    .filter((c) => c.threadId === threadId)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

/**
 * The agent's pending question inside a thread: its last turn, when the agent
 * declared closed questions on it. Null when the last agent turn is a plain message.
 */
export function lastAgentQuestion(turns: readonly TicketComment[]): { comment: TicketComment; questions: AgentQuestion[] } | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    const c = turns[i]!;
    if (c.authorType !== 'agent') continue;
    return c.questions?.length ? { comment: c, questions: c.questions } : null;
  }
  return null;
}

/**
 * Queue-row label while a thread runs: `<persona> · in thread with assistant`.
 * Null when no thread is running (the regular activity detail applies).
 */
export function threadActivityDetail(
  threads: readonly AgentThread[],
  personaLabel: (thread: AgentThread) => string = (t) => t.personaName,
): string | null {
  const running = threads.find((t) => t.status === 'running');
  return running ? `${personaLabel(running)} · in thread with assistant` : null;
}
