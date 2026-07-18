import { useMemo, useState } from 'react';
import type { OverlaySyncRepoTarget, Ticket, WorktreeSessionGroup } from '@fleex/shared';
import { useSessionStore } from '../../stores/sessionStore';
import { OverlaySyncModal } from './OverlaySyncModal';

interface Props {
  ticket: Ticket | null;
  /** Current worktree — fallback target when no ticket/workspace context. */
  worktree: WorktreeSessionGroup | null;
  repoOrg: string;
  repoName: string;
}

/** `_global`-prefixed pseudo-repos have no overlay target of their own. */
function isRealRepo(org: string): boolean {
  return Boolean(org) && !org.startsWith('_');
}

function OverlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="M8 1.5 14.5 5 8 8.5 1.5 5 8 1.5Z" />
      <path d="m1.5 8 6.5 3.5L14.5 8" />
      <path d="m1.5 11 6.5 3.5L14.5 11" />
    </svg>
  );
}

export function OverlaySyncButton({ ticket, worktree, repoOrg, repoName }: Props) {
  const [open, setOpen] = useState(false);
  const sessionGroups = useSessionStore((s) => s.sessionGroups);

  // Enumerate every real repo of the workspace: when a ticket is present, take
  // all worktrees bound to it across repos; otherwise fall back to the single
  // current worktree.
  const repos = useMemo<OverlaySyncRepoTarget[]>(() => {
    if (ticket) {
      const out: OverlaySyncRepoTarget[] = [];
      const seen = new Set<string>();
      for (const group of sessionGroups) {
        if (!isRealRepo(group.repositoryOrg)) continue;
        for (const wt of group.worktrees) {
          if (wt.ticketId !== ticket.id) continue;
          const key = `${group.repositoryOrg}/${group.repositoryName}:${wt.path}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ org: group.repositoryOrg, name: group.repositoryName, worktreePath: wt.path });
        }
      }
      if (out.length > 0) return out;
    }
    if (worktree && isRealRepo(repoOrg)) {
      return [{ org: repoOrg, name: repoName, worktreePath: worktree.path }];
    }
    return [];
  }, [ticket, sessionGroups, worktree, repoOrg, repoName]);

  if (repos.length === 0) return null;

  return (
    <>
      <button
        type="button"
        className="flex h-6 shrink-0 items-center gap-1 rounded border border-[var(--theme-border)] bg-[var(--theme-bg-overlay)] px-2 text-[11px] font-medium text-[var(--theme-text-secondary)] transition-all hover:border-[var(--theme-accent)] hover:bg-[var(--theme-accent-muted)] hover:text-[var(--theme-text-primary)]"
        onClick={() => setOpen(true)}
        title="Copier les fichiers gitignorés vers l'overlay"
      >
        <OverlayIcon />
        Sync overlay
      </button>
      <OverlaySyncModal open={open} onClose={() => setOpen(false)} repos={repos} />
    </>
  );
}
