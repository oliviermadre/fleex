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

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Half-life (in days) of a repo link's weight in the suggestion ranking. A link
 * created this many days ago counts half as much as one created today; twice
 * that ago, a quarter; and so on. Chosen at 60 days so the last ~month clearly
 * dominates while a repo used a quarter ago still carries ~35% of its weight —
 * a graceful taper rather than a hard cutoff. Tune here to make suggestions
 * more (lower) or less (higher) recency-biased.
 */
export const REPO_SUGGESTION_HALF_LIFE_DAYS = 60;

/**
 * The repos most relevant to link on a given board, ranked by
 * RECENCY-WEIGHTED usage: each `repository` link contributes an exponentially
 * decaying weight based on how long ago it was created (`link.createdAt`), so
 * the repo you've been working with lately floats to the top rather than the
 * one you happened to use most over all time. Ties break alphabetically for a
 * deterministic, flicker-free order. Computed entirely client-side from tickets
 * already in memory; powers the 1-click "suggested repos" in the detail banner,
 * the launch guard-rail and the sidebar picker.
 *
 * WHY exponential decay (not a fixed "last N months" window): a hard window
 * would erase a board's ranking after a quiet quarter. With decay there is no
 * cutoff — and because a dormant board's weights all shrink by the SAME factor
 * (`2^(-now/H)` is common to every repo), the RELATIVE ranking is preserved no
 * matter how long the pause. Recency biases the order; it never wipes it.
 *
 * `now` is injectable purely so tests are deterministic; production uses the
 * wall clock.
 */
export function topReposForBoard(
  tickets: Ticket[],
  boardId: string,
  opts: { exclude?: string[]; limit?: number; now?: number } = {},
): string[] {
  const { exclude = [], limit = 3, now = Date.now() } = opts;
  const excluded = new Set(exclude);
  const halfLifeMs = REPO_SUGGESTION_HALF_LIFE_DAYS * DAY_MS;
  const weights = new Map<string, number>();

  for (const t of tickets) {
    if (t.boardId !== boardId) continue;
    for (const l of t.links) {
      if (l.type !== 'repository' || excluded.has(l.ref)) continue;
      const ts = Date.parse(l.createdAt);
      // Age since the repo was linked. A missing/invalid or future-dated stamp
      // (clock skew) is treated as "just now" (age 0 → full weight) so a data
      // glitch never silently buries an otherwise-relevant repo.
      const ageMs = Number.isFinite(ts) ? Math.max(0, now - ts) : 0;
      // Weight halves every REPO_SUGGESTION_HALF_LIFE_DAYS; stays in (0, 1].
      const weight = 2 ** (-ageMs / halfLifeMs);
      weights.set(l.ref, (weights.get(l.ref) ?? 0) + weight);
    }
  }

  return [...weights.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([ref]) => ref);
}
