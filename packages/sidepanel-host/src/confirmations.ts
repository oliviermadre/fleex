/**
 * Confirmations waiting for the user: writes outside a conversation folder.
 *
 * Kept off `server.ts` (which boots `Bun.serve` at import time) so the rules
 * deciding whether a write goes through are unit-testable.
 */
import type { OutsideWriteDecision, OutsideWriteRequest } from './outside-write-guard.ts';
import type { SessionStore } from './sessions.ts';

export interface PendingConfirm {
  sessionId: string;
  request: OutsideWriteRequest;
  resolve: (decision: OutsideWriteDecision) => void;
}

function decisionOf(msg: Record<string, unknown>): OutsideWriteDecision {
  if (msg.decision === 'allow' || msg.decision === 'deny' || msg.decision === 'always') return msg.decision;
  // Older clients answer `{ approved, always }`.
  if (msg.approved === true) return msg.always ? 'always' : 'allow';
  return 'deny';
}

/**
 * Apply a `confirm` frame. "Always" is granted from *server* state — the
 * pending entry's own conversation — never from a session id the frame names.
 * Returns null for an unknown id (stale frame, already answered).
 */
export function applyConfirm(
  msg: Record<string, unknown>,
  pending: Map<string, PendingConfirm>,
  store: SessionStore,
): { pending: PendingConfirm; decision: OutsideWriteDecision } | null {
  const id = typeof msg.id === 'string' ? msg.id : '';
  const entry = pending.get(id);
  if (!entry) return null;
  pending.delete(id);
  const decision = decisionOf(msg);
  if (decision === 'always') store.setOutsideWritesAllowed(entry.sessionId, true);
  return { pending: entry, decision };
}

/** Refuse every confirmation of a conversation (Stop, deletion). */
export function denyAll(sessionId: string, pending: Map<string, PendingConfirm>): number {
  let n = 0;
  for (const [id, p] of pending) {
    if (p.sessionId !== sessionId) continue;
    pending.delete(id);
    p.resolve('deny');
    n++;
  }
  return n;
}
