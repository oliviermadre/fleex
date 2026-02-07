import { useSessionStore } from '../../stores/sessionStore';
import { useUIStore } from '../../stores/uiStore';
import { Button } from '../ui/Button';

export function SidebarHeader() {
  const sessions = useSessionStore((s) => s.sessions);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const openCreateModal = useUIStore((s) => s.openCreateModal);

  return (
    <div className="flex items-center justify-between border-b border-zinc-800 px-3" style={{ height: 'var(--header-height)' }}>
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-zinc-200">Sessions</span>
        <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
          {sessions.length}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={openCreateModal} title="New Session (Cmd+N)">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="8" y1="3" x2="8" y2="13" />
            <line x1="3" y1="8" x2="13" y2="8" />
          </svg>
        </Button>
        <Button variant="ghost" size="sm" onClick={toggleSidebar} title="Toggle Sidebar (Cmd+B)">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="1" y="2" width="14" height="12" rx="2" />
            <line x1="6" y1="2" x2="6" y2="14" />
          </svg>
        </Button>
      </div>
    </div>
  );
}
