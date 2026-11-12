/**
 * Assistant ⇄ agent threads as branches of the ticket's lifeline — pure, no React.
 *
 * A thread leaves the lifeline when the assistant opens it, runs in its own
 * lane under the frieze and joins the lifeline again when it is concluded. A
 * thread still open runs to "now"; a failed one stops short, without joining back.
 *
 * What happened in the thread — its turns, the runs they launched, what those
 * runs produced — is the frieze's own pictos, moved onto the branch:
 * `layoutTimeline` places them (`threadItems`), this module only hangs them on
 * their branch. What only a thread has (a run stopped on purpose, where it
 * stands now) gets its own marks. Threads alive at the same time get different
 * lanes; a lane is reused as soon as it is free.
 */
import type { AgentThread, AgentThreadStatus, TicketComment } from '@fleex/shared';
import type { TintHue } from '../../../lib/tints';
import { xAtTime, type TimeAnchor } from './layoutAnnotations';
import { THREAD_SLOT, type PlacedEvent } from './layoutTimeline';

/** Who spoke in a turn of the thread. */
export type ThreadTurnBy = 'assistant' | 'target' | 'user';

export interface ThreadTurn {
  id: string;
  at: number;
  by: ThreadTurnBy;
  /** Who, for the tooltip. */
  author: string;
}

export interface ThreadBranch {
  id: string;
  /** The delegated target, as the Threads panel names it. */
  label: string;
  /** What the thread is about (generated title, else the brief). */
  title: string;
  hue: TintHue;
  status: AgentThreadStatus;
  startAt: number;
  /** When it stopped moving: its conclusion, or its failure. Null while open. */
  endAt: number | null;
  turns: ThreadTurn[];
  /** The current run was stopped on purpose, by whom and when. */
  stop: { by: 'user' | 'assistant'; at: number } | null;
  concludedBy: 'user' | 'assistant' | null;
}

const HUE: Record<AgentThread['targetType'], TintHue> = {
  agent: 'purple',
  skill: 'teal',
  panel: 'blue',
  workflow: 'orange',
};

const TURN_BY: Record<string, ThreadTurnBy> = { assistant: 'assistant', user: 'user' };

/** Threads + the ticket's comments → branches, oldest first. */
export function threadBranches(
  threads: readonly AgentThread[],
  comments: readonly TicketComment[],
  label: (thread: AgentThread) => string,
): ThreadBranch[] {
  const turns = new Map<string, ThreadTurn[]>();
  for (const c of comments) {
    if (!c.threadId) continue;
    const list = turns.get(c.threadId) ?? [];
    list.push({ id: c.id, at: Date.parse(c.createdAt), by: TURN_BY[c.authorType] ?? 'target', author: c.authorName });
    turns.set(c.threadId, list);
  }
  return threads
    .map((t): ThreadBranch => {
      const startAt = Date.parse(t.createdAt);
      const own = (turns.get(t.id) ?? []).sort((a, b) => a.at - b.at);
      const ended = t.status === 'concluded' ? t.concludedAt ?? t.updatedAt : t.status === 'failed' ? t.updatedAt : null;
      return {
        id: t.id,
        label: label(t),
        title: t.generatedTitle || t.brief,
        hue: HUE[t.targetType] ?? 'purple',
        status: t.status,
        startAt,
        endAt: ended ? Math.max(startAt, Date.parse(ended)) : null,
        turns: own,
        stop: t.lastStop && t.status !== 'concluded' ? { by: t.lastStop.by, at: Math.max(startAt, Date.parse(t.lastStop.at)) } : null,
        concludedBy: t.concludedBy ?? null,
      };
    })
    .sort((a, b) => a.startAt - b.startAt || (a.id < b.id ? -1 : 1));
}

// ── Layout ────────────────────────────────────────────────────────────────────

