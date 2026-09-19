/**
 * Base-branch picking for repository links, shared by every surface that
 * attaches a repo to a ticket (ticket sidebar, CreateTaskModal, Work view
 * context panel + new task). The select lists origin's branches; the empty
 * value means "the repository default branch" (no `baseBranch` on the link).
 */
import { useEffect, useState } from 'react';
import * as api from '../../services/api';

/**
 * Turn the raw `git branch` list from `fetchBranches` into picker options: the
 * origin remote's branches (minus `origin/HEAD`, `origin/` prefix stripped) plus
 * the local default branch, which the picker offers as "default".
 */
export function toBaseBranchOptions(branches: string[]): { defaultBranch: string | null; originBranches: string[] } {
  const local = branches.filter((b) => !b.startsWith('origin/'));
  const defaultBranch = local.find((b) => b === 'main' || b === 'master') ?? local[0] ?? null;
  const originBranches = branches
    .filter((b) => b.startsWith('origin/') && b !== 'origin/HEAD')
    .map((b) => b.slice('origin/'.length));
  return { defaultBranch, originBranches };
}

/** Pull the clean `{ error }` message out of a request() failure (thrown as `API error NNN: {json}`). */
export function extractLinkError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const braceIdx = msg.indexOf('{');
  if (braceIdx >= 0) {
    try {
      const json = JSON.parse(msg.slice(braceIdx)) as { error?: unknown };
      if (typeof json.error === 'string') return json.error;
    } catch {
      // fall through to the raw message
    }
  }
  return msg;
}

/**
 * What the UI says while a repository link change waits on the server: each one
 * runs git worktree work, which takes a while on a large repo.
 */
export const REPO_BUSY_LABEL = {
  attach: (baseBranch?: string) =>
    baseBranch ? `Attaching · creating worktree from ${baseBranch}…` : 'Attaching · creating worktree…',
  switchBase: (baseBranch: string) => `Re-creating worktree from ${baseBranch || 'the default branch'}…`,
  remove: 'Removing worktree…',
};

const SELECT_BASE =
  'w-full rounded-md border border-[var(--theme-border-input)] px-2 py-1 text-[var(--theme-text-primary)] focus:border-[var(--theme-accent)] focus:outline-none disabled:opacity-50';

/**
 * Native base-branch select for one `org/name` repo; loads its branches on
 * mount. `className` carries the surface-specific background, size and spacing.
 */
export function RepoBaseBranchSelect({
  repoKey,
  value,
  onChange,
  disabled = false,
  className = 'bg-[var(--theme-bg-surface)] text-xs',
}: {
  repoKey: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [branches, setBranches] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const slashIdx = repoKey.indexOf('/');
    if (slashIdx <= 0) return;
    const org = repoKey.slice(0, slashIdx);
    const name = repoKey.slice(slashIdx + 1);
    let cancelled = false;
    setLoading(true);
    setBranches(null);
    api.fetchBranches(org, name)
      .then((b) => { if (!cancelled) setBranches(b); })
      .catch(() => { if (!cancelled) setBranches([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [repoKey]);

  const options = toBaseBranchOptions(branches ?? []);

  return (
    <select
      className={`${SELECT_BASE} ${className}`}
      value={value}
      disabled={loading || disabled}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{loading ? 'Loading branches…' : `${options.defaultBranch ?? 'main'} (default)`}</option>
      {/* Keep the current base visible while loading, or if origin no longer lists it. */}
      {value && !options.originBranches.includes(value) && <option value={value}>{value}</option>}
      {options.originBranches.map((b) => (
        <option key={b} value={b}>{b}</option>
      ))}
    </select>
  );
}
