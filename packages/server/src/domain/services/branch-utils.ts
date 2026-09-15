import type { TicketLink } from '@fleex/shared';

/**
 * Result of the *pure* part of normalising a user-supplied base branch. The
 * async checks (does the branch exist on origin? is it the repo default?) are
 * the caller's job — they need git and the repo's default branch.
 */
export type BaseBranchNormalization =
  | { ok: true; branch: string }
  | { ok: false; error: string };

/**
 * Normalise a raw base-branch input to a bare branch name on `origin`:
 * - trims surrounding whitespace,
 * - strips a single leading `origin/` (D2 — the value is stored without it),
 * - rejects fully-qualified refs (`refs/...`),
 * - rejects an empty result.
 *
 * It does NOT collapse a value equal to the repo default (D3) nor check
 * existence on origin (D6) — both need repo context the caller holds.
 */
export function normalizeBaseBranchInput(raw: string): BaseBranchNormalization {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: 'base branch is empty' };
  if (trimmed.startsWith('refs/')) {
    return {
      ok: false,
      error: 'base branch must be a branch name, not a fully-qualified ref (refs/...)',
    };
  }
  const stripped = trimmed.startsWith('origin/') ? trimmed.slice('origin/'.length) : trimmed;
  if (!stripped) return { ok: false, error: 'base branch is empty' };
  return { ok: true, branch: stripped };
}

/**
 * Resolve the git base ref a ticket's worktree should be branched FROM, for a
 * given repo. Returns `origin/<baseBranch>` when the ticket's `repository` link
 * for `org/name` carries a custom base branch, otherwise `undefined` — in which
 * case the caller falls back to the repo's default branch (unchanged behaviour).
 *
 * This is the single source of truth every lazy worktree-creation call site
 * uses, so the per-repo base is applied consistently.
 */
export function resolveBaseRef(
  links: readonly TicketLink[],
  org: string,
  name: string,
): string | undefined {
  const ref = `${org}/${name}`;
  const link = links.find((l) => l.type === 'repository' && l.ref === ref);
  return link?.baseBranch ? `origin/${link.baseBranch}` : undefined;
}

/** Build a git branch name for a ticket: ticket/<short-id>-<title-slug> */
export function buildTicketBranchName(title: string, ticketId: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const short = ticketId.slice(0, 6);
  return `ticket/${short}-${slug}`;
}

/**
 * Build the workspace directory name for a ticket: <short-id>-<title-slug>.
 * Re-exported from @fleex/shared so the web client builds the same id.
 */
export { buildTicketWorkspaceId } from '@fleex/shared';
