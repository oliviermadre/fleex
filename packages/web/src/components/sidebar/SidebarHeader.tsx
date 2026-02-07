import { useSessionStore } from '../../stores/sessionStore';
import { useUIStore } from '../../stores/uiStore';
import { Button } from '../ui/Button';

export function SidebarHeader() {
  const sessions = useSessionStore((s) => s.sessions);
  const collapseSidebar = useUIStore((s) => s.collapseSidebar);

  return (
    <div className="flex items-center justify-between border-b border-zinc-800 px-4" style={{ height: 'var(--header-height)' }}>
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-zinc-200">Sessions</span>
        <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
          {sessions.length}
        </span>
      </div>
      <Button variant="ghost" size="sm" onClick={collapseSidebar} title="Collapse Sidebar (Cmd+B)">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
          <line x1="5.5" y1="2.5" x2="5.5" y2="13.5" />
          <polyline points="9.5,6 7.5,8 9.5,10" />
        </svg>
      </Button>
    </div>
  );
}
