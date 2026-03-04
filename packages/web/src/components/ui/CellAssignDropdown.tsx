import { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { WorktreeSessionGroup } from '@asm/shared';
import { useSessionStore } from '../../stores/sessionStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { cn } from '../../lib/cn';

export interface CellAssignDropdownProps {
  groupId: string;
  cellIndex: number;
  currentWorktreeKey: string | null;
  anchorRect: DOMRect;
  onClose: () => void;
}

function isSystemGroup(org: string, name: string) {
  return org === '_ungrouped' && name === '_ungrouped';
}

/** Sort worktrees using worktreeOrder, fallback to alphabetical by branch */
function sortWorktrees(wts: readonly WorktreeSessionGroup[], order: string[] | undefined): WorktreeSessionGroup[] {
  if (!order || order.length === 0) {
    return [...wts].sort((a, b) => a.branch.localeCompare(b.branch));
  }
  const orderMap = new Map(order.map((id, i) => [id, i]));
  return [...wts].sort((a, b) => (orderMap.get(a.branch) ?? Infinity) - (orderMap.get(b.branch) ?? Infinity));
}

export function CellAssignDropdown({
  groupId,
  cellIndex,
  currentWorktreeKey,
  anchorRect,
  onClose,
}: CellAssignDropdownProps) {
  const sessionGroups = useSessionStore((s) => s.sessionGroups);
  const bindLayoutGroupCell = useSettingsStore((s) => s.bindLayoutGroupCell);
  const repoOrder = useSettingsStore((s) => s.settings.repoOrder);
  const worktreeOrder = useSettingsStore((s) => s.settings.worktreeOrder);

  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const assign = (worktreeKey: string | null) => {
    bindLayoutGroupCell(groupId, cellIndex, worktreeKey);
    onClose();
  };

  // Build ordered list of assignable worktrees, mirroring sidebar order
  const { repoSections, hasSystemSessions } = useMemo(() => {
    const sysGroup = sessionGroups.find((g) => isSystemGroup(g.repositoryOrg, g.repositoryName));
    const hasSys = (sysGroup?.worktrees.flatMap((wt) => wt.sessions).length ?? 0) > 0;

    const repoGroups = sessionGroups.filter(
      (g) => !isSystemGroup(g.repositoryOrg, g.repositoryName)
    );

    const repoOrderMap = new Map(repoOrder.map((id, i) => [id, i]));
    const sortedRepos = [...repoGroups].sort((a, b) => {
      const aId = `${a.repositoryOrg}/${a.repositoryName}`;
      const bId = `${b.repositoryOrg}/${b.repositoryName}`;
      return (repoOrderMap.get(aId) ?? Infinity) - (repoOrderMap.get(bId) ?? Infinity);
    });

    const sections = sortedRepos.map((group) => {
      const gId = `${group.repositoryOrg}/${group.repositoryName}`;
      const wtOrder = worktreeOrder[gId];
      const sortedWts = sortWorktrees(group.worktrees, wtOrder).filter((wt) => wt.sessions.length > 0);
      return { repoId: gId, worktrees: sortedWts };
    }).filter((s) => s.worktrees.length > 0);

    return { repoSections: sections, hasSystemSessions: hasSys };
  }, [sessionGroups, repoOrder, worktreeOrder]);

  // Position: below anchor or above if not enough space
  const spaceBelow = window.innerHeight - anchorRect.bottom;
  const showAbove = spaceBelow < 220;

  const style: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(anchorRect.left, window.innerWidth - 260),
    zIndex: 1000,
    minWidth: Math.max(260, anchorRect.width),
    ...(showAbove
      ? { bottom: window.innerHeight - anchorRect.top + 4 }
      : { top: anchorRect.bottom + 4 }),
  };

  const hasAny = repoSections.length > 0 || hasSystemSessions;

  return createPortal(
    <div
      ref={ref}
      style={style}
      className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] shadow-2xl max-h-80 overflow-y-auto py-1"
    >
      {/* Unassign */}
      {currentWorktreeKey && (
        <>
          <button
            onClick={() => assign(null)}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium text-red-400 hover:bg-[var(--theme-bg-hover)] hover:text-red-300 transition-colors text-left"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="4" y1="4" x2="12" y2="12" />
              <line x1="12" y1="4" x2="4" y2="12" />
            </svg>
            Unassign
          </button>
          <div className="h-px mx-2 my-1 bg-[var(--theme-border)]" />
        </>
      )}

      {/* System shells — first, mirrors sidebar order */}
      {hasSystemSessions && (
        <div>
          <div className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-widest text-[var(--theme-text-secondary)] bg-[var(--theme-bg-surface)] sticky top-0">
            Shells
          </div>
          <button
            onClick={() => assign('_system')}
            className={cn(
              'flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors',
              currentWorktreeKey === '_system'
                ? 'bg-[var(--theme-accent-muted)] text-[var(--theme-accent)]'
                : 'text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-hover)]'
            )}
          >
            {currentWorktreeKey === '_system' ? (
              <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" className="shrink-0">
                <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[var(--theme-text-muted)]">
                <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
                <polyline points="4.5,6.5 7,9 4.5,11.5" />
                <line x1="9" y1="11.5" x2="11.5" y2="11.5" />
              </svg>
            )}
            <span className="text-sm font-medium">Default shell</span>
          </button>
          {repoSections.length > 0 && <div className="h-px mx-2 my-1 bg-[var(--theme-border)]" />}
        </div>
      )}

      {/* Repo-grouped worktrees */}
      {repoSections.map(({ repoId, worktrees }) => (
        <div key={repoId}>
          <div className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-widest text-[var(--theme-text-secondary)] bg-[var(--theme-bg-surface)] sticky top-0">
            {repoId}
          </div>
          {worktrees.map((wt) => {
            const wtKey = `${repoId}:${wt.branch}`;
            const isActive = currentWorktreeKey === wtKey;
            return (
              <button
                key={wtKey}
                onClick={() => assign(wtKey)}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors',
                  isActive
                    ? 'bg-[var(--theme-accent-muted)] text-[var(--theme-accent)]'
                    : 'text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-hover)]'
                )}
              >
                {isActive ? (
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" className="shrink-0">
                    <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
                  </svg>
                ) : (
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[var(--theme-text-muted)]">
                    <circle cx="5" cy="3.5" r="1.5" /><circle cx="5" cy="12.5" r="1.5" /><circle cx="12" cy="7" r="1.5" />
                    <path d="M5 5v6M5 7.5c0-1.5 1-3 4.5-3" />
                  </svg>
                )}
                <span className="text-sm font-medium font-mono truncate">{wt.branch}</span>
                <span className="ml-auto text-[11px] text-[var(--theme-text-faint)] shrink-0">
                  {wt.sessions.length} session{wt.sessions.length !== 1 ? 's' : ''}
                </span>
              </button>
            );
          })}
        </div>
      ))}

      {!hasAny && (
        <div className="px-3 py-4 text-sm text-[var(--theme-text-muted)] text-center">
          No sessions available
        </div>
      )}
    </div>,
    document.body
  );
}
