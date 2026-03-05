import type { Session } from '@fleex/shared';
import { useSessionStore } from '../../stores/sessionStore';
import { useUIStore } from '../../stores/uiStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { SessionPane } from './SessionPane';
import { EmptyState } from './EmptyState';
import { FloatingSessionHint } from './FloatingSessionHint';
import { SettingsPanel } from '../settings/SettingsPanel';
import { RepositoryDashboard } from '../repository-dashboard/RepositoryDashboard';
import { RepositoryEmptyState } from '../repository-dashboard/RepositoryEmptyState';
import { ClaudeConfigEditor } from '../claude-config/ClaudeConfigEditor';
import { ScratchpadMainView } from '../scratchpad/ScratchpadMainView';
import { ScratchpadEmptyState } from '../scratchpad/ScratchpadEmptyState';
import { useScratchpadStore } from '../../stores/scratchpadStore';
import { KanbanBoard } from '../tickets/KanbanBoard';
import { TicketDetail } from '../tickets/TicketDetail';
import { useTicketStore } from '../../stores/ticketStore';
import { AgentPersonaView } from '../agents/AgentPersonaView';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';
import { AgentWorktreePanel } from './AgentWorktreePanel';

function GroupEmptyCell() {
  return (
    <div className="flex flex-1 items-center justify-center bg-[var(--theme-bg-primary)] text-[var(--theme-text-faint)]">
      <span className="text-xs">No session bound</span>
    </div>
  );
}

interface GroupCellProps {
  session: Session | null;
  focused: boolean;
  onFocus: () => void;
  floatingSessionId: string | null;
}

function GroupCell({ session, focused, onFocus, floatingSessionId }: GroupCellProps) {
  if (!session) return <GroupEmptyCell />;
  if (session.id === floatingSessionId) return <FloatingSessionHint session={session} />;
  return (
    <SessionPane
      session={session}
      focused={focused}
      isSplit={true}
      onFocus={onFocus}
    />
  );
}

export function MainPanel() {
  const activePanel = useUIStore((s) => s.activePanel);
  const selectedSessionId = useSessionStore((s) => s.selectedSessionId);
  const splitSessionId = useSessionStore((s) => s.splitSessionId);
  const focusedPane = useSessionStore((s) => s.focusedPane);
  const setFocusedPane = useSessionStore((s) => s.setFocusedPane);
  const sessions = useSessionStore((s) => s.sessions);
  const selectedGroupId = useSessionStore((s) => s.selectedGroupId);
  const activeGroupCellIndex = useSessionStore((s) => s.activeGroupCellIndex);
  const setActiveGroupCellIndex = useSessionStore((s) => s.setActiveGroupCellIndex);
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

  if (activePanel === 'settings') {
    return <SettingsPanel />;
  }

  if (activePanel === 'claude-config') {
    return <ClaudeConfigEditor />;
  }

  if (activePanel === 'scratchpads') {
    if (!selectedScratchpadKey) return <ScratchpadEmptyState />;
    return <ScratchpadMainView scratchpadKey={selectedScratchpadKey} />;
  }

  if (activePanel === 'agents') {
    return <AgentPersonaView />;
  }

  if (activePanel === 'tickets') {
    if (selectedTicketId) {
      return <TicketDetail ticketId={selectedTicketId} />;
    }
    return <KanbanBoard />;
  }

  if (activePanel === 'repositories') {
    if (!selectedRepoKey) {
      return <RepositoryEmptyState />;
    }
    return <RepositoryDashboard repoKey={selectedRepoKey} />;
  }

  // Agent worktree view (handles both executions and shell sessions)
  if (activePanel === 'sessions' && selectedAgentWorktreeTicketId) {
    return <AgentWorktreePanel ticketId={selectedAgentWorktreeTicketId} />;
  }

  // Grouped view
  if (selectedGroupId) {
    const group = layoutGroups.find((g) => g.id === selectedGroupId);
    if (group) {
      const cellSessions = group.cells.map(
        (cellId) => (cellId ? sessions.find((s) => s.id === cellId) ?? null : null)
      );

      if (group.type === '1x2') {
        return (
          <div className="flex flex-1 flex-row overflow-hidden">
            <GroupCell
              session={cellSessions[0] ?? null}
              focused={activeGroupCellIndex === null ? true : activeGroupCellIndex === 0}
              onFocus={() => setActiveGroupCellIndex(0)}
              floatingSessionId={floatingSessionId}
            />
            <div className="w-px bg-[var(--theme-border)]" />
            <GroupCell
              session={cellSessions[1] ?? null}
              focused={activeGroupCellIndex === null ? false : activeGroupCellIndex === 1}
              onFocus={() => setActiveGroupCellIndex(1)}
              floatingSessionId={floatingSessionId}
            />
          </div>
        );
      }

      // 2x2
      return (
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex flex-1 flex-row overflow-hidden">
            <GroupCell
              session={cellSessions[0] ?? null}
              focused={activeGroupCellIndex === null ? false : activeGroupCellIndex === 0}
              onFocus={() => setActiveGroupCellIndex(0)}
              floatingSessionId={floatingSessionId}
            />
            <div className="w-px bg-[var(--theme-border)]" />
            <GroupCell
              session={cellSessions[1] ?? null}
              focused={activeGroupCellIndex === null ? false : activeGroupCellIndex === 1}
              onFocus={() => setActiveGroupCellIndex(1)}
              floatingSessionId={floatingSessionId}
            />
          </div>
          <div className="h-px bg-[var(--theme-border)]" />
          <div className="flex flex-1 flex-row overflow-hidden">
            <GroupCell
              session={cellSessions[2] ?? null}
              focused={activeGroupCellIndex === null ? false : activeGroupCellIndex === 2}
              onFocus={() => setActiveGroupCellIndex(2)}
              floatingSessionId={floatingSessionId}
            />
            <div className="w-px bg-[var(--theme-border)]" />
            <GroupCell
              session={cellSessions[3] ?? null}
              focused={activeGroupCellIndex === null ? false : activeGroupCellIndex === 3}
              onFocus={() => setActiveGroupCellIndex(3)}
              floatingSessionId={floatingSessionId}
            />
          </div>
        </div>
      );
    }
  }

  if (!selectedSession) {
    return <EmptyState />;
  }

  // Guard: if the selected session is floating, show hint instead of the terminal
  // (avoids double xterm.js attach conflict — DOM node can only be in one container)
  if (selectedSession.id === floatingSessionId) {
    return <FloatingSessionHint session={selectedSession} />;
  }

  // Split view: two panes side by side
  if (splitSession) {
    return (
      <div className="flex flex-1 flex-row overflow-hidden">
        {selectedSession.id === floatingSessionId ? (
          <FloatingSessionHint session={selectedSession} />
        ) : (
          <SessionPane
            session={selectedSession}
            focused={focusedPane === 'primary'}
            isSplit={true}
            onFocus={() => setFocusedPane('primary')}
          />
        )}
        <div className="w-px bg-[var(--theme-border)]" />
        {splitSession.id === floatingSessionId ? (
          <FloatingSessionHint session={splitSession} />
        ) : (
          <SessionPane
            session={splitSession}
            focused={focusedPane === 'split'}
            isSplit={true}
            onFocus={() => setFocusedPane('split')}
          />
        )}
      </div>
    );
  }

  // Single pane view
  return (
    <SessionPane
      session={selectedSession}
      focused={true}
      isSplit={false}
      onFocus={() => {}}
    />
  );
}
