import { useMemo, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import type { SessionGroup, Session, TicketLink, RepositorySummary } from '@fleex/shared';
import { useUIStore, type SettingsTab } from '../../stores/uiStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTicketStore } from '../../stores/ticketStore';
import { useRepositoryDashboardStore } from '../../stores/repositoryDashboardStore';
import { useClaudeConfigStore } from '../../stores/claudeConfigStore';
import { useScratchpadStore } from '../../stores/scratchpadStore';
import { SidebarHeader } from './SidebarHeader';
import { SessionGroups } from './SessionGroups';
import { SettingsNav } from '../settings/SettingsNav';
import { RepositoriesContent } from './RepositoriesContent';
import { ClaudeConfigTree } from '../claude-config/ClaudeConfigTree';
import { ScratchpadsContent } from '../scratchpad/ScratchpadsContent';
import { TicketsContentPanel } from '../tickets/TicketsContentPanel';
import { AgentListPanel } from '../agents/AgentListPanel';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';
import { aggregateBranchStatus, type DisplayStatus } from '../../lib/deriveStatus';
import { StatusDot } from '../ui/StatusDot';
import { cn } from '../../lib/cn';

export function ContentPanel() {
  const activePanel = useUIStore((s) => s.activePanel);
  const contentPanelCollapsed = useUIStore((s) => s.contentPanelCollapsed);

  if (contentPanelCollapsed) {
    if (activePanel === 'sessions') return <CollapsedBranchesPanel />;
    if (activePanel === 'repositories') return <CollapsedRepositoriesPanel />;
    if (activePanel === 'tickets') return <CollapsedTicketsPanel />;
    if (activePanel === 'claude-config') return <CollapsedClaudeConfigPanel />;
    if (activePanel === 'agents') return <CollapsedAgentsPanel />;
    if (activePanel === 'scratchpads') return <CollapsedScratchpadsPanel />;
    if (activePanel === 'settings') return <CollapsedSettingsPanel />;
    // cluster or unknown — just show expand button
    return <CollapsedShell />;
  }

  return (
    <div className="flex h-full flex-col border-r border-[var(--theme-border)] bg-[var(--theme-bg-surface)]">
      {activePanel === 'sessions' && <BranchesContent />}
      {activePanel === 'repositories' && <RepositoriesContent />}
      {activePanel === 'tickets' && <TicketsContentPanel />}
      {activePanel === 'claude-config' && <ClaudeConfigTree />}
      {activePanel === 'agents' && <AgentListPanel />}
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

// ── Shared collapsed infrastructure ──

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

/** Expand button — same height as SidebarHeader, shared by all collapsed panels */
function ExpandButton() {
  const toggleContentPanel = useUIStore((s) => s.toggleContentPanel);
  return (
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
  );
}

/** Outer shell for all collapsed panels */
function CollapsedShell({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center border-r border-[var(--theme-border)] bg-[var(--theme-bg-surface)]">
      <ExpandButton />
      {children}
    </div>
  );
}

/** Reusable collapsed row — icon centered, hover tooltip, optional click & selection */
function CollapsedRow({
  icon,
  isSelected,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: {
  icon: React.ReactNode;
  isSelected?: boolean;
  onClick?: () => void;
  onMouseEnter: (e: React.MouseEvent) => void;
  onMouseLeave: () => void;
}) {
  return (
    <button
      className={cn(
        'flex w-full items-center justify-center py-2.5 transition-colors border-l-2',
        isSelected
          ? 'border-[var(--theme-accent)] bg-[var(--theme-bg-hover)]'
          : 'border-transparent hover:bg-[var(--theme-bg-hover)]',
      )}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {icon}
    </button>
  );
}

/** Extract initials from a name: "fleex-server" → "FS", "legacy-api" → "LA" */
function nameToInitials(name: string): string {
  return name
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

/** Separator line between groups */
function CollapsedSeparator() {
  return (
    <div className="relative flex w-full items-center px-4 py-2">
      <div className="absolute inset-x-4 top-1/2 h-px bg-[var(--theme-border)]" />
    </div>
  );
}

// ═══════════════════════════════════════════════
// ── 1. Collapsed Branches panel ──
// ═══════════════════════════════════════════════

function isSystemGroup(org: string, name: string): boolean {
  return org === '_ungrouped' && name === '_ungrouped';
}

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
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
          {status === 'needs-approval' && (
            <span className="absolute -top-0.5 right-0.5 text-[10px] text-amber-400">&#9888;</span>
          )}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--theme-text-faint)]">
            <circle cx="5" cy="3.5" r="1.5" /><circle cx="11" cy="3.5" r="1.5" /><circle cx="8" cy="12.5" r="1.5" />
            <line x1="5" y1="5" x2="5" y2="7" /><line x1="11" y1="5" x2="11" y2="7" />
            <path d="M5 7c0 1.5 1.5 2.5 3 4M11 7c0 1.5-1.5 2.5-3 4" />
          </svg>
          <StatusDot status={status} />
        </div>
      </button>
    </div>
  );
}

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
        <div className="invisible">
          <div className="flex items-center gap-1.5"><span className="text-sm font-semibold font-mono">&nbsp;</span></div>
          <div className="flex items-center gap-1.5 pl-5"><span className="text-xs">&nbsp;</span></div>
        </div>
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--theme-text-faint)]">
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

