import { useMemo, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { RepositorySummary } from '@fleex/shared';
import { TOOLTIP_HIDE_DELAY_MS } from '@fleex/shared';
import { useTooltip, FloatingPortal } from '../../hooks/usePopover';
import { useUIStore, type SettingsTab } from '../../stores/uiStore';
import { useTicketStore } from '../../stores/ticketStore';
import { useRepositoryDashboardStore } from '../../stores/repositoryDashboardStore';
import { useClaudeConfigStore } from '../../stores/claudeConfigStore';
import { useScratchpadStore } from '../../stores/scratchpadStore';
import { SettingsNav } from '../settings/SettingsNav';
import { AnalyticsNav } from '../analytics/AnalyticsNav';
import { RepositoriesContent } from './RepositoriesContent';
import { ClaudeConfigTree } from '../claude-config/ClaudeConfigTree';
import { ScratchpadsContent } from '../scratchpad/ScratchpadsContent';
import { TicketsContentPanel } from '../tickets/TicketsContentPanel';
import { AgentListPanel } from '../agents/AgentListPanel';
import { AssistantSidebar } from '../assistant/AssistantSidebar';
import { RoutinesContentPanel } from '../routines/RoutinesContentPanel';
import { describeTrigger } from '../routines/RoutineDetail';
import { useRoutineStore } from '../../stores/routineStore';
import { RoutineIcon } from '../../lib/primitives';
import { RepositoriesIcon } from './icons';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';
import { cn } from '../../lib/cn';
import { tintSolid } from '../../lib/tints';

export function ContentPanel() {
  const activePanel = useUIStore((s) => s.activePanel);
  const contentPanelCollapsed = useUIStore((s) => s.contentPanelCollapsed);

  if (contentPanelCollapsed) {
    if (activePanel === 'repositories') return <CollapsedRepositoriesPanel />;
    if (activePanel === 'tickets') return <CollapsedTicketsPanel />;
    if (activePanel === 'claude-config') return <CollapsedClaudeConfigPanel />;
    if (activePanel === 'agents') return <CollapsedAgentsPanel />;
    if (activePanel === 'scratchpads') return <CollapsedScratchpadsPanel />;
    if (activePanel === 'routines') return <CollapsedRoutinesPanel />;
    if (activePanel === 'analytics') return <CollapsedAnalyticsPanel />;
    if (activePanel === 'settings') return <CollapsedSettingsPanel />;
    // cluster or unknown — just show expand button
    return <CollapsedShell />;
  }

  return (
    <div className="flex h-full flex-col border-r border-[var(--theme-border)] bg-[var(--theme-bg-surface)]">
      {activePanel === 'repositories' && <RepositoriesContent />}
      {activePanel === 'tickets' && <TicketsContentPanel />}
      {activePanel === 'claude-config' && <ClaudeConfigTree />}
      {activePanel === 'agents' && <AgentListPanel />}
      {activePanel === 'cluster' && null}
      {activePanel === 'scratchpads' && <ScratchpadsContent />}
      {activePanel === 'routines' && <RoutinesContentPanel />}
      {activePanel === 'analytics' && <AnalyticsNav />}
      {activePanel === 'settings' && <SettingsNav />}
      {activePanel === 'assistant' && <AssistantSidebar />}
    </div>
  );
}

// ── Shared collapsed infrastructure ──

/** Tooltip content rendered to the right of a collapsed sidebar item. */
interface TooltipData {
  line1: string;
  line2: string;
}

type CollapsedTooltipApi = ReturnType<typeof useCollapsedTooltip>;

/** Floating-UI positioned tooltip rendered via portal, outside any overflow container */
function CollapsedTooltip({ ctl }: { ctl: CollapsedTooltipApi }) {
  const { tooltip, refs, floatingStyles, getFloatingProps } = ctl;
  if (!tooltip) return null;
  return (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        style={floatingStyles}
        {...getFloatingProps()}
        className="pointer-events-none z-[100]"
      >
        <div className="whitespace-nowrap rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-overlay)] px-3 py-2 shadow-xl">
          <div className="text-sm font-bold text-[var(--theme-text-primary)]">{tooltip.line1}</div>
          <div className="text-xs text-[var(--theme-text-muted)]">{tooltip.line2}</div>
        </div>
      </div>
    </FloatingPortal>
  );
}

function useCollapsedTooltip() {
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const hideTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Positioned to the RIGHT of the hovered row; flip/shift keep it on-screen.
  const { refs, floatingStyles, getFloatingProps } = useTooltip({ placement: 'right' });

  const show = useCallback((e: React.MouseEvent, line1: string, line2: string) => {
    clearTimeout(hideTimeout.current);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    refs.setPositionReference({ getBoundingClientRect: () => rect });
    setTooltip({ line1, line2 });
  }, [refs]);

  const hide = useCallback(() => {
    hideTimeout.current = setTimeout(() => setTooltip(null), TOOLTIP_HIDE_DELAY_MS);
  }, []);

  return { tooltip, show, hide, refs, floatingStyles, getFloatingProps } as const;
}

/** Expand button — header height, shared by all collapsed panels */
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
// ── 2. Collapsed Repositories panel ──
// ═══════════════════════════════════════════════

function CollapsedRepositoriesPanel() {
  const navigate = useNavigate();
  const summaries = useRepositoryDashboardStore((s) => s.summaries);
  const selectedRepoKey = useUIStore((s) => s.selectedRepoKey);
  const collapsedGroups = useUIStore((s) => s.collapsedGroups);
  const tooltipCtl = useCollapsedTooltip();
  const { show: showTooltip, hide: hideTooltip } = tooltipCtl;

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
            <RepositoriesIcon size={16} className="text-[var(--theme-text-faint)]" />
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
      <CollapsedTooltip ctl={tooltipCtl} />
    </CollapsedShell>
  );
}

