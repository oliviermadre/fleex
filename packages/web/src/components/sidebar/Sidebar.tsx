import { useUIStore } from '../../stores/uiStore';
import { SidebarHeader } from './SidebarHeader';
import { SessionGroups } from './SessionGroups';
import { CollapsedSidebar } from './CollapsedSidebar';
import { PinnedIconsBar } from './PinnedIcons';

export function Sidebar() {
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const openSettingsModal = useUIStore((s) => s.openSettingsModal);

  if (sidebarCollapsed) {
    return <CollapsedSidebar />;
  }

  return (
    <div className="flex h-full flex-col border-r border-zinc-800 bg-zinc-900/50">
      <SidebarHeader />
      <PinnedIconsBar />
      <SessionGroups />
      <button
        className="flex items-center gap-2 border-t border-zinc-800/50 px-4 py-2.5 text-sm text-zinc-500 transition-colors hover:bg-zinc-800/50 hover:text-zinc-300"
        onClick={openSettingsModal}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="8" cy="8" r="2" />
          <path d="M6.5 1h3l.3 1.5c.4.2.8.4 1.1.7l1.5-.5 1.5 2.6-1.2 1c0 .2.05.45.05.7s-.02.5-.05.7l1.2 1-1.5 2.6-1.5-.5c-.3.3-.7.5-1.1.7L9.5 15h-3l-.3-1.5c-.4-.2-.8-.4-1.1-.7l-1.5.5-1.5-2.6 1.2-1c-.03-.2-.05-.45-.05-.7s.02-.5.05-.7l-1.2-1 1.5-2.6 1.5.5c.3-.3.7-.5 1.1-.7L6.5 1z" />
        </svg>
        Settings
      </button>
    </div>
  );
}
