import { useState, useCallback, useMemo, useRef } from 'react';
import type { Session, SessionGroup, WorktreeSessionGroup } from '@fleex/shared';
import { worktreeFlow } from '../../lib/sessionFlow';
import { useSessionStore } from '../../stores/sessionStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';
import { RepositoryGroup, type FlowType } from './RepositoryGroup';
import { SystemGroup } from './SystemGroup';
import { GroupedSessions } from './GroupedSessions';
import { PlusIcon } from './icons';
import { HotkeyBadge } from '../ui/HotkeyBadge';

function isSystemGroup(org: string, name: string): boolean {
  return org === '_ungrouped' && name === '_ungrouped';
}

function isMultiRepoGroup(org: string): boolean {
  return org === '_multi-repo';
}

/**
 * Split repo groups into three buckets, keyed on the worktree's `agentWorktree`
 * (present only for ticket-driven worktrees):
 * - manual:  active ticket (doing/reviewing) with ≥1 live tmux session
 * - agentic: active ticket with no live tmux session (phantom worktree)
 * - done:    non-active ticket (done/cancelled/…) that still owns a live tmux session.
 *            The backend never emits a phantom for these, so they vanish once their
 *            last session closes. Orphan shells (no ticket) live under System > Shells.
 */
function partitionByFlow(groups: SessionGroup[]): {
  manualGroups: SessionGroup[];
  agenticGroups: SessionGroup[];
  doneGroups: SessionGroup[];
  manualWorktreeCount: number;
  agenticWorktreeCount: number;
  doneWorktreeCount: number;
} {
  const manualGroups: SessionGroup[] = [];
  const agenticGroups: SessionGroup[] = [];
  const doneGroups: SessionGroup[] = [];
  let manualWorktreeCount = 0;
  let agenticWorktreeCount = 0;
  let doneWorktreeCount = 0;

  for (const group of groups) {
    const manualWorktrees = group.worktrees.filter((wt: WorktreeSessionGroup) => worktreeFlow(wt) === 'manual');
    const agenticWorktrees = group.worktrees.filter((wt: WorktreeSessionGroup) => worktreeFlow(wt) === 'agentic');
    const doneWorktrees = group.worktrees.filter((wt: WorktreeSessionGroup) => worktreeFlow(wt) === 'done');

    if (manualWorktrees.length > 0) {
      manualGroups.push({ ...group, worktrees: manualWorktrees });
      manualWorktreeCount += manualWorktrees.length;
    }
    if (agenticWorktrees.length > 0) {
      agenticGroups.push({ ...group, worktrees: agenticWorktrees });
      agenticWorktreeCount += agenticWorktrees.length;
    }
    if (doneWorktrees.length > 0) {
      doneGroups.push({ ...group, worktrees: doneWorktrees });
      doneWorktreeCount += doneWorktrees.length;
    }
  }

  return {
    manualGroups,
    agenticGroups,
    doneGroups,
    manualWorktreeCount,
    agenticWorktreeCount,
    doneWorktreeCount,
  };
}

function SectionDivider({ label, count, collapsed, onToggle }: {
  label: string;
  count?: number;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  return (
    <button
      className="flex w-full items-center gap-2 px-4 py-1.5 mt-2 mb-0.5 cursor-pointer group"
      onClick={onToggle}
    >
      <div className="h-px flex-1 bg-[var(--theme-border)]" />
      <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)] group-hover:text-[var(--theme-text-secondary)] transition-colors">
        {collapsed !== undefined && (
          <svg
            width="8"
            height="8"
            viewBox="0 0 10 10"
            fill="currentColor"
            className={`transition-transform ${collapsed ? 'rotate-0' : 'rotate-90'}`}
          >
            <path d="M3 1l5 4-5 4V1z" />
          </svg>
        )}
        {label}
        {count != null && count > 0 && (
          <span className="text-[var(--theme-text-muted)]">({count})</span>
        )}
      </span>
      <div className="h-px flex-1 bg-[var(--theme-border)]" />
    </button>
  );
}