// ═══════════════════════════════════════════════
// ── 3. Collapsed Tickets panel ──
// ═══════════════════════════════════════════════

const TICKET_STATUS_COLORS: Record<string, string> = {
  backlog: 'bg-[var(--theme-text-faint)]',
  todo: tintSolid('orange'),
  doing: tintSolid('blue'),
  reviewing: tintSolid('purple'),
  done: tintSolid('green'),
};

function CollapsedTicketsPanel() {
  const rawBoards = useTicketStore((s) => s.boards);
  const boards = useMemo(() => [...rawBoards].sort((a, b) => a.name.localeCompare(b.name)), [rawBoards]);
  const selectedBoardId = useTicketStore((s) => s.selectedBoardId);
  const selectBoard = useTicketStore((s) => s.selectBoard);
  const ticketsByColumn = useTicketStore((s) => s.ticketsByColumn);
  const filters = useTicketStore((s) => s.filters);
  const tooltipCtl = useCollapsedTooltip();
  const { show: showTooltip, hide: hideTooltip } = tooltipCtl;

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
      <CollapsedTooltip ctl={tooltipCtl} />
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
  const tooltipCtl = useCollapsedTooltip();
  const { show: showTooltip, hide: hideTooltip } = tooltipCtl;

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
      <CollapsedTooltip ctl={tooltipCtl} />
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
  const tooltipCtl = useCollapsedTooltip();
  const { show: showTooltip, hide: hideTooltip } = tooltipCtl;

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
                    <span className={cn('absolute -right-1 -top-1 h-1.5 w-1.5 animate-pulse rounded-full', tintSolid('yellow'))} />
                  )}
                </span>
              }
            />
          );
        })}
      </div>
      <CollapsedTooltip ctl={tooltipCtl} />
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
  const tooltipCtl = useCollapsedTooltip();
  const { show: showTooltip, hide: hideTooltip } = tooltipCtl;

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
      <CollapsedTooltip ctl={tooltipCtl} />
    </CollapsedShell>
  );
}

// ═══════════════════════════════════════════════
// ── Collapsed Routines panel ──
// ═══════════════════════════════════════════════

