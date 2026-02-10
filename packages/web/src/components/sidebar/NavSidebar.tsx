import { useUIStore } from '../../stores/uiStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useRepositoryDashboardStore } from '../../stores/repositoryDashboardStore';
import { HotkeyBadge } from '../ui/HotkeyBadge';
import { cn } from '../../lib/cn';

export function NavSidebar() {
  const navCollapsed = useUIStore((s) => s.navCollapsed);
  const toggleNav = useUIStore((s) => s.toggleNav);
  const activePanel = useUIStore((s) => s.activePanel);
  const setActivePanel = useUIStore((s) => s.setActivePanel);
  const sessions = useSessionStore((s) => s.sessions);
  const summaries = useRepositoryDashboardStore((s) => s.summaries);
  const repoCount = Object.keys(summaries).length;

  return (
    <div className="flex h-full flex-col border-r border-[var(--theme-border)] bg-[var(--theme-bg-base)]">
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
          hotkey="⌥1"
          onClick={() => setActivePanel('sessions')}
        />

        {/* Repositories */}
        <NavItem
          icon={
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="5" cy="3.5" r="1.5" />
              <circle cx="11" cy="3.5" r="1.5" />
              <circle cx="8" cy="12.5" r="1.5" />
              <line x1="5" y1="5" x2="5" y2="7" />
              <line x1="11" y1="5" x2="11" y2="7" />
              <path d="M5 7c0 1.5 1.5 2.5 3 4M11 7c0 1.5-1.5 2.5-3 4" />
            </svg>
          }
          label="Repositories"
          active={activePanel === 'repositories'}
          collapsed={navCollapsed}
          badge={repoCount > 0 ? (repoCount > 9 ? '9+' : String(repoCount)) : undefined}
          hotkey="⌥2"
          onClick={() => setActivePanel('repositories')}
        />
        {/* Claude Config */}
        <NavItem
          icon={
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 1.5H4.5A1.5 1.5 0 0 0 3 3v10a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 13V5.5L9 1.5z" />
              <polyline points="9,1.5 9,5.5 13,5.5" />
              <line x1="5.5" y1="8.5" x2="10.5" y2="8.5" />
              <line x1="5.5" y1="11" x2="8.5" y2="11" />
            </svg>
          }
          label="Claude Config"
          active={activePanel === 'claude-config'}
          collapsed={navCollapsed}
          hotkey="⌥3"
          onClick={() => setActivePanel('claude-config')}
        />
      </div>

      {/* Settings - bottom of sidebar */}
      <div className="flex flex-col gap-0.5">
        <NavItem
          icon={
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6.86 1.45h2.28l.34 1.7a5.2 5.2 0 0 1 1.16.67l1.62-.54 1.14 1.97-1.28 1.08c.04.22.06.44.06.67s-.02.45-.06.67l1.28 1.08-1.14 1.97-1.62-.54c-.35.27-.74.5-1.16.67l-.34 1.7H6.86l-.34-1.7a5.2 5.2 0 0 1-1.16-.67l-1.62.54-1.14-1.97 1.28-1.08A4.3 4.3 0 0 1 3.82 8c0-.23.02-.45.06-.67L2.6 6.25l1.14-1.97 1.62.54c.35-.27.74-.5 1.16-.67l.34-1.7z" />
              <circle cx="8" cy="8" r="2" />
            </svg>
          }
          label="Settings"
          active={activePanel === 'settings'}
          collapsed={navCollapsed}
          hotkey="⌥4"
          onClick={() => setActivePanel('settings')}
        />
      </div>

      {/* Collapse/expand toggle */}
      <button
        className="flex items-center justify-center border-t border-[var(--theme-border)] py-2.5 text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]"
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
  hotkey,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  collapsed: boolean;
  badge?: string;
  hotkey?: string;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        'relative flex items-center gap-2.5 border-l-2 px-3 py-2 text-sm transition-colors',
        active
          ? 'border-[var(--theme-accent)] bg-[var(--theme-bg-hover)] text-[var(--theme-text-primary)]'
          : 'border-transparent text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]',
        collapsed ? 'justify-center' : ''
      )}
      onClick={onClick}
      title={collapsed ? label : undefined}
    >
      <span className="relative flex-shrink-0">
        {icon}
        {badge && collapsed && (
          <span className="absolute -right-1.5 -top-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[var(--theme-accent-active)] text-[8px] font-bold text-white">
            {badge}
          </span>
        )}
        {hotkey && <HotkeyBadge hotkey={hotkey} position="top-left" />}
      </span>
      {!collapsed && (
        <>
          <span className="truncate">{label}</span>
          {badge && (
            <span className="ml-auto rounded-full bg-[var(--theme-bg-overlay)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--theme-text-secondary)]">
              {badge}
            </span>
          )}
        </>
      )}
    </button>
  );
}
