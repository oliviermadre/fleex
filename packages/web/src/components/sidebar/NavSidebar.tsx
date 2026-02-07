import { useUIStore } from '../../stores/uiStore';
import { useSessionStore } from '../../stores/sessionStore';
import { cn } from '../../lib/cn';

export function NavSidebar() {
  const navCollapsed = useUIStore((s) => s.navCollapsed);
  const toggleNav = useUIStore((s) => s.toggleNav);
  const activePanel = useUIStore((s) => s.activePanel);
  const setActivePanel = useUIStore((s) => s.setActivePanel);
  const sessions = useSessionStore((s) => s.sessions);

  return (
    <div className="flex h-full flex-col border-r border-zinc-800 bg-zinc-950">
      <div className="flex flex-1 flex-col gap-0.5 pt-2">
        {/* Sessions */}
        <NavItem
          icon={
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
              <polyline points="4.5,7 6,8.5 4.5,10" />
              <line x1="7.5" y1="10.5" x2="11" y2="10.5" />
            </svg>
          }
          label="Sessions"
          active={activePanel === 'sessions'}
          collapsed={navCollapsed}
          badge={sessions.length > 0 ? (sessions.length > 9 ? '9+' : String(sessions.length)) : undefined}
          onClick={() => setActivePanel('sessions')}
        />

        {/* Settings */}
        <NavItem
          icon={
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="8" cy="8" r="2" />
              <path d="M6.5 1h3l.3 1.5c.4.2.8.4 1.1.7l1.5-.5 1.5 2.6-1.2 1c0 .2.05.45.05.7s-.02.5-.05.7l1.2 1-1.5 2.6-1.5-.5c-.3.3-.7.5-1.1.7L9.5 15h-3l-.3-1.5c-.4-.2-.8-.4-1.1-.7l-1.5.5-1.5-2.6 1.2-1c-.03-.2-.05-.45-.05-.7s.02-.5.05-.7l-1.2-1 1.5-2.6 1.5.5c.3-.3.7-.5 1.1-.7L6.5 1z" />
            </svg>
          }
          label="Settings"
          active={activePanel === 'settings'}
          collapsed={navCollapsed}
          onClick={() => setActivePanel('settings')}
        />
      </div>

      {/* Collapse/expand toggle */}
      <button
        className="flex items-center justify-center border-t border-zinc-800 py-2.5 text-zinc-500 transition-colors hover:bg-zinc-800/50 hover:text-zinc-300"
        onClick={toggleNav}
        title={navCollapsed ? 'Expand navigation (Cmd+B)' : 'Collapse navigation (Cmd+B)'}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn('transition-transform', navCollapsed ? '' : 'rotate-180')}
        >
          <polyline points="6,4 10,8 6,12" />
        </svg>
      </button>
    </div>
  );
}

function NavItem({
  icon,
  label,
  active,
  collapsed,
  badge,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  collapsed: boolean;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        'relative flex items-center gap-2.5 border-l-2 px-3 py-2 text-sm transition-colors',
        active
          ? 'border-[#D77655] bg-zinc-800/60 text-zinc-100'
          : 'border-transparent text-zinc-500 hover:bg-zinc-800/30 hover:text-zinc-300',
        collapsed ? 'justify-center' : ''
      )}
      onClick={onClick}
      title={collapsed ? label : undefined}
    >
      <span className="relative flex-shrink-0">
        {icon}
        {badge && collapsed && (
          <span className="absolute -right-1.5 -top-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#b85a3a] text-[8px] font-bold text-white">
            {badge}
          </span>
        )}
      </span>
      {!collapsed && (
        <>
          <span className="truncate">{label}</span>
          {badge && (
            <span className="ml-auto rounded-full bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
              {badge}
            </span>
          )}
        </>
      )}
    </button>
  );
}
