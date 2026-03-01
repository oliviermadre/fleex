import { useMemo, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import type { SessionGroup, Session, TicketLink } from '@asm/shared';
import { useUIStore } from '../../stores/uiStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTicketStore } from '../../stores/ticketStore';
import { SidebarHeader } from './SidebarHeader';
import { SessionGroups } from './SessionGroups';
import { SettingsNav } from '../settings/SettingsNav';
import { RepositoriesContent } from './RepositoriesContent';
import { ClaudeConfigTree } from '../claude-config/ClaudeConfigTree';
import { ScratchpadsContent } from '../scratchpad/ScratchpadsContent';
import { TicketsContentPanel } from '../tickets/TicketsContentPanel';
import { aggregateBranchStatus, type DisplayStatus } from '../../lib/deriveStatus';
import { StatusDot } from '../ui/StatusDot';
import { cn } from '../../lib/cn';

export function ContentPanel() {
  const activePanel = useUIStore((s) => s.activePanel);
  const contentPanelCollapsed = useUIStore((s) => s.contentPanelCollapsed);

  if (contentPanelCollapsed) {
    return <CollapsedContentPanel />;
  }

  return (
    <div className="flex h-full flex-col border-r border-[var(--theme-border)] bg-[var(--theme-bg-surface)]">
      {activePanel === 'sessions' && <BranchesContent />}
      {activePanel === 'repositories' && <RepositoriesContent />}
      {activePanel === 'tickets' && <TicketsContentPanel />}
      {activePanel === 'claude-config' && <ClaudeConfigTree />}
      {activePanel === 'cluster' && null}
      {activePanel === 'scratchpads' && <ScratchpadsContent />}
      {activePanel === 'settings' && <SettingsNav />}
    </div>
  );
}

function BranchesContent() {
  return (
    <>
      <SidebarHeader />
      <SessionGroups />
    </>
  );
}

function isSystemGroup(org: string, name: string): boolean {
  return org === '_ungrouped' && name === '_ungrouped';
}

/** Fixed-position tooltip rendered via portal, outside any overflow container */
interface TooltipData {
  line1: string;
  line2: string;
  top: number;   // center-Y of the hovered element (viewport coords)
  right: number; // right edge of the hovered element (viewport coords)
}

function CollapsedTooltip({ data }: { data: TooltipData | null }) {
  if (!data) return null;
  return createPortal(
    <div
      className="pointer-events-none fixed z-[100]"
      style={{ top: data.top, left: data.right + 10, transform: 'translateY(-50%)' }}
    >
      <div className="whitespace-nowrap rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-overlay)] px-3 py-2 shadow-xl">
        <div className="text-sm font-bold text-[var(--theme-text-primary)]">{data.line1}</div>
        <div className="text-xs text-[var(--theme-text-muted)]">{data.line2}</div>
      </div>
    </div>,
    document.body,
  );
}

function useCollapsedTooltip() {
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const hideTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  const show = useCallback((e: React.MouseEvent, line1: string, line2: string) => {
    clearTimeout(hideTimeout.current);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTooltip({ line1, line2, top: rect.top + rect.height / 2, right: rect.right });
  }, []);

  const hide = useCallback(() => {
    hideTimeout.current = setTimeout(() => setTooltip(null), 80);
  }, []);

  return { tooltip, show, hide } as const;
}

/**
 * Collapsed worktree indicator with height-matched invisible structure.
 * Uses invisible placeholder rows (same CSS as expanded WorktreeGroup)
 * so the height matches exactly, then overlays icon+dot with absolute positioning.
 */
function CollapsedWorktreeItem({
  status,
  isSelected,
  hasTicket,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: {
  status: DisplayStatus;
  isSelected: boolean;
  hasTicket: boolean;
  onClick: () => void;
  onMouseEnter: (e: React.MouseEvent) => void;
  onMouseLeave: () => void;
}) {
  return (
    <div className="group/wt relative">
      <button
        className={cn(
          'relative flex min-w-0 w-full flex-col gap-0.5 py-2.5 text-left transition-colors border-l-2',
          isSelected
            ? 'border-[var(--theme-accent)] bg-[var(--theme-bg-hover)]'
            : 'border-transparent hover:bg-[var(--theme-bg-hover)]'
        )}
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        {/* Invisible height structure — mirrors expanded WorktreeGroup rows */}
        <div className="invisible">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold font-mono">&nbsp;</span>
          </div>
          <div className="flex items-center gap-1.5 pl-5">
            <span className="text-xs">&nbsp;</span>
          </div>
          {hasTicket && (
            <div className="flex items-center gap-1 pl-5">
              <span className="text-xs">&nbsp;</span>
            </div>
          )}
        </div>

        {/* Visible centered icon+dot overlay */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
          {status === 'needs-approval' && (
            <span className="absolute -top-0.5 right-0.5 text-[10px] text-amber-400">&#9888;</span>
          )}
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-[var(--theme-text-faint)]"
          >
            <circle cx="5" cy="3.5" r="1.5" />
            <circle cx="11" cy="3.5" r="1.5" />
            <circle cx="8" cy="12.5" r="1.5" />
            <line x1="5" y1="5" x2="5" y2="7" />
            <line x1="11" y1="5" x2="11" y2="7" />
            <path d="M5 7c0 1.5 1.5 2.5 3 4M11 7c0 1.5-1.5 2.5-3 4" />
          </svg>
          <StatusDot status={status} />
        </div>
      </button>
    </div>
  );
}

/** Collapsed system worktree indicator — height matches expanded SystemWorktreeItem */
function CollapsedSystemItem({
  status,
  isSelected,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: {
  status: DisplayStatus;
  isSelected: boolean;
  onClick: () => void;
  onMouseEnter: (e: React.MouseEvent) => void;
  onMouseLeave: () => void;
}) {
  return (
    <div className="group/wt relative">
      <button
        className={cn(
          'relative flex min-w-0 w-full flex-col gap-0.5 py-2.5 text-left transition-colors border-l-2',
          isSelected
            ? 'border-[var(--theme-accent)] bg-[var(--theme-bg-hover)]'
            : 'border-transparent hover:bg-[var(--theme-bg-hover)]'
        )}
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        {/* Invisible height structure — mirrors expanded SystemWorktreeItem rows */}
        <div className="invisible">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold font-mono">&nbsp;</span>
          </div>
          <div className="flex items-center gap-1.5 pl-5">
            <span className="text-xs">&nbsp;</span>
          </div>
        </div>

        {/* Visible centered icon+dot overlay */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-[var(--theme-text-faint)]"
          >
            <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
            <polyline points="4.5,6.5 7,9 4.5,11.5" />
            <line x1="9" y1="11.5" x2="11.5" y2="11.5" />
          </svg>
          <StatusDot status={status} />
        </div>
      </button>
    </div>
  );
}

function CollapsedContentPanel() {
  const navigate = useNavigate();
  const toggleContentPanel = useUIStore((s) => s.toggleContentPanel);
  const sessionGroups = useSessionStore((s) => s.sessionGroups);
  const selectedSessionId = useSessionStore((s) => s.selectedSessionId);
  const lastActiveTabByWorktree = useUIStore((s) => s.lastActiveTabByWorktree);
  const collapsedGroups = useUIStore((s) => s.collapsedGroups);
  const repoOrder = useSettingsStore((s) => s.settings.repoOrder);
  const worktreeOrder = useSettingsStore((s) => s.settings.worktreeOrder);
  const tickets = useTicketStore((s) => s.tickets);
  const { tooltip, show: showTooltip, hide: hideTooltip } = useCollapsedTooltip();

  // Build a set of worktree keys that have linked tickets (affects row count / height)
  const worktreeHasTicket = useMemo(() => {
    const set = new Set<string>();
    for (const ticket of tickets) {
      for (const link of ticket.links) {
        if ((link as TicketLink).type === 'worktree') {
          set.add((link as TicketLink).ref);
        }
      }
    }
    return set;
  }, [tickets]);

  // Separate system group from repo groups (same logic as SessionGroups)
  const systemSessions: Session[] = useMemo(() => {
    const ungrouped = sessionGroups.find((g) =>
      isSystemGroup(g.repositoryOrg, g.repositoryName)
    );
    if (!ungrouped) return [];
    return ungrouped.worktrees.flatMap((wt) => wt.sessions);
  }, [sessionGroups]);

  const sortedRepoGroups: SessionGroup[] = useMemo(() => {
    const repoGroups = sessionGroups.filter(
      (g) => !isSystemGroup(g.repositoryOrg, g.repositoryName)
    );
    if (repoOrder.length === 0) return repoGroups;
    const orderMap = new Map(repoOrder.map((id, i) => [id, i]));
    return [...repoGroups].sort((a, b) => {
      const aId = `${a.repositoryOrg}/${a.repositoryName}`;
      const bId = `${b.repositoryOrg}/${b.repositoryName}`;
      return (orderMap.get(aId) ?? Infinity) - (orderMap.get(bId) ?? Infinity);
    });
  }, [sessionGroups, repoOrder]);

  const navigateToWorktree = (worktreeKey: string, sessions: Session[]) => {
    if (sessions.length === 0) return;
    const lastActive = lastActiveTabByWorktree[worktreeKey];
    const targetId = lastActive && sessions.some((s) => s.id === lastActive)
      ? lastActive
      : sessions[0]!.id;
    navigate(`/sessions/${targetId}`, { replace: true });
  };

  const systemStatus = useMemo(() => aggregateBranchStatus(systemSessions), [systemSessions]);
  const systemSelected = systemSessions.some((s) => s.id === selectedSessionId);

  return (
    <div className="flex h-full flex-col items-center border-r border-[var(--theme-border)] bg-[var(--theme-bg-surface)]">
      {/* Expand button — same height as SidebarHeader */}
      <button
        onClick={toggleContentPanel}
        className="flex w-full shrink-0 items-center justify-center border-b border-[var(--theme-border)] text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]"
        style={{ height: 'var(--header-height)' }}
        title="Expand panel"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="1.5" y="1.5" width="13" height="13" rx="2" />
          <line x1="6" y1="1.5" x2="6" y2="14.5" />
        </svg>
      </button>

      {/* Scrollable — mirrors SessionGroups structure exactly */}
      <div className="flex-1 overflow-y-auto w-full">
        {/* System group — mirrors SystemGroup structure */}
        {systemSessions.length > 0 && (
          <div className="my-1.5">
            {/* Header spacer — same height as SystemGroup header button, with visible separator */}
            <div className="relative flex w-full items-center gap-1.5 px-4 py-2">
              <div className="invisible flex w-full items-center gap-1.5">
                <svg width="10" height="10" viewBox="0 0 10 10"><path d="M3 1l5 4-5 4V1z" /></svg>
                <span className="text-[11px] font-bold uppercase tracking-wider">&nbsp;</span>
              </div>
              <div className="absolute inset-x-4 top-1/2 h-px bg-[var(--theme-border)]" />
            </div>
            {/* System worktree item (only shown when group not collapsed) */}
            {!collapsedGroups.has('_system') && (
              <CollapsedSystemItem
                status={systemStatus.status}
                isSelected={systemSelected}
                onClick={() => navigateToWorktree('_system', systemSessions)}
                onMouseEnter={(e) => showTooltip(e, 'Shells', `${systemSessions.length} session${systemSessions.length !== 1 ? 's' : ''}`)}
                onMouseLeave={hideTooltip}
              />
            )}
          </div>
        )}

        {/* Repository groups — mirrors RepositoryGroup structure */}
        {sortedRepoGroups.map((group) => {
          const groupId = `${group.repositoryOrg}/${group.repositoryName}`;
          const isGroupCollapsed = collapsedGroups.has(groupId);

          return (
            <div key={groupId} className="my-1.5">
              {/* Header spacer — matches RepositoryGroup header button height.
                  Contains invisible elements identical to expanded header (arrow + text + 14px icons)
                  plus a visible separator line overlaid. */}
              <div className="relative flex w-full items-center gap-1.5 px-4 py-2">
                <div className="invisible flex w-full items-center gap-1.5">
                  <svg width="10" height="10" viewBox="0 0 10 10"><path d="M3 1l5 4-5 4V1z" /></svg>
                  <span className="text-[11px] font-bold uppercase tracking-wider">&nbsp;</span>
                  <span className="ml-auto flex items-center gap-1">
                    <svg width="14" height="14" />
                    <svg width="14" height="14" />
                  </span>
                </div>
                {/* Visible separator line */}
                <div className="absolute inset-x-4 top-1/2 h-px bg-[var(--theme-border)]" />
              </div>

              {/* Worktree indicators (hidden when group is collapsed, same as expanded) */}
              {!isGroupCollapsed &&
                (() => {
                  const wtOrder = worktreeOrder[groupId];
                  const sorted = wtOrder && wtOrder.length > 0
                    ? [...group.worktrees].sort((a, b) => {
                        const orderMap = new Map(wtOrder.map((id, i) => [id, i]));
                        return (orderMap.get(a.branch) ?? Infinity) - (orderMap.get(b.branch) ?? Infinity);
                      })
                    : [...group.worktrees].sort((a, b) => a.branch.localeCompare(b.branch));

                  return sorted.map((wt) => {
                    const worktreeKey = `${groupId}:${wt.branch}`;
                    const status = aggregateBranchStatus(wt.sessions);
                    const isSelected = wt.sessions.some((s) => s.id === selectedSessionId);

                    return (
                      <CollapsedWorktreeItem
                        key={wt.branch}
                        status={status.status}
                        isSelected={isSelected}
                        hasTicket={worktreeHasTicket.has(worktreeKey)}
                        onClick={() => navigateToWorktree(worktreeKey, wt.sessions)}
                        onMouseEnter={(e) => showTooltip(e, wt.branch, groupId)}
                        onMouseLeave={hideTooltip}
                      />
                    );
                  });
                })()}
            </div>
          );
        })}
      </div>
      <CollapsedTooltip data={tooltip} />
    </div>
  );
}
