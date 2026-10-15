/**
 * Per-thread counters for the Threads list: how many messages the thread holds,
 * how many SDK runs it opened, and how many of those are executing right now.
 *
 * Derived from data the client already has live rather than stored on the thread,
 * so it cannot drift: a message is a comment carrying the thread id; a run is an
 * execution of a mention raised by one of those comments.
 */
import type { AgentExecution, TicketComment, TicketMention } from '@fleex/shared';

export interface ThreadStats {
  readonly messages: number;
  readonly runs: number;
  /** Runs executing right now (status `running`). */
  readonly activeRuns: number;
}

export const NO_STATS: ThreadStats = { messages: 0, runs: 0, activeRuns: 0 };

export function computeThreadStats(
  comments: readonly Pick<TicketComment, 'id' | 'threadId'>[],
  mentions: readonly Pick<TicketMention, 'id' | 'commentId'>[],
  executions: readonly Pick<AgentExecution, 'mentionId' | 'status'>[],
): Map<string, ThreadStats> {
  const acc = new Map<string, { messages: number; runs: number; activeRuns: number }>();
  const entry = (threadId: string) => {
    let e = acc.get(threadId);
    if (!e) acc.set(threadId, (e = { messages: 0, runs: 0, activeRuns: 0 }));
    return e;
  };

  const threadOfComment = new Map<string, string>();
  for (const c of comments) {
    if (!c.threadId) continue;
    threadOfComment.set(c.id, c.threadId);
    entry(c.threadId).messages++;
  }
  const threadOfMention = new Map<string, string>();
  for (const m of mentions) {
    const threadId = threadOfComment.get(m.commentId);
    if (threadId) threadOfMention.set(m.id, threadId);
  }
  for (const x of executions) {
    const threadId = threadOfMention.get(x.mentionId);
    if (!threadId) continue;
    const e = entry(threadId);
    e.runs++;
    if (x.status === 'running') e.activeRuns++;
  }
  return acc;
}