function sortGroups(groups: SessionGroup[], repoOrder: string[]): SessionGroup[] {
  if (repoOrder.length === 0) return groups;
  const orderMap = new Map(repoOrder.map((id, i) => [id, i]));
  return [...groups].sort((a, b) => {
    const aId = `${a.repositoryOrg}/${a.repositoryName}`;
    const bId = `${b.repositoryOrg}/${b.repositoryName}`;
    const aOrder = orderMap.get(aId) ?? Infinity;
    const bOrder = orderMap.get(bId) ?? Infinity;
    return aOrder - bOrder;
  });
}

export function SessionGroups() {
  const sessionGroups = useSessionStore((s) => s.sessionGroups);
  const repoOrder = useSettingsStore((s) => s.settings.repoOrder);
  const setRepoOrder = useSettingsStore((s) => s.setRepoOrder);
  const openCreateModal = useUIStore((s) => s.openCreateModal);
  const manualFlowCollapsed = useUIStore((s) => s.manualFlowCollapsed);
  const toggleManualFlow = useUIStore((s) => s.toggleManualFlow);
  const agenticFlowCollapsed = useUIStore((s) => s.agenticFlowCollapsed);
  const toggleAgenticFlow = useUIStore((s) => s.toggleAgenticFlow);
  const doneFlowCollapsed = useUIStore((s) => s.doneFlowCollapsed);
  const toggleDoneFlow = useUIStore((s) => s.toggleDoneFlow);

  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dropEdge, setDropEdge] = useState<'top' | 'bottom'>('bottom');
  const draggedIdRef = useRef<string | null>(null);

  // Extract system sessions (ungrouped) and repo groups separately
  const systemSessions: Session[] = useMemo(() => {
    const ungrouped = sessionGroups.find((g) =>
      isSystemGroup(g.repositoryOrg, g.repositoryName)
    );
    if (!ungrouped) return [];
    return ungrouped.worktrees.flatMap((wt: WorktreeSessionGroup) => wt.sessions);
  }, [sessionGroups]);

  const repoGroups = useMemo(() => {
    return sessionGroups.filter(
      (g) => !isSystemGroup(g.repositoryOrg, g.repositoryName)
    );
  }, [sessionGroups]);

  // Partition into manual / agentic / done flow
  const {
    manualGroups,
    agenticGroups,
    doneGroups,
    manualWorktreeCount,
    agenticWorktreeCount,
    doneWorktreeCount,
  } = useMemo(() => partitionByFlow(repoGroups), [repoGroups]);

  const sortedManualGroups = useMemo(
    () => sortGroups(manualGroups, repoOrder),
    [manualGroups, repoOrder]
  );

  const sortedAgenticGroups = useMemo(
    () => sortGroups(agenticGroups, repoOrder),
    [agenticGroups, repoOrder]
  );

  const sortedDoneGroups = useMemo(
    () => sortGroups(doneGroups, repoOrder),
    [doneGroups, repoOrder]
  );

  const handleDragStart = useCallback((groupId: string) => (e: React.DragEvent) => {
    draggedIdRef.current = groupId;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-repo-group', groupId);
    (e.currentTarget as HTMLElement).style.opacity = '0.4';
  }, []);

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    draggedIdRef.current = null;
    setDragOverId(null);
    (e.currentTarget as HTMLElement).style.opacity = '';
  }, []);

  const handleDragOver = useCallback((groupId: string) => (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/x-repo-group')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    setDropEdge(e.clientY < midY ? 'top' : 'bottom');
    setDragOverId(groupId);
  }, []);

  const handleDragLeave = useCallback((groupId: string) => (e: React.DragEvent) => {
    if ((e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) return;
    if (dragOverId === groupId) setDragOverId(null);
  }, [dragOverId]);

  const handleDrop = useCallback((targetId: string) => (e: React.DragEvent) => {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData('application/x-repo-group');
    setDragOverId(null);
    if (!draggedId || draggedId === targetId) return;

    const ids = sortedManualGroups.map((g) => `${g.repositoryOrg}/${g.repositoryName}`);
    const fromIdx = ids.indexOf(draggedId);
    if (fromIdx === -1) return;

    ids.splice(fromIdx, 1);
    let toIdx = ids.indexOf(targetId);
    if (toIdx === -1) return;
    if (dropEdge === 'bottom') toIdx += 1;
    ids.splice(toIdx, 0, draggedId);

    setRepoOrder(ids);
  }, [sortedManualGroups, dropEdge, setRepoOrder]);

  const renderRepoGroup = (group: SessionGroup, dimmed = false, flowType?: FlowType) => {
    const groupId = `${group.repositoryOrg}/${group.repositoryName}`;
    const isOver = dragOverId === groupId && draggedIdRef.current !== groupId;
    return (
      <div
        key={groupId}
        draggable={!dimmed}
        onDragStart={dimmed ? undefined : handleDragStart(groupId)}
        onDragEnd={dimmed ? undefined : handleDragEnd}
        onDragOver={dimmed ? undefined : handleDragOver(groupId)}
        onDragLeave={dimmed ? undefined : handleDragLeave(groupId)}
        onDrop={dimmed ? undefined : handleDrop(groupId)}
        className="relative"
      >
        {isOver && dropEdge === 'top' && (
          <div className="absolute left-1.5 right-1.5 top-0 z-10 h-0.5 rounded bg-[var(--theme-accent)]" />
        )}
        <RepositoryGroup group={group} flowType={flowType} />
        {isOver && dropEdge === 'bottom' && (
          <div className="absolute bottom-0 left-1.5 right-1.5 z-10 h-0.5 rounded bg-[var(--theme-accent)]" />
        )}
      </div>
    );
  };

  return (
    <div className="flex-1 overflow-y-auto">
      {/* System — shells not tied to any worktree */}
      <SectionDivider label="System" />
      <SystemGroup sessions={systemSessions} />

      {/* Manual Flow — worktrees with active tmux sessions */}
      {sortedManualGroups.length > 0 && (
        <>
          <SectionDivider
            label="Manual Flow"
            count={manualWorktreeCount}
            collapsed={manualFlowCollapsed}
            onToggle={toggleManualFlow}
          />
          {!manualFlowCollapsed && sortedManualGroups.map((g) => renderRepoGroup(g, false, 'manual'))}
        </>
      )}

      {/* Agentic Flow — worktrees with agent executions only, no tmux sessions */}
      {sortedAgenticGroups.length > 0 && (
        <>
          <SectionDivider
            label="Agentic Flow"
            count={agenticWorktreeCount}
            collapsed={agenticFlowCollapsed}
            onToggle={toggleAgenticFlow}
          />
          {!agenticFlowCollapsed && sortedAgenticGroups.map((g) => renderRepoGroup(g, true, 'agentic'))}
        </>
      )}

      {/* Done — finished tickets that still own live tmux sessions (kept until closed) */}
      {sortedDoneGroups.length > 0 && (
        <>
          <SectionDivider
            label="Done"
            count={doneWorktreeCount}
            collapsed={doneFlowCollapsed}
            onToggle={toggleDoneFlow}
          />
          {!doneFlowCollapsed && sortedDoneGroups.map((g) => renderRepoGroup(g, false, 'manual'))}
        </>
      )}

      {/* <GroupedSessions /> — hidden: feature is broken, to be reworked */}
      <button
        className="relative mx-1.5 mt-3 mb-1 flex w-[calc(100%-12px)] cursor-pointer items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white bg-[var(--theme-accent-muted)] transition-all hover:bg-[var(--theme-accent)] hover:shadow-[0_0_12px_var(--theme-accent-muted)]"
        onClick={openCreateModal}
      >
        <PlusIcon size={16} />
        New Task
        <HotkeyBadge hotkey="⇧⌘N" position="top-right" />
      </button>
    </div>
  );
}
