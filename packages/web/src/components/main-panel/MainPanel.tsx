import { useSessionStore } from '../../stores/sessionStore';
import { useUIStore } from '../../stores/uiStore';
import { SessionPane } from './SessionPane';
import { EmptyState } from './EmptyState';
import { SettingsPanel } from '../settings/SettingsPanel';
import { RepositoryDashboard } from '../repository-dashboard/RepositoryDashboard';
import { RepositoryEmptyState } from '../repository-dashboard/RepositoryEmptyState';
import { ClaudeConfigEditor } from '../claude-config/ClaudeConfigEditor';
import { ClusterDashboard } from '../cluster/ClusterDashboard';

export function MainPanel() {
  const activePanel = useUIStore((s) => s.activePanel);
  const selectedSessionId = useSessionStore((s) => s.selectedSessionId);
  const splitSessionId = useSessionStore((s) => s.splitSessionId);
  const focusedPane = useSessionStore((s) => s.focusedPane);
  const setFocusedPane = useSessionStore((s) => s.setFocusedPane);
  const sessions = useSessionStore((s) => s.sessions);

  const selectedSession = sessions.find((s) => s.id === selectedSessionId) ?? null;
  const selectedRepoKey = useUIStore((s) => s.selectedRepoKey);
  const splitSession = splitSessionId
    ? sessions.find((s) => s.id === splitSessionId) ?? null
    : null;

  if (activePanel === 'settings') {
    return <SettingsPanel />;
  }

  if (activePanel === 'claude-config') {
    return <ClaudeConfigEditor />;
  }

  if (activePanel === 'cluster') {
    return <ClusterDashboard />;
  }

  if (activePanel === 'repositories') {
    if (!selectedRepoKey) {
      return <RepositoryEmptyState />;
    }
    return <RepositoryDashboard repoKey={selectedRepoKey} />;
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
