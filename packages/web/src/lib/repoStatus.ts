/**
 * Repository-status helpers (ticket #401 — prevent forgetting to link a repo).
 *
 * A ticket needs a linked `repository` for a run to build a worktree; without
 * one `ensureWorkspace()` returns silently and the agent runs "with no
 * codebase" (a degraded, silent run). These pure predicates are the single
 * source of truth every front surface keys off — Kanban badge, detail banner,
 * "sans repo" filter and the launch guard-rail — so the notion of "missing
 * repo" stays consistent everywhere.
 *
 * Front-only by design (ticket decision): the flag is a reserved TAG, so no
 * schema/migration is involved — it is set/cleared through the existing
 * `updateTicket({ tags })` endpoint.
 */
import type { Ticket } from '@fleex/shared';

/**
 * Reserved tag marking a ticket as deliberately code-less (press prep, emails,
 * research…). Its presence silences the "missing repo" warning — the absence of
 * a repo becomes an assumed choice, not a forgotten step.
 */
export const NO_REPO_TAG = 'no-repo';

/** True when the ticket carries a `repository` link (what drives the worktree). */
export function ticketHasRepo(ticket: Ticket): boolean {
  return ticket.links.some((l) => l.type === 'repository');
}

/** True when the ticket is explicitly flagged as intentionally code-less. */
export function isRepoOptional(ticket: Ticket): boolean {
  return ticket.tags.includes(NO_REPO_TAG);
}

/**
 * True for the ONLY case we want to warn about: a ticket that should have a
 * repo but doesn't. A flagged "no-code" ticket is never "missing" a repo.
 */
export function isMissingRepo(ticket: Ticket): boolean {
  return !ticketHasRepo(ticket) && !isRepoOptional(ticket);
}

/**
 * True when a comment body mentions an agentic primitive that would spin up a
 * run needing a worktree (`@agent:` / `@skill:` / `@workflow:` / `@panel:`).
 * Struck-through mentions (`~~…~~`) are treated as cancelled and ignored,
 * mirroring the server-side mention parser.
 */
export function mentionsPrimitive(body: string): boolean {
  const withoutStruck = body.replace(/~~[\s\S]*?~~/g, '');
  return /@(?:agent|skill|workflow|panel):[a-zA-Z0-9_-]+/.test(withoutStruck);
}

/**
 * The repos most frequently linked on a given board, ranked by descending
 * usage (ties broken alphabetically for a deterministic, flicker-free order).
 * Powers the 1-click "suggested repos" in the detail banner and the launch
 * guard-rail — computed entirely client-side from tickets already in memory.
 */
export function topReposForBoard(
  tickets: Ticket[],
  boardId: string,
  opts: { exclude?: string[]; limit?: number } = {},
): string[] {
  const { exclude = [], limit = 3 } = opts;
  const excluded = new Set(exclude);
  const counts = new Map<string, number>();

  for (const t of tickets) {
    if (t.boardId !== boardId) continue;
    for (const l of t.links) {
      if (l.type !== 'repository' || excluded.has(l.ref)) continue;
      counts.set(l.ref, (counts.get(l.ref) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([ref]) => ref);
}