function CollapsedBranchesPanel() {
  const navigate = useNavigate();
  const sessionGroups = useSessionStore((s) => s.sessionGroups);
  const selectedSessionId = useSessionStore((s) => s.selectedSessionId);
  const lastActiveTabByWorktree = useUIStore((s) => s.lastActiveTabByWorktree);
  const collapsedGroups = useUIStore((s) => s.collapsedGroups);
  const repoOrder = useSettingsStore((s) => s.settings.repoOrder);
  const worktreeOrder = useSettingsStore((s) => s.settings.worktreeOrder);
  const tickets = useTicketStore((s) => s.tickets);
  const { tooltip, show: showTooltip, hide: hideTooltip } = useCollapsedTooltip();

  const worktreeHasTicket = useMemo(() => {
    const set = new Set<string>();
    for (const ticket of tickets) {
      for (const link of ticket.links) {
        if ((link as TicketLink).type === 'worktree') set.add((link as TicketLink).ref);
      }
    }
    return set;
  }, [tickets]);

  const systemSessions: Session[] = useMemo(() => {
    const ungrouped = sessionGroups.find((g) => isSystemGroup(g.repositoryOrg, g.repositoryName));
    if (!ungrouped) return [];
    return ungrouped.worktrees.flatMap((wt) => wt.sessions);
  }, [sessionGroups]);

  const sortedRepoGroups: SessionGroup[] = useMemo(() => {
    const repoGroups = sessionGroups.filter((g) => !isSystemGroup(g.repositoryOrg, g.repositoryName));
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
    const targetId = lastActive && sessions.some((s) => s.id === lastActive) ? lastActive : sessions[0]!.id;
    navigate(`/sessions/${targetId}`, { replace: true });
  };

  const systemStatus = useMemo(() => aggregateBranchStatus(systemSessions), [systemSessions]);
  const systemSelected = systemSessions.some((s) => s.id === selectedSessionId);

  return (
    <CollapsedShell>
      <div className="flex-1 overflow-y-auto w-full">
        {systemSessions.length > 0 && (
          <div className="my-1.5">
            <div className="relative flex w-full items-center gap-1.5 px-4 py-2">
              <div className="invisible flex w-full items-center gap-1.5">
                <svg width="10" height="10" viewBox="0 0 10 10"><path d="M3 1l5 4-5 4V1z" /></svg>
                <span className="text-[11px] font-bold uppercase tracking-wider">&nbsp;</span>
              </div>
              <div className="absolute inset-x-4 top-1/2 h-px bg-[var(--theme-border)]" />
            </div>
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

        {sortedRepoGroups.map((group) => {
          const groupId = `${group.repositoryOrg}/${group.repositoryName}`;
          const isGroupCollapsed = collapsedGroups.has(groupId);

          return (
            <div key={groupId} className="my-1.5">
              <div className="relative flex w-full items-center gap-1.5 px-4 py-2">
                <div className="invisible flex w-full items-center gap-1.5">
                  <svg width="10" height="10" viewBox="0 0 10 10"><path d="M3 1l5 4-5 4V1z" /></svg>
                  <span className="text-[11px] font-bold uppercase tracking-wider">&nbsp;</span>
                  <span className="ml-auto flex items-center gap-1"><svg width="14" height="14" /><svg width="14" height="14" /></span>
                </div>
                <div className="absolute inset-x-4 top-1/2 h-px bg-[var(--theme-border)]" />
              </div>

              {!isGroupCollapsed &&
                (() => {
                  const wtOrder = worktreeOrder[groupId];
                  const sorted = wtOrder && wtOrder.length > 0
                    ? [...group.worktrees].sort((a, b) => {
                        const orderMap = new Map(wtOrder.map((id, i) => [id, i]));
                        return (orderMap.get(a.branch) ?? Infinity) - (orderMap.get(b.branch) ?? Infinity);
                      })
                    : [...group.worktrees].sort((a, b) => a.branch.toLowerCase().localeCompare(b.branch.toLowerCase()));

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
    </CollapsedShell>
  );
}

// ═══════════════════════════════════════════════
// ── 2. Collapsed Repositories panel ──
// ═══════════════════════════════════════════════

function CollapsedRepositoriesPanel() {
  const navigate = useNavigate();
  const summaries = useRepositoryDashboardStore((s) => s.summaries);
  const selectedRepoKey = useUIStore((s) => s.selectedRepoKey);
  const collapsedGroups = useUIStore((s) => s.collapsedGroups);
  const { tooltip, show: showTooltip, hide: hideTooltip } = useCollapsedTooltip();

  const orgGroups = useMemo(() => {
    const groups = new Map<string, RepositorySummary[]>();
    for (const summary of Object.values(summaries)) {
      const existing = groups.get(summary.org) ?? [];
      existing.push(summary);
      groups.set(summary.org, existing);
    }
    for (const [, repos] of groups) repos.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    return [...groups.entries()].sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()));
  }, [summaries]);

  return (
    <CollapsedShell>
      <div className="flex-1 overflow-y-auto w-full">
        {orgGroups.length === 0 ? (
          <div className="flex items-center justify-center py-6">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[var(--theme-text-faint)]">
              <rect x="2" y="10" width="12" height="2.5" rx="0.5" /><rect x="3" y="6" width="10" height="2.5" rx="0.5" /><rect x="1.5" y="2" width="13" height="2.5" rx="0.5" />
            </svg>
          </div>
        ) : orgGroups.map(([org, repos]) => {
          const orgGroupId = `org:${org}`;
          const isOrgCollapsed = collapsedGroups.has(orgGroupId);

          return (
            <div key={org} className="my-1.5">
              <CollapsedSeparator />
              {!isOrgCollapsed && repos.map((repo) => {
                const key = `${repo.org}/${repo.name}`;
                const isSelected = selectedRepoKey === key;
                const initials = nameToInitials(repo.name);
                return (
                  <CollapsedRow
                    key={key}
                    isSelected={isSelected}
                    onClick={() => navigate(`/repositories/${key}`, { replace: true })}
                    onMouseEnter={(e) => showTooltip(e, repo.name, org)}
                    onMouseLeave={hideTooltip}
                    icon={
                      <span className={cn(
                        'text-[10px] font-bold leading-none',
                        isSelected ? 'text-[var(--theme-text-primary)]' : 'text-[var(--theme-text-muted)]',
                      )}>
                        {initials}
                      </span>
                    }
                  />
                );
              })}
            </div>
          );
        })}
      </div>
      <CollapsedTooltip data={tooltip} />
    </CollapsedShell>
  );
}

// ═══════════════════════════════════════════════
// ── 3. Collapsed Tickets panel ──
// ═══════════════════════════════════════════════

const TICKET_STATUS_COLORS: Record<string, string> = {
  backlog: 'bg-[var(--theme-text-faint)]',
  todo: 'bg-blue-400',
  doing: 'bg-amber-400',
  reviewing: 'bg-purple-400',
  done: 'bg-green-400',
};

function CollapsedTicketsPanel() {
  const rawBoards = useTicketStore((s) => s.boards);
  const boards = useMemo(() => [...rawBoards].sort((a, b) => a.name.localeCompare(b.name)), [rawBoards]);
  const selectedBoardId = useTicketStore((s) => s.selectedBoardId);
  const selectBoard = useTicketStore((s) => s.selectBoard);
  const ticketsByColumn = useTicketStore((s) => s.ticketsByColumn);
  const filters = useTicketStore((s) => s.filters);
  const { tooltip, show: showTooltip, hide: hideTooltip } = useCollapsedTooltip();

  const columns = ticketsByColumn(selectedBoardId);
  const activeFilterCount =
    (filters.repo ? 1 : 0) +
    (filters.priority ? 1 : 0) +
    (filters.hasSession !== null ? 1 : 0) +
    (filters.tag ? 1 : 0) +
    (filters.favorite !== null ? 1 : 0);

  return (
    <CollapsedShell>
      <div className="flex-1 overflow-y-auto w-full">
        {/* Boards */}
        {boards.map((board) => {
          const isSelected = selectedBoardId === board.id || (selectedBoardId === null && boards.length === 1);
          return (
            <CollapsedRow
              key={board.id}
              isSelected={isSelected}
              onClick={() => selectBoard(board.id)}
              onMouseEnter={(e) => showTooltip(e, `${board.emoji} ${board.name}`, 'Board')}
              onMouseLeave={hideTooltip}
              icon={
                <span className="text-sm">{board.emoji || '📋'}</span>
              }
            />
          );
        })}

        {boards.length > 0 && <CollapsedSeparator />}

        {/* Status column counts */}
        {(['backlog', 'todo', 'doing', 'reviewing', 'done'] as const).map((status) => {
          const count = columns[status]?.length ?? 0;
          if (count === 0) return null;
          return (
            <div
              key={status}
              className="flex w-full items-center justify-center gap-1.5 py-1.5"
              onMouseEnter={(e) => {
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                // manual show since we use onMouseEnter on div not button
                showTooltip(e, status.charAt(0).toUpperCase() + status.slice(1), `${count} ticket${count !== 1 ? 's' : ''}`);
              }}
              onMouseLeave={hideTooltip}
            >
              <span className={cn('h-2 w-2 rounded-full', TICKET_STATUS_COLORS[status])} />
              <span className="text-[10px] font-medium tabular-nums text-[var(--theme-text-muted)]">{count}</span>
            </div>
          );
        })}

        {/* Active filter indicator */}
        {activeFilterCount > 0 && (
          <>
            <CollapsedSeparator />
            <div
              className="flex w-full items-center justify-center py-2"
              onMouseEnter={(e) => showTooltip(e, 'Filters active', `${activeFilterCount} filter${activeFilterCount !== 1 ? 's' : ''}`)}
              onMouseLeave={hideTooltip}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--theme-accent)]">
                <path d="M1.5 2.5h13l-5 6v4l-3 1.5v-5.5l-5-6z" />
              </svg>
            </div>
          </>
        )}
      </div>
      <CollapsedTooltip data={tooltip} />
    </CollapsedShell>
  );
}

// ═══════════════════════════════════════════════
// ── 4. Collapsed Claude Config panel ──
// ═══════════════════════════════════════════════

function CollapsedClaudeConfigPanel() {
  const tree = useClaudeConfigStore((s) => s.tree);
  const selectedFile = useClaudeConfigStore((s) => s.selectedFile);
  const selectFile = useClaudeConfigStore((s) => s.selectFile);
  const { tooltip, show: showTooltip, hide: hideTooltip } = useCollapsedTooltip();

  // Flatten tree to top-level entries
  const items = useMemo(() => {
    const flat: { path: string; name: string; isDir: boolean }[] = [];
    for (const entry of tree) {
      flat.push({ path: entry.relativePath, name: entry.name, isDir: entry.isDirectory });
    }
    return flat;
  }, [tree]);

  return (
    <CollapsedShell>
      <div className="flex-1 overflow-y-auto w-full">
        {items.length === 0 ? (
          <div className="flex items-center justify-center py-6">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[var(--theme-text-faint)]">
              <path d="M9 1.5H4.5A1.5 1.5 0 0 0 3 3v10a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 13V5.5L9 1.5z" />
              <polyline points="9,1.5 9,5.5 13,5.5" />
            </svg>
          </div>
        ) : items.map((item) => {
          const isSelected = selectedFile === item.path;
          return (
            <CollapsedRow
              key={item.path}
              isSelected={isSelected}
              onClick={() => { if (!item.isDir) selectFile(item.path); }}
              onMouseEnter={(e) => showTooltip(e, item.name, item.isDir ? 'Directory' : 'File')}
              onMouseLeave={hideTooltip}
              icon={
                item.isDir ? (
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className={isSelected ? 'text-[var(--theme-text-primary)]' : 'text-[var(--theme-text-faint)]'}>
                    <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75z" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={isSelected ? 'text-[var(--theme-text-primary)]' : 'text-[var(--theme-text-faint)]'}>
                    <path d="M9 1.5H4.5A1.5 1.5 0 0 0 3 3v10a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 13V5.5L9 1.5z" />
                    <polyline points="9,1.5 9,5.5 13,5.5" />
                  </svg>
                )
              }
            />
          );
        })}
      </div>
      <CollapsedTooltip data={tooltip} />
    </CollapsedShell>
  );
}

// ═══════════════════════════════════════════════
// ── 5. Collapsed Agents panel ──
// ═══════════════════════════════════════════════

function CollapsedAgentsPanel() {
  const navigate = useNavigate();
  const personas = useAgentPersonaStore((s) => s.personas);
  const selectedPersonaId = useAgentPersonaStore((s) => s.selectedPersonaId);
  const executionStatuses = useAgentPersonaStore((s) => s.executionStatuses);
  const { tooltip, show: showTooltip, hide: hideTooltip } = useCollapsedTooltip();

  return (
    <CollapsedShell>
      <div className="flex-1 overflow-y-auto w-full">
        {personas.length === 0 ? (
          <div className="flex items-center justify-center py-6">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[var(--theme-text-faint)]">
              <circle cx="8" cy="5" r="3" /><path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6" />
            </svg>
          </div>
        ) : personas.map((persona) => {
          const isSelected = selectedPersonaId === persona.id;
          const status = executionStatuses[persona.id];
          const isRunning = status?.running ?? false;
          const initials = nameToInitials(persona.displayName);
          return (
            <CollapsedRow
              key={persona.id}
              isSelected={isSelected}
              onClick={() => navigate(`/agents/${persona.id}`, { replace: true })}
              onMouseEnter={(e) => showTooltip(e, persona.displayName, isRunning ? 'Running' : 'Agent')}
              onMouseLeave={hideTooltip}
              icon={
                <span className={cn(
                  'relative text-[10px] font-bold leading-none',
                  isSelected ? 'text-[var(--theme-text-primary)]' : 'text-[var(--theme-text-muted)]',
                )}>
                  {initials}
                  {isRunning && (
                    <span className="absolute -right-1 -top-1 h-1.5 w-1.5 animate-pulse rounded-full bg-yellow-400" />
                  )}
                </span>
              }
            />
          );
        })}
      </div>
      <CollapsedTooltip data={tooltip} />
    </CollapsedShell>
  );
}

// ═══════════════════════════════════════════════
// ── 6. Collapsed Scratchpads panel ──
// ═══════════════════════════════════════════════

function CollapsedScratchpadsPanel() {
  const navigate = useNavigate();
  const scratchpadList = useScratchpadStore((s) => s.scratchpadList);
  const selectedScratchpadKey = useScratchpadStore((s) => s.selectedScratchpadKey);
  const collapsedGroups = useUIStore((s) => s.collapsedGroups);
  const { tooltip, show: showTooltip, hide: hideTooltip } = useCollapsedTooltip();

  const handleSelect = (key: string) => {
    if (key === '__global__') {
      navigate('/scratchpads/global', { replace: true });
    } else {
      navigate(`/scratchpads/${key}`, { replace: true });
    }
  };

  const { globalItem, orgGroups } = useMemo(() => {
    let globalItem: (typeof scratchpadList)[number] | null = null;
    const byOrg = new Map<string, (typeof scratchpadList)[number][]>();

    for (const item of scratchpadList) {
      if (item.key === '__global__') {
        globalItem = item;
        continue;
      }
      const slashIdx = item.key.indexOf('/');
      if (slashIdx > 0) {
        const org = item.key.substring(0, slashIdx);
        const existing = byOrg.get(org) ?? [];
        existing.push(item);
        byOrg.set(org, existing);
      }
    }

    for (const [, items] of byOrg) items.sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()));
    const orgGroups = [...byOrg.entries()].sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()));

    return { globalItem, orgGroups };
  }, [scratchpadList]);

  return (
    <CollapsedShell>
      <div className="flex-1 overflow-y-auto w-full">
        {scratchpadList.length === 0 ? (
          <div className="flex items-center justify-center py-6">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[var(--theme-text-faint)]">
              <path d="M3 2.5A1.5 1.5 0 014.5 1h7A1.5 1.5 0 0113 2.5v11a1.5 1.5 0 01-1.5 1.5h-7A1.5 1.5 0 013 13.5v-11z" />
              <path d="M5.5 5h5M5.5 7.5h5M5.5 10h3" strokeWidth="1" strokeLinecap="round" />
            </svg>
          </div>
        ) : (
          <>
            {globalItem && (() => {
              const isSelected = selectedScratchpadKey === globalItem.key;
              return (
                <CollapsedRow
                  key={globalItem.key}
                  isSelected={isSelected}
                  onClick={() => handleSelect(globalItem.key)}
                  onMouseEnter={(e) => showTooltip(e, globalItem.label, `${globalItem.lineCount} line${globalItem.lineCount !== 1 ? 's' : ''}`)}
                  onMouseLeave={hideTooltip}
                  icon={
                    <span className={cn(
                      'text-[10px] font-bold leading-none',
                      isSelected ? 'text-[var(--theme-text-primary)]' : 'text-[var(--theme-text-muted)]',
                    )}>
                      G
                    </span>
                  }
                />
              );
            })()}
            {orgGroups.map(([org, items]) => {
              const orgGroupId = `scratchpad-org:${org}`;
              const isOrgCollapsed = collapsedGroups.has(orgGroupId);

              return (
                <div key={org} className="my-1.5">
                  <CollapsedSeparator />
                  {!isOrgCollapsed && items.map((item) => {
                    const isSelected = selectedScratchpadKey === item.key;
                    const repoName = item.key.substring(item.key.indexOf('/') + 1);
                    const initials = nameToInitials(repoName);
                    return (
                      <CollapsedRow
                        key={item.key}
                        isSelected={isSelected}
                        onClick={() => handleSelect(item.key)}
                        onMouseEnter={(e) => showTooltip(e, repoName, org)}
                        onMouseLeave={hideTooltip}
                        icon={
                          <span className={cn(
                            'text-[10px] font-bold leading-none',
                            isSelected ? 'text-[var(--theme-text-primary)]' : 'text-[var(--theme-text-muted)]',
                          )}>
                            {initials}
                          </span>
                        }
                      />
                    );
                  })}
                </div>
              );
            })}
          </>
        )}
      </div>
      <CollapsedTooltip data={tooltip} />
    </CollapsedShell>
  );
}

// ═══════════════════════════════════════════════
// ── 7. Collapsed Settings panel ──
// ═══════════════════════════════════════════════

const SETTINGS_TABS: { key: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { key: 'general', label: 'General', icon: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  )},
  { key: 'appearance', label: 'Appearance', icon: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="13.5" cy="6.5" r="1.5" fill="currentColor" stroke="none" /><circle cx="17.5" cy="10.5" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="7.5" r="1.5" fill="currentColor" stroke="none" /><circle cx="6.5" cy="12.5" r="1.5" fill="currentColor" stroke="none" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
    </svg>
  )},
  { key: 'repositories', label: 'Repositories', icon: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  )},
  { key: 'pinned-icons', label: 'Pinned Icons', icon: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="17" x2="12" y2="22" />
      <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
    </svg>
  )},
  { key: 'worktree-actions', label: 'Worktree Actions', icon: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  )},
  { key: 'agent-tokens', label: 'Agent Tokens', icon: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  )},
  { key: 'gateways', label: 'Gateways', icon: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="8" rx="2" ry="2" /><rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
      <line x1="6" y1="6" x2="6.01" y2="6" /><line x1="6" y1="18" x2="6.01" y2="18" />
    </svg>
  )},
];

function CollapsedSettingsPanel() {
  const navigate = useNavigate();
  const settingsTab = useUIStore((s) => s.settingsTab);
  const { tooltip, show: showTooltip, hide: hideTooltip } = useCollapsedTooltip();

  return (
    <CollapsedShell>
      <div className="flex-1 overflow-y-auto w-full pt-1">
        {SETTINGS_TABS.map((tab) => {
          const isSelected = settingsTab === tab.key;
          return (
            <CollapsedRow
              key={tab.key}
              isSelected={isSelected}
              onClick={() => navigate(`/settings/${tab.key}`, { replace: true })}
              onMouseEnter={(e) => showTooltip(e, tab.label, 'Settings')}
              onMouseLeave={hideTooltip}
              icon={
                <span className={isSelected ? 'text-[var(--theme-text-primary)]' : 'text-[var(--theme-text-faint)]'}>
                  {tab.icon}
                </span>
              }
            />
          );
        })}
      </div>
      <CollapsedTooltip data={tooltip} />
    </CollapsedShell>
  );
}

