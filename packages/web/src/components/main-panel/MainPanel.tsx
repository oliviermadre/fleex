import { useState, useCallback, useMemo } from 'react';
import type { Session, SessionGroup } from '@asm/shared';
import { useSessionStore } from '../../stores/sessionStore';
import { useUIStore } from '../../stores/uiStore';
import { useSettingsStore } from '../../stores/settingsStore';
import type { SessionLayoutGroup } from '../../stores/settingsStore';
import { SessionPane } from './SessionPane';
import { EmptyState } from './EmptyState';
import { FloatingSessionHint } from './FloatingSessionHint';
import { TopToolbar } from './TopToolbar';
import { SettingsPanel } from '../settings/SettingsPanel';
import { RepositoryDashboard } from '../repository-dashboard/RepositoryDashboard';
import { RepositoryEmptyState } from '../repository-dashboard/RepositoryEmptyState';
import { ClaudeConfigEditor } from '../claude-config/ClaudeConfigEditor';
import { ClusterDashboard } from '../cluster/ClusterDashboard';
import { ScratchpadMainView } from '../scratchpad/ScratchpadMainView';
import { ScratchpadEmptyState } from '../scratchpad/ScratchpadEmptyState';
import { useScratchpadStore } from '../../stores/scratchpadStore';
import { KanbanBoard } from '../tickets/KanbanBoard';
import { TicketDetail } from '../tickets/TicketDetail';
import { useTicketStore } from '../../stores/ticketStore';
import { AgentPersonaView } from '../agents/AgentPersonaView';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';
import { AgentWorktreePanel } from './AgentWorktreePanel';
import { CellAssignDropdown } from '../ui/CellAssignDropdown';

interface OpenDropdown {
  groupId: string;
  cellIndex: number;
  currentWorktreeKey: string | null;
  rect: DOMRect;
}

/** Return all sessions belonging to a worktree key, in order. */
function getWorktreeSessions(
  worktreeKey: string,
  sessions: Session[],
  sessionGroups: SessionGroup[],
): Session[] {
  if (worktreeKey === '_system') {
    const sysGroup = sessionGroups.find(
      (g) => g.repositoryOrg === '_ungrouped' && g.repositoryName === '_ungrouped'
    );
    return sysGroup?.worktrees.flatMap((wt) => wt.sessions) ?? [];
  }
  const colonIdx = worktreeKey.lastIndexOf(':');
  if (colonIdx === -1) return [];
  const branch = worktreeKey.substring(colonIdx + 1);
  const repoKey = worktreeKey.substring(0, colonIdx);
  const slashIdx = repoKey.indexOf('/');
  if (slashIdx === -1) return [];
  const org = repoKey.substring(0, slashIdx);
  const repo = repoKey.substring(slashIdx + 1);
  const group = sessionGroups.find(
    (g) => g.repositoryOrg === org && g.repositoryName === repo
  );
  return group?.worktrees.find((w) => w.branch === branch)?.sessions ?? [];
}

/**
 * Resolve the session a specific cell should display.
 *
 * Priority:
 * 1. The cell's own persisted active session (groupCellActiveSessions[key]) if it still exists
 *    in this worktree.
 * 2. The first session in the worktree NOT already claimed by another cell in the same group.
 * 3. The first session in the worktree (all are already claimed — user intentionally mirrored).
 *
 * Rule 2 prevents two cells from ever accidentally sharing the same sessionId, which would
 * cause xterm.js DOM conflicts and doubled input.
 */
function resolveGroupCellSession(
  groupId: string,
  cellIndex: number,
  worktreeKey: string | null,
  groupCellActiveSessions: Record<string, string>,
  sessions: Session[],
  sessionGroups: SessionGroup[],
): Session | null {
  if (!worktreeKey) return null;
  const wtSessions = getWorktreeSessions(worktreeKey, sessions, sessionGroups);
  if (wtSessions.length === 0) return null;

  // Use persisted per-cell session if it still exists in this worktree
  const persistedId = groupCellActiveSessions[`${groupId}:${cellIndex}`];
  if (persistedId) {
    const s = wtSessions.find((s) => s.id === persistedId);
    if (s) return s;
  }

  // No persisted value: default to first session for cell 0, second for cell 1, etc.
  return wtSessions[cellIndex % wtSessions.length] ?? wtSessions[0] ?? null;
}

function GroupEmptyCell({ onOpenAssign }: { onOpenAssign: (rect: DOMRect) => void }) {
  return (
    <button
      className="flex flex-1 flex-col items-center justify-center gap-2 bg-[var(--theme-bg-primary)] text-[var(--theme-text-faint)] hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-muted)] transition-colors cursor-pointer"
      onClick={(e) => onOpenAssign(e.currentTarget.getBoundingClientRect())}
      title="Click to assign a worktree"
    >
      <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <line x1="8" y1="3" x2="8" y2="13" />
        <line x1="3" y1="8" x2="13" y2="8" />
      </svg>
      <span className="text-xs">Assign worktree</span>
    </button>
  );
}