/** One lane: the label line, then the rail and the pictos standing on it. */
export const THREAD_LANE = 46;
/** Room above the first lane, under the frieze. */
export const THREAD_PAD = 4;
/** From a lane's top to its rail. */
export const RAIL_OFFSET = 30;
/** Radius of the elbows leaving and joining the lifeline. */
export const ELBOW = 9;
/** From an elbow to the centre of the first / last picto of the branch. */
const LEAD = ELBOW + THREAD_SLOT / 2;
/** A branch is never drawn shorter than this, so both elbows fit. */
const MIN_RAIL = 2 * ELBOW + 6;
/** Minimum gap between two branches of the same lane. */
const LANE_GAP = 14;
const CHAR_W = 6.4;
const LABEL_MAX = 240;

export interface PlacedBranch extends ThreadBranch {
  lane: number;
  /** Where it leaves the lifeline, and where it joins back or stops (now, while open). */
  x0: number;
  x1: number;
  /** x of its last picto: an open thread is dashed from there to now. */
  lastX: number;
  labelWidth: number;
  /** The frieze pictos that happened in this thread, at their x. */
  items: PlacedEvent[];
  /** Where the run was stopped on purpose, when it was. */
  stopX: number | null;
}

export interface ThreadStrip {
  branches: PlacedBranch[];
  lanes: number;
  height: number;
}

export const NO_THREADS: ThreadStrip = { branches: [], lanes: 0, height: 0 };

const STATE_WORD: Partial<Record<AgentThreadStatus, string>> = {
  running: 'en cours',
  waiting: "t'attend",
  failed: 'échec',
};

/** What follows the target's name on a branch: "6 échanges · en cours". */
export function branchCaption(b: Pick<ThreadBranch, 'turns' | 'status'> & { stop?: ThreadBranch['stop'] }): string {
  const n = b.turns.length;
  const count = n > 1 ? `${n} échanges` : n === 1 ? '1 échange' : '';
  const state = b.stop && b.status === 'idle' ? (b.stop.by === 'user' ? 'arrêté par toi' : "arrêté par l'assistant") : STATE_WORD[b.status];
  return [count, state].filter(Boolean).join(' · ');
}

export function layoutThreadStrip(
  branches: readonly ThreadBranch[],
  anchors: readonly TimeAnchor[],
  nowX: number,
  threadItems: readonly PlacedEvent[] = [],
): ThreadStrip {
  if (branches.length === 0 || anchors.length === 0) return NO_THREADS;
  const byThread = new Map<string, PlacedEvent[]>();
  for (const it of threadItems) {
    const list = byThread.get(it.event.threadId!) ?? [];
    list.push(it);
    byThread.set(it.event.threadId!, list);
  }
  const laneRight: number[] = [];
  const placed = branches.map((b): PlacedBranch => {
    const items = byThread.get(b.id) ?? [];
    const first = items[0]?.x;
    const last = items[items.length - 1]?.x;
    // The opening turn is posted as the thread is created: the fork is drawn just before it,
    // and a concluded branch joins back just after its last picto.
    const x0 = Math.min(xAtTime(anchors, b.startAt), first == null ? Infinity : first - LEAD);
    const end = b.endAt == null ? nowX : xAtTime(anchors, b.endAt);
    const x1 = Math.max(end, x0 + MIN_RAIL, last == null ? -Infinity : last + (b.endAt == null ? THREAD_SLOT / 2 : LEAD));
    const lastX = last ?? x0 + ELBOW;
    const stopX = b.stop ? Math.min(Math.max(xAtTime(anchors, b.stop.at), lastX + THREAD_SLOT * 0.8), x1 - ELBOW) : null;
    const text = `${b.label}  ${branchCaption(b)}`;
    const labelWidth = Math.min(LABEL_MAX, Math.ceil(text.length * CHAR_W) + 16);
    // The lane holds the rail and the label, whichever runs further right.
    const right = Math.max(x1, x0 + ELBOW + labelWidth);
    let lane = laneRight.findIndex((r) => r + LANE_GAP <= x0);
    if (lane < 0) lane = laneRight.length;
    laneRight[lane] = right;
    return { ...b, lane, x0, x1, lastX: Math.max(lastX, stopX ?? -Infinity), labelWidth, items, stopX };
  });
  return { branches: placed, lanes: laneRight.length, height: THREAD_PAD + laneRight.length * THREAD_LANE + 4 };
}
