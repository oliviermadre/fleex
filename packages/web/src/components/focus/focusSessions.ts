import type { FocusItem, FocusRunning, Session, SessionGroup } from '@fleex/shared';
import { findSessionsForTicketId } from '../dashboard/dashboard-helpers';

/**
 * Claude Code CLI sessions in the Focus list.
 *
 * The server derives "idle" from SDK executions, workflow runs and mentions
 * only: it cannot see a Claude Code session running in a terminal. The web
 * already receives every session's hook status live (`sessionGroups`, pushed on
 * each `session.hookStatusChanged`), so this layer corrects the server's idle
 * items on the client:
 *
 *  - a session **working** → the ticket is not idle: it joins `running` (source `cli`);
 *  - a session **waiting** on a permission or a structured question → the idle
 *    item becomes a `question` (source `session`), answered in the terminal;
 *  - a session **at rest** (turn done, awaiting instruction, exited) → the ticket
 *    stays idle, waiting since that moment rather than since the last SDK run.
 *
 * Only idle items are touched: a gate, an agent question or an error stay what
 * the server says.
 *
 * Known limits of the hook signal, handled here:
 *  - a `claude` session whose pane fell back to a plain shell has no Claude
 *    process any more (killed without `SessionEnd`): its stale `working` /
 *    `waiting` is read as rest;
 *  - hooks fan out to every session under the same cwd, so several sessions of
 *    a worktree carry the same status: they are aggregated, the most demanding
 *    state winning (waiting > working > rest).
 * Not handled: after a permission is granted, no hook fires until the next tool
 * call or the end of the turn, so `waiting` can outlive the approval by a turn.
 */

export type CliSignal =
  | { state: 'waiting'; reason: 'permission' | 'question'; sessionId: string; since: string | null; message: string | null }
  | { state: 'busy'; sessionId: string; since: string | null }
  | { state: 'rest'; sessionId: string; since: string | null };

const SHELLS = new Set(['zsh', 'bash', 'fish', 'sh']);

function paneIsShell(s: Session): boolean {
  const proc = s.foregroundProcess?.split(' ')[0];
  return !!proc && SHELLS.has(proc);
}

/**
 * The pane is running Claude Code itself — its process shows as `claude` or as its
 * version (`2.1.284`). Hooks fan out to every session of the cwd, so this is what
 * tells the Claude terminal from a sibling shell carrying the same status.
 */
export function paneRunsClaude(s: Session): boolean {
  const proc = s.foregroundProcess?.split(' ')[0];
  if (proc === 'claude' || (!!proc && /^\d+\.\d+\.\d+/.test(proc))) return true;
  return s.type === 'claude' && !!proc && !SHELLS.has(proc);
}

/** What one session tells about Claude, or null when it tells nothing. */
export function sessionSignal(s: Session): CliSignal | null {
  if (s.status !== 'running') return null;
  const since = s.hookStatusUpdatedAt ?? null;
  // Claude ran in a dedicated session and its pane is back to the shell: whatever
  // the last hook said, nobody is working any more.
  const gone = s.type === 'claude' && paneIsShell(s);

  if (s.hookStatus && s.hookStatus !== 'unknown') {
    if (gone) return { state: 'rest', sessionId: s.id, since };
    switch (s.hookStatus) {
      case 'working':
        return { state: 'busy', sessionId: s.id, since };
      case 'waiting':
        if (s.hookWaitingReason === 'permission' || s.hookWaitingReason === 'question') {
          return { state: 'waiting', reason: s.hookWaitingReason, sessionId: s.id, since, message: s.hookLastMessage ?? null };
        }
        return { state: 'rest', sessionId: s.id, since }; // idle_prompt: turn done, awaiting the next instruction
      default:
        return { state: 'rest', sessionId: s.id, since }; // complete · error · idle (exited)
    }
  }

  // Sessions without hooks: the legacy JSONL-derived activity, when present.
  switch (s.claudeActivity) {
    case 'working':
    case 'executing':
      return gone ? { state: 'rest', sessionId: s.id, since: null } : { state: 'busy', sessionId: s.id, since: null };
    case 'waiting_tool_approval':
    case 'waiting_plan_approval':
    case 'waiting_user_choice':
      return gone
        ? { state: 'rest', sessionId: s.id, since: null }
        : { state: 'waiting', reason: s.claudeActivity === 'waiting_user_choice' ? 'question' : 'permission', sessionId: s.id, since: null, message: null };
    default:
      return null;
  }
}

const RANK: Record<CliSignal['state'], number> = { waiting: 2, busy: 1, rest: 0 };

function laterIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

/**
 * The ticket-level signal of its sessions: the most demanding state wins; on a
 * tie, the session running Claude (the one "Ouvrir la session" must open), then
 * the oldest wait / the latest rest.
 */
export function aggregateSignal(sessions: readonly Session[]): CliSignal | null {
  let best: { sig: CliSignal; claude: boolean } | null = null;
  for (const s of sessions) {
    const sig = sessionSignal(s);
    if (!sig) continue;
    const cand = { sig, claude: paneRunsClaude(s) };
    if (!best || RANK[sig.state] !== RANK[best.sig.state]) {
      if (!best || RANK[sig.state] > RANK[best.sig.state]) best = cand;
      continue;
    }
    if (cand.claude !== best.claude) {
      if (cand.claude) best = cand;
      continue;
    }
    const since = sig.since ?? '';
    const bestSince = best.sig.since ?? '';
    if (sig.state === 'rest' ? since > bestSince : since < bestSince) best = cand;
  }
  return best?.sig ?? null;
}

/** Correct the server's idle items with the live CLI sessions (see file header). */
export function applyCliSessions(
  items: readonly FocusItem[],
  running: readonly FocusRunning[],
  sessionGroups: readonly SessionGroup[],
): { items: FocusItem[]; running: FocusRunning[] } {
  const inFlight = [...running];
  const out: FocusItem[] = [];
  for (const item of items) {
    if (item.kind !== 'idle') { out.push(item); continue; }
    const sig = aggregateSignal(findSessionsForTicketId(item.ticketId, sessionGroups as SessionGroup[]));
    if (!sig) { out.push(item); continue; }
    if (sig.state === 'busy') {
      if (!inFlight.some((r) => r.ticketId === item.ticketId)) {
        inFlight.push({
          ticketId: item.ticketId, source: 'cli', label: 'Claude (terminal)', since: sig.since,
          executionId: null, workflow: null, sessionId: sig.sessionId, costUsd: item.costUsd,
        });
      }
      continue;
    }
    if (sig.state === 'waiting') {
      out.push({
        ...item,
        // Keyed on the wait itself: a snooze lapses once the session moves on.
        key: `session:${sig.sessionId}:${sig.since ?? ''}`,
        kind: 'question',
        since: sig.since ?? item.since,
        idle: null,
        question: {
          source: 'session', mentionId: null, runId: null, stepRunId: null,
          askedBy: 'Claude (terminal)', text: sig.message,
          sessionId: sig.sessionId, sessionWait: sig.reason,
        },
      });
      continue;
    }
    out.push({
      ...item,
      since: laterIso(item.since, sig.since),
      idle: item.idle ? { ...item.idle, cliRestAt: sig.since, cliSessionId: sig.sessionId } : item.idle,
    });
  }
  return { items: out, running: inFlight };
}
