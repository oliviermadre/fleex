/**
 * Server-side decisions behind the "always allow" confirmation gate.
 *
 * Extracted from `server.ts` (which boots `Bun.serve` at import time and so
 * can't be exercised from a test) to keep these rules unit-testable: they are
 * the ones that decide whether a mutating fleex command runs without asking.
 */
import { isAutoApproveActive, type AutoApprove, type SessionData, type SessionStore } from './sessions.ts';
import type { GlobalAllowlist } from './global-allowlist.ts';

/**
 * A confirmation awaiting the user, keyed by tool_use id.
 *
 * Carries the session and tool name so `confirm { always }` can be applied
 * from *server* state: a client frame must never be able to name which
 * conversation or which tool gets a standing approval.
 */
export interface PendingConfirm {
  sessionId: string;
  name: string;
  resolve: (approved: boolean) => void;
}

/** Scope of a standing approval requested alongside an approval. */
export type AlwaysScope = 'tool' | 'session';

function alwaysScope(v: unknown): AlwaysScope | undefined {
  return v === 'tool' || v === 'session' ? v : undefined;
}

/**
 * Apply an incoming `confirm` frame.
 *
 * Returns null when the id is unknown (stale frame, already-answered call, or
 * a socket that reconnected) so the caller can ignore it entirely.
 */
export function applyConfirm(
  msg: Record<string, unknown>,
  pending: Map<string, PendingConfirm>,
  store: SessionStore,
  global?: GlobalAllowlist,
): { pending: PendingConfirm; approved: boolean; allowlistChanged: boolean; globalChanged: boolean } | null {
  const id = typeof msg.id === 'string' ? msg.id : '';
  const entry = pending.get(id);
  if (!entry) return null;
  pending.delete(id);

  const approved = msg.approved === true;
  const scope = alwaysScope(msg.always);
  // A refusal never grants anything — we auto-approve, never auto-deny.
  let allowlistChanged = false;
  let globalChanged = false;
  if (approved && scope) {
    if (scope === 'session') {
      // Blanket trust is a contextual judgement: it never leaves the
      // conversation that granted it.
      store.setAutoApprove(entry.sessionId, { all: true, tools: [] });
    } else {
      // Always granted locally, so the rest of the CURRENT turn stops asking
      // even when the conversation is tainted and the global list is off-limits.
      store.allowTool(entry.sessionId, entry.name);
      if (!store.get(entry.sessionId)?.pageTainted && global) {
        global.allow(entry.name);
        globalChanged = true;
      }
    }
    allowlistChanged = true;
  }
  return { pending: entry, approved, allowlistChanged, globalChanged };
}

/**
 * The single place that answers "may this tool run without asking?".
 *
 * Order matters: the conversation's own grants win first (they cover the
 * tainted case, where the user explicitly consented in-context), then the taint
 * short-circuits the machine-wide list. A tainted conversation is never allowed
 * to cash in a permission the user granted somewhere safe.
 */
export function resolveAutoApproved(
  session: SessionData,
  global: GlobalAllowlist | undefined,
  toolName: string,
): boolean {
  const aa = session.autoApprove;
  if (aa?.all) return true;
  if (aa?.tools.includes(toolName)) return true;
  if (session.pageTainted) return false;
  return global?.has(toolName) ?? false;
}

/**
 * Apply a `set_auto_approve` frame (full replacement, never a patch).
 * Returns false for an unknown session so the caller skips the broadcast.
 */
export function applySetAutoApprove(msg: Record<string, unknown>, store: SessionStore): boolean {
  const id = typeof msg.id === 'string' ? msg.id : '';
  if (!id || !store.get(id)) return false;
  const next: AutoApprove = {
    all: msg.all === true,
    tools: Array.isArray(msg.tools) ? msg.tools.filter((t): t is string => typeof t === 'string') : [],
  };
  store.setAutoApprove(id, next);
  return true;
}

/**
 * Disarm auto-approval when untrusted web-page content joins the conversation.
 *
 * Attaching a page is exactly the prompt-injection vector the gate defends
 * against, so a standing approval granted before it must not survive it, and
 * the conversation is tainted for good (it can no longer draw on the
 * machine-wide allowlist).
 *
 * The global allowlist itself is deliberately left untouched: attaching a page
 * here must not revoke permissions the user granted in other, clean
 * conversations.
 *
 * Returns true when a live approval was actually disarmed (nothing to tell the
 * user otherwise) — the taint is applied either way.
 */
export function disarmForPage(sessionId: string, store: SessionStore): boolean {
  const s = store.get(sessionId);
  if (!s) return false;
  const wasArmed = isAutoApproveActive(s.autoApprove);
  store.markPageTainted(sessionId);
  if (!wasArmed) return false;
  store.clearAutoApprove(sessionId);
  return true;
}
