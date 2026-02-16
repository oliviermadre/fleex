import { useSessionStore } from '../../stores/sessionStore';
import { useUIStore } from '../../stores/uiStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { SessionPane } from './SessionPane';
import { EmptyState } from './EmptyState';
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

function GroupEmptyCell() {
  return (
    <div className="flex flex-1 items-center justify-center bg-[var(--theme-bg-primary)] text-[var(--theme-text-faint)]">
      <span className="text-xs">No session bound</span>
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
  const selectedGroupId = useSessionStore((s) => s.selectedGroupId);
  const activeGroupCellIndex = useSessionStore((s) => s.activeGroupCellIndex);
  const setActiveGroupCellIndex = useSessionStore((s) => s.setActiveGroupCellIndex);
  const layoutGroups = useSettingsStore((s) => s.settings.sessionLayoutGroups);

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

  if (activePanel === 'cluster') {
    return <ClusterDashboard />;
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
            {cellSessions[0] ? (
              <SessionPane
                session={cellSessions[0]}
                focused={activeGroupCellIndex === null ? true : activeGroupCellIndex === 0}
                isSplit={true}
                onFocus={() => setActiveGroupCellIndex(0)}
              />
            ) : (
              <GroupEmptyCell />
            )}
            <div className="w-px bg-[var(--theme-border)]" />
            {cellSessions[1] ? (
              <SessionPane
                session={cellSessions[1]}
                focused={activeGroupCellIndex === null ? false : activeGroupCellIndex === 1}
                isSplit={true}
                onFocus={() => setActiveGroupCellIndex(1)}
              />
            ) : (
              <GroupEmptyCell />
            )}
          </div>
        );
      }

      // 2x2
      return (
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex flex-1 flex-row overflow-hidden">
            {cellSessions[0] ? (
              <SessionPane
                session={cellSessions[0]}
                focused={activeGroupCellIndex === null ? false : activeGroupCellIndex === 0}
                isSplit={true}
                onFocus={() => setActiveGroupCellIndex(0)}
              />
            ) : (
              <GroupEmptyCell />
            )}
            <div className="w-px bg-[var(--theme-border)]" />
            {cellSessions[1] ? (
              <SessionPane
                session={cellSessions[1]}
                focused={activeGroupCellIndex === null ? false : activeGroupCellIndex === 1}
                isSplit={true}
                onFocus={() => setActiveGroupCellIndex(1)}
              />
            ) : (
              <GroupEmptyCell />
            )}
          </div>
          <div className="h-px bg-[var(--theme-border)]" />
          <div className="flex flex-1 flex-row overflow-hidden">
            {cellSessions[2] ? (
              <SessionPane
                session={cellSessions[2]}
                focused={activeGroupCellIndex === null ? false : activeGroupCellIndex === 2}
                isSplit={true}
                onFocus={() => setActiveGroupCellIndex(2)}
              />
            ) : (
              <GroupEmptyCell />
            )}
            <div className="w-px bg-[var(--theme-border)]" />
            {cellSessions[3] ? (
              <SessionPane
                session={cellSessions[3]}
                focused={activeGroupCellIndex === null ? false : activeGroupCellIndex === 3}
                isSplit={true}
                onFocus={() => setActiveGroupCellIndex(3)}
              />
            ) : (
              <GroupEmptyCell />
            )}
          </div>
        </div>
      );
    }
  }

  if (!selectedSession) {
    return <EmptyState />;
  }

  // Split view: two panes side by side
  if (splitSession) {
    return (
      <div className="flex flex-1 flex-row overflow-hidden">
        <SessionPane
          session={selectedSession}
          focused={focusedPane === 'primary'}
          isSplit={true}
          onFocus={() => setFocusedPane('primary')}
        />
        <div className="w-px bg-[var(--theme-border)]" />
        <SessionPane
          session={splitSession}
          focused={focusedPane === 'split'}
          isSplit={true}
          onFocus={() => setFocusedPane('split')}
        />
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