interface GroupCellProps {
  session: Session | null;
  worktreeKey: string | null;
  focused: boolean;
  onFocus: () => void;
  floatingSessionId: string | null;
  onOpenAssign: (rect: DOMRect) => void;
  onSessionChange: (sessionId: string) => void;
  terminalInstanceKey: string;
}

function GroupCell({ session, worktreeKey, focused, onFocus, floatingSessionId, onOpenAssign, onSessionChange, terminalInstanceKey }: GroupCellProps) {
  if (!worktreeKey || !session) {
    return <GroupEmptyCell onOpenAssign={onOpenAssign} />;
  }
  if (session.id === floatingSessionId) return <FloatingSessionHint session={session} />;

  return (
    <div className="group/cell relative flex flex-1 flex-col overflow-hidden">
      <button
        className="absolute top-1 right-1 z-10 opacity-0 group-hover/cell:opacity-100 flex items-center justify-center h-5 w-5 rounded bg-[var(--theme-bg-overlay)] border border-[var(--theme-border)] text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)] hover:border-[var(--theme-accent)] transition-all"
        title="Reassign or unassign worktree"
        onClick={(e) => { e.stopPropagation(); onOpenAssign(e.currentTarget.getBoundingClientRect()); }}
      >
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 6l4-4 4 4M12 10l-4 4-4-4" />
        </svg>
      </button>
      <SessionPane
        session={session}
        focused={focused}
        isSplit={true}
        onFocus={onFocus}
        onSessionChange={onSessionChange}
        hideToolbar={true}
        terminalInstanceKey={terminalInstanceKey}
      />
    </div>
  );
}

