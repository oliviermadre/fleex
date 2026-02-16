import { useUIStore } from '../../stores/uiStore';
import { SidebarHeader } from './SidebarHeader';
import { PinnedIconsBar } from './PinnedIcons';
import { SessionGroups } from './SessionGroups';
import { SettingsNav } from '../settings/SettingsNav';
import { RepositoriesContent } from './RepositoriesContent';
import { ClaudeConfigTree } from '../claude-config/ClaudeConfigTree';
import { ScratchpadsContent } from '../scratchpad/ScratchpadsContent';
import { TicketsContentPanel } from '../tickets/TicketsContentPanel';

export function ContentPanel() {
  const activePanel = useUIStore((s) => s.activePanel);

  return (
    <div className="flex h-full flex-col border-r border-[var(--theme-border)] bg-[var(--theme-bg-surface)]">
      {activePanel === 'sessions' && <SessionsContent />}
      {activePanel === 'repositories' && <RepositoriesContent />}
      {activePanel === 'tickets' && <TicketsContentPanel />}
      {activePanel === 'claude-config' && <ClaudeConfigTree />}
      {activePanel === 'cluster' && null}
      {activePanel === 'scratchpads' && <ScratchpadsContent />}
      {activePanel === 'settings' && <SettingsNav />}
    </div>
  );
}

function SessionsContent() {
  return (
    <>
      <SidebarHeader />
      <PinnedIconsBar />
      <SessionGroups />
    </>
  );
}