function CollapsedRoutinesPanel() {
  const routines = useRoutineStore((s) => s.routines);
  const selectedId = useRoutineStore((s) => s.selectedId);
  const select = useRoutineStore((s) => s.select);
  const tooltipCtl = useCollapsedTooltip();
  const { show: showTooltip, hide: hideTooltip } = tooltipCtl;

  return (
    <CollapsedShell>
      <div className="flex-1 overflow-y-auto w-full">
        {routines.length === 0 ? (
          <div className="flex items-center justify-center py-6">
            <RoutineIcon size={16} tinted={false} className="text-[var(--theme-text-faint)]" />
          </div>
        ) : routines.map((routine) => {
          const isSelected = selectedId === routine.id;
          return (
            <CollapsedRow
              key={routine.id}
              isSelected={isSelected}
              onClick={() => void select(routine.id)}
              onMouseEnter={(e) => showTooltip(e, routine.name, describeTrigger(routine.trigger))}
              onMouseLeave={hideTooltip}
              icon={
                <span className="relative">
                  <RoutineIcon
                    size={16}
                    tinted={false}
                    className={isSelected ? 'text-[var(--theme-text-primary)]' : 'text-[var(--theme-text-muted)]'}
                  />
                  {routine.awaitingAttention && (
                    <span className={cn('absolute -right-1 -top-1 h-1.5 w-1.5 animate-pulse rounded-full', tintSolid('yellow'))} />
                  )}
                </span>
              }
            />
          );
        })}
      </div>
      <CollapsedTooltip ctl={tooltipCtl} />
    </CollapsedShell>
  );
}

// ═══════════════════════════════════════════════
// ── 7. Collapsed Analytics panel ──
// ═══════════════════════════════════════════════

const ANALYTICS_TABS: { key: 'audit-trail' | 'statistics'; label: string; icon: React.ReactNode }[] = [
  { key: 'audit-trail', label: 'Audit Trail', icon: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  )},
  { key: 'statistics', label: 'Statistics', icon: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" /><path d="M7 16l4-8 4 4 4-6" />
    </svg>
  )},
];

function CollapsedAnalyticsPanel() {
  const navigate = useNavigate();
  const analyticsTab = useUIStore((s) => s.analyticsTab);
  const tooltipCtl = useCollapsedTooltip();
  const { show: showTooltip, hide: hideTooltip } = tooltipCtl;

  return (
    <CollapsedShell>
      <div className="flex-1 overflow-y-auto w-full pt-1">
        {ANALYTICS_TABS.map((tab) => {
          const isSelected = analyticsTab === tab.key;
          return (
            <CollapsedRow
              key={tab.key}
              isSelected={isSelected}
              onClick={() => navigate(`/analytics/${tab.key}`, { replace: true })}
              onMouseEnter={(e) => showTooltip(e, tab.label, 'Analytics')}
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
      <CollapsedTooltip ctl={tooltipCtl} />
    </CollapsedShell>
  );
}

// ═══════════════════════════════════════════════
// ── 8. Collapsed Settings panel ──
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
  { key: 'actions', label: 'Actions', icon: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
    </svg>
  )},
  { key: 'agent-tokens', label: 'Agent Tokens', icon: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  )},
  { key: 'deliverable-types', label: 'Deliverable Types', icon: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="9" y1="13" x2="15" y2="13" /><line x1="9" y1="17" x2="13" y2="17" />
    </svg>
  )},
  { key: 'connectors', label: 'Connectors', icon: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4" />
    </svg>
  )},
];

function CollapsedSettingsPanel() {
  const navigate = useNavigate();
  const settingsTab = useUIStore((s) => s.settingsTab);
  const tooltipCtl = useCollapsedTooltip();
  const { show: showTooltip, hide: hideTooltip } = tooltipCtl;

  return (
    <CollapsedShell>
      <div className="flex-1 overflow-y-auto w-full pt-1">
        {SETTINGS_TABS.map((tab) => {
          const isSelected = settingsTab === tab.key;
          return (
            <CollapsedRow
              key={tab.key}
              isSelected={isSelected}
              onClick={() => navigate(tab.key === 'actions' ? '/settings/actions/pinned' : `/settings/${tab.key}`, { replace: true })}
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
      <CollapsedTooltip ctl={tooltipCtl} />
    </CollapsedShell>
  );
}