export function MainPanel() {
  const activePanel = useUIStore((s) => s.activePanel);
  const selectedSessionId = useSessionStore((s) => s.selectedSessionId);
  const splitSessionId = useSessionStore((s) => s.splitSessionId);
  const focusedPane = useSessionStore((s) => s.focusedPane);
  const setFocusedPane = useSessionStore((s) => s.setFocusedPane);
  const sessions = useSessionStore((s) => s.sessions);
  const sessionGroups = useSessionStore((s) => s.sessionGroups);
  const selectedGroupId = useSessionStore((s) => s.selectedGroupId);
  const activeGroupCellIndex = useSessionStore((s) => s.activeGroupCellIndex);
  const setActiveGroupCellIndex = useSessionStore((s) => s.setActiveGroupCellIndex);
  const groupCellActiveSessions = useSessionStore((s) => s.groupCellActiveSessions);
  const setGroupCellSession = useSessionStore((s) => s.setGroupCellSession);
  const layoutGroups = useSettingsStore((s) => s.settings.sessionLayoutGroups);

  const floatingSessionId = useUIStore((s) => s.floatingSessionId);
  const selectedAgentWorktreeTicketId = useUIStore((s) => s.selectedAgentWorktreeTicketId);
  const selectedSession = sessions.find((s) => s.id === selectedSessionId) ?? null;
  const selectedRepoKey = useUIStore((s) => s.selectedRepoKey);
  const selectedScratchpadKey = useScratchpadStore((s) => s.selectedScratchpadKey);
  const selectedTicketId = useTicketStore((s) => s.selectedTicketId);
  const splitSession = splitSessionId
    ? sessions.find((s) => s.id === splitSessionId) ?? null
    : null;

  const [openDropdown, setOpenDropdown] = useState<OpenDropdown | null>(null);

  // Resolve per-cell sessions unconditionally (hooks must not be inside conditionals)
  const activeGroup = selectedGroupId ? layoutGroups.find((g) => g.id === selectedGroupId) ?? null : null;
  const cellSessions = useMemo(() => {
    if (!activeGroup) return [];
    return activeGroup.cells.map((worktreeKey, idx) =>
      resolveGroupCellSession(
        selectedGroupId!, idx, worktreeKey,
        groupCellActiveSessions, sessions, sessionGroups
      )
    );
  }, [activeGroup, groupCellActiveSessions, sessions, sessionGroups, selectedGroupId]);

  const openAssign = useCallback(
    (groupId: string, cellIndex: number, currentWorktreeKey: string | null) => (rect: DOMRect) => {
      setOpenDropdown({ groupId, cellIndex, currentWorktreeKey, rect });
    },
    []
  );

  // Tab click inside a group cell: update only this cell, no cross-cell interference
  const handleGroupTabChange = useCallback(
    (cellIndex: number, newSessionId: string) => {
      if (!selectedGroupId) return;
      setGroupCellSession(selectedGroupId, cellIndex, newSessionId);
    },
    [selectedGroupId, setGroupCellSession]
  );

  if (activePanel === 'settings') return <SettingsPanel />;
  if (activePanel === 'claude-config') return <ClaudeConfigEditor />;
  if (activePanel === 'scratchpads') {
    if (!selectedScratchpadKey) return <ScratchpadEmptyState />;
    return <ScratchpadMainView scratchpadKey={selectedScratchpadKey} />;
  }

  if (activePanel === 'agents') {
    return <AgentPersonaView />;
  }

  if (activePanel === 'cluster') {
    return <ClusterDashboard />;
  }

  if (activePanel === 'tickets') {
    if (selectedTicketId) return <TicketDetail ticketId={selectedTicketId} />;
    return <KanbanBoard />;
  }
  if (activePanel === 'repositories') {
    if (!selectedRepoKey) return <RepositoryEmptyState />;
    return <RepositoryDashboard repoKey={selectedRepoKey} />;
  }

  // Agent worktree view (handles both executions and shell sessions)
  if (activePanel === 'sessions' && selectedAgentWorktreeTicketId) {
    return <AgentWorktreePanel ticketId={selectedAgentWorktreeTicketId} />;
  }

  // ── Grouped view ──────────────────────────────────────────────────────────
  if (selectedGroupId) {
    const group = layoutGroups.find((g) => g.id === selectedGroupId);
    if (group) {
      const focusedIdx = activeGroupCellIndex;
      const focusedSession = cellSessions[focusedIdx ?? 0] ?? null;
      const isSystemFocused = !focusedSession?.repositoryOrg || !focusedSession?.repositoryName;

      const renderCell = (idx: number) => (
        <GroupCell
          key={idx}
          session={cellSessions[idx] ?? null}
          worktreeKey={group.cells[idx] ?? null}
          focused={focusedIdx === null ? idx === 0 : focusedIdx === idx}
          onFocus={() => setActiveGroupCellIndex(idx)}
          floatingSessionId={floatingSessionId}
          onOpenAssign={openAssign(selectedGroupId, idx, group.cells[idx] ?? null)}
          onSessionChange={(sessionId) => handleGroupTabChange(idx, sessionId)}
          terminalInstanceKey={`${selectedGroupId}:${idx}`}
        />
      );

      const divV = <div className="w-px bg-[var(--theme-border)] shrink-0" />;
      const divH = <div className="h-px bg-[var(--theme-border)] shrink-0" />;

      const grid = group.type === '1x2' ? (
        <div className="flex flex-1 flex-row overflow-hidden">
          {renderCell(0)}{divV}{renderCell(1)}
        </div>
      ) : (
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex flex-1 flex-row overflow-hidden">
            {renderCell(0)}{divV}{renderCell(1)}
          </div>
          {divH}
          <div className="flex flex-1 flex-row overflow-hidden">
            {renderCell(2)}{divV}{renderCell(3)}
          </div>
        </div>
      );

      return (
        <div className="flex flex-1 flex-col overflow-hidden">
          <TopToolbar session={isSystemFocused ? undefined : (focusedSession ?? undefined)} />
          {grid}
          {openDropdown && (
            <CellAssignDropdown
              groupId={openDropdown.groupId}
              cellIndex={openDropdown.cellIndex}
              currentWorktreeKey={openDropdown.currentWorktreeKey}
              anchorRect={openDropdown.rect}
              onClose={() => setOpenDropdown(null)}
            />
          )}
        </div>
      );
    }
  }

  // ── Normal / split view ───────────────────────────────────────────────────
  if (!selectedSession) return <EmptyState />;
  if (selectedSession.id === floatingSessionId) return <FloatingSessionHint session={selectedSession} />;

  if (splitSession) {
    return (
      <div className="flex flex-1 flex-row overflow-hidden">
        {selectedSession.id === floatingSessionId ? (
          <FloatingSessionHint session={selectedSession} />
        ) : (
          <SessionPane session={selectedSession} focused={focusedPane === 'primary'} isSplit={true} onFocus={() => setFocusedPane('primary')} />
        )}
        <div className="w-px bg-[var(--theme-border)]" />
        {splitSession.id === floatingSessionId ? (
          <FloatingSessionHint session={splitSession} />
        ) : (
          <SessionPane session={splitSession} focused={focusedPane === 'split'} isSplit={true} onFocus={() => setFocusedPane('split')} />
        )}
      </div>
    );
  }

  return <SessionPane session={selectedSession} focused={true} isSplit={false} onFocus={() => {}} />;
}
