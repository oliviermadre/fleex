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

/** What a worktree should be created as for one repo — see {@link resolveWorktreeTarget}. */
export interface WorktreeTarget {
  /** The git branch to check out / create. */
  readonly branch: string;
  /** True → mint `branch` (from `baseBranch` or the repo default); false → check `branch` out as-is. */
  readonly createNewBranch: boolean;
  /** `origin/<base>` when a fresh ticket branch is derived from a custom base. */
  readonly baseBranch?: string;
  /** The PR number, so a fork's head can be fetched via `refs/pull/<n>/head` when its branch is missing. */
  readonly prNumber?: number;
}

/**
 * Decide, for one repo, what branch a ticket's worktree targets — the single
 * precedence every worktree-creation site should follow. Pure: the caller runs
 * git and supplies the freshly-fetched PR head branch (`prHeadRefName`) when it
 * has one.
 *
 * Precedence (highest first):
 *  1. the repository link's `checkoutRef` → check that branch out directly (with
 *     the linked PR's number, so a fork's head can still be fetched);
 *  2. the repository link's `baseBranch` → branch a fresh ticket branch on top of
 *     `origin/<base>` — even when a PR link exists (this is what "branch on top"
 *     of an imported PR means, and it protects the PR);
 *  3. a `github_pr` link on the repo (legacy dashboard import) → check out the
 *     PR's head branch as-is — unchanged behaviour;
 *  4. otherwise → mint the ticket branch from the repo's default branch.
 */
export function resolveWorktreeTarget(
  links: readonly TicketLink[],
  org: string,
  name: string,
  ticketBranch: string,
  prHeadRefName?: string,
): WorktreeTarget {
  const repoRef = `${org}/${name}`;
  const repoLink = links.find((l) => l.type === 'repository' && l.ref === repoRef);
  const prLink = links.find(
    (l) => l.type === 'github_pr' && l.ref.toLowerCase().startsWith(`${repoRef.toLowerCase()}#`),
  );
  const prNumber = prLink ? parseInt(prLink.ref.split('#')[1] ?? '', 10) || undefined : undefined;

  if (repoLink?.checkoutRef) {
    return { branch: repoLink.checkoutRef, createNewBranch: false, ...(prNumber ? { prNumber } : {}) };
  }
  if (repoLink?.baseBranch) {
    return { branch: ticketBranch, createNewBranch: true, baseBranch: `origin/${repoLink.baseBranch}` };
  }
  if (prLink && prHeadRefName) {
    return { branch: prHeadRefName, createNewBranch: false };
  }
  return { branch: ticketBranch, createNewBranch: true };
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
