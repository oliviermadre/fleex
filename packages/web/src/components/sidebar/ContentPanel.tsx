import { useUIStore } from '../../stores/uiStore';
import { SidebarHeader } from './SidebarHeader';
import { PinnedIconsBar } from './PinnedIcons';
import { SessionGroups } from './SessionGroups';
import { SettingsNav } from '../settings/SettingsNav';

export function ContentPanel() {
  const activePanel = useUIStore((s) => s.activePanel);

  return (
    <div className="flex h-full flex-col border-r border-[var(--theme-border)] bg-[var(--theme-bg-surface)]">
      {activePanel === 'sessions' && <SessionsContent />}
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
