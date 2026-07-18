import { useMemo, useState } from 'react';
import type { Ticket, WorktreeSessionGroup } from '@fleex/shared';
import { useSettingsStore } from '../../stores/settingsStore';
import { buildWorkspaceContext } from '../../lib/templateUtils';
import { OverlaySyncModal } from './OverlaySyncModal';

interface Props {
  ticket: Ticket | null;
  /** Current worktree — fallback target when there is no ticket/workspace context. */
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

export function OverlaySyncButton({ ticket, worktree, repoOrg }: Props) {
  const [open, setOpen] = useState(false);
  const basePath = useSettingsStore((s) => s.settings.basePath);

  // The directory the server walks to discover worktrees. In a ticket context
  // that is the ticket's workspace root (its Current Working Directory), whose
  // subdirectories are the repo worktrees — deterministic and independent of any
  // live session. Without a ticket we fall back to the current worktree checkout.
  const rootPath = useMemo<string>(() => {
    if (ticket) return buildWorkspaceContext(ticket, basePath).workspace_path;
    if (worktree && isRealRepo(repoOrg)) return worktree.path;
    return '';
  }, [ticket, basePath, worktree, repoOrg]);

  if (!rootPath) return null;

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
      <OverlaySyncModal open={open} onClose={() => setOpen(false)} rootPath={rootPath} />
    </>
  );
}
