import { useNavigate } from 'react-router-dom';
import { useUIStore } from '../../stores/uiStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useRepositoryDashboardStore } from '../../stores/repositoryDashboardStore';
import { useTicketStore } from '../../stores/ticketStore';
import { useUnreadStore } from '../../stores/unreadStore';
import { useAgentEventStore } from '../../stores/agentEventStore';
import { cn } from '../../lib/cn';

function FleexLogo({ collapsed }: { collapsed: boolean }) {
  return (
    <div className={cn(
      'flex items-center border-b border-[var(--theme-border)] px-4 py-4',
      collapsed ? 'justify-center' : 'gap-2'
    )}>
      {/* Lightning bolt */}
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="shrink-0 text-[var(--theme-accent)]">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill="currentColor" />
      </svg>
      {!collapsed && (
        <span className="text-base font-bold tracking-tight">
          <span className="text-[var(--theme-text-primary)]">fleex</span>
          <span className="text-[var(--theme-accent)]">.dev</span>
        </span>
      )}
    </div>
  );
}

export function NavSidebar() {
  const navigate = useNavigate();
  const navCollapsed = useUIStore((s) => s.navCollapsed);
  const toggleNav = useUIStore((s) => s.toggleNav);
  const activePanel = useUIStore((s) => s.activePanel);
  const sessions = useSessionStore((s) => s.sessions);
  const summaries = useRepositoryDashboardStore((s) => s.summaries);
  const repoCount = Object.keys(summaries).length;
  const tickets = useTicketStore((s) => s.tickets);
  const activeTicketCount = tickets.filter((t) => t.status === 'doing' || t.status === 'reviewing').length;
  const totalUnread = useUnreadStore((s) => s.totalUnread);
  const streamingExecutionIds = useAgentEventStore((s) => s.streamingExecutionIds);
  const liveExecutionCount = Object.keys(streamingExecutionIds).length;
  return (
    <div className="flex h-full flex-col border-r border-[var(--theme-border)] bg-[var(--theme-bg-base)]">
      <FleexLogo collapsed={navCollapsed} />
      <div className="flex flex-1 flex-col gap-1 pt-2">
        {/* Dashboard */}
        <NavItem
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
            </svg>
          }
          label="Dashboard"
          active={activePanel === 'dashboard'}
          collapsed={navCollapsed}
          onClick={() => navigate('/dashboard')}
          badge={totalUnread > 0 ? (totalUnread > 9 ? '9+' : String(totalUnread)) : undefined}
        />

        {/* Tasks */}
        <NavItem
          icon={
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="5" cy="3.5" r="1.5" />
              <circle cx="5" cy="12.5" r="1.5" />
              <circle cx="12" cy="7" r="1.5" />
              <path d="M5 5v6M5 7.5c0-1.5 1-3 4.5-3" />
            </svg>
          }
          label="Session Tasks"
          active={activePanel === 'sessions'}
          collapsed={navCollapsed}
          badge={sessions.length > 0 ? (sessions.length > 9 ? '9+' : String(sessions.length)) : undefined}
          onClick={() => navigate('/sessions')}
        />

        {/* Repositories */}
        <NavItem
          icon={
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="10" width="12" height="2.5" rx="0.5" />
              <rect x="3" y="6" width="10" height="2.5" rx="0.5" />
              <rect x="1.5" y="2" width="13" height="2.5" rx="0.5" />
            </svg>
          }
          label="Repositories"
          active={activePanel === 'repositories'}
          collapsed={navCollapsed}
          badge={repoCount > 0 ? (repoCount > 9 ? '9+' : String(repoCount)) : undefined}

          onClick={() => navigate('/repositories')}
        />
        {/* Backlog (was Tickets) */}
        <NavItem
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="1" y="2" width="22" height="20" rx="1.5" stroke="currentColor" fill="none" />
              <line x1="8.5" y1="2" x2="8.5" y2="22" />
              <line x1="15.5" y1="2" x2="15.5" y2="22" />
              <line x1="3" y1="4" x2="7" y2="4" stroke="currentColor" strokeWidth="0.5" />
              <rect x="3" y="6" width="4" height="3" rx="0.5" fill="currentColor" stroke="none" />
              <rect x="3" y="10" width="4" height="3" rx="0.5" fill="currentColor" stroke="none" />
              <line x1="10" y1="4" x2="14" y2="4" stroke="currentColor" strokeWidth="0.5" />
              <rect x="10" y="6" width="4" height="3" rx="0.5" fill="currentColor" stroke="none" />
              <line x1="17" y1="4" x2="21" y2="4" stroke="currentColor" strokeWidth="0.5" />
              <rect x="17" y="6" width="4" height="3" rx="0.5" fill="currentColor" stroke="none" />
              <rect x="17" y="10" width="4" height="3" rx="0.5" fill="currentColor" stroke="none" />
              <rect x="17" y="14" width="4" height="3" rx="0.5" fill="currentColor" stroke="none" />
            </svg>
          }
          label="Backlog"
          active={activePanel === 'tickets'}
          collapsed={navCollapsed}
          badge={activeTicketCount > 0 ? (activeTicketCount > 9 ? '9+' : String(activeTicketCount)) : undefined}

          onClick={() => navigate('/tickets')}
        />

        {/* Claude Config */}
        <NavItem
          icon={
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
              {/* Document */}
              <path d="M9 1.5H4.5A1.5 1.5 0 0 0 3 3v10a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 13V5.5L9 1.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <polyline points="9,1.5 9,5.5 13,5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              {/* Claude sparkle overflowing */}
              <g transform="translate(0.5, 0.5) scale(0.029)">
                <path d="M142.27 316.619l73.655-41.326 1.238-3.589-1.238-1.996-3.589-.001-12.31-.759-42.084-1.138-36.498-1.516-35.361-1.896-8.897-1.895-8.34-10.995.859-5.484 7.482-5.03 10.717.935 23.683 1.617 35.537 2.452 25.782 1.517 38.193 3.968h6.064l.86-2.451-2.073-1.517-1.618-1.517-36.776-24.922-39.81-26.338-20.852-15.166-11.273-7.683-5.687-7.204-2.451-15.721 10.237-11.273 13.75.935 3.513.936 13.928 10.716 29.749 23.027 38.848 28.612 5.687 4.727 2.275-1.617.278-1.138-2.553-4.271-21.13-38.193-22.546-38.848-10.035-16.101-2.654-9.655c-.935-3.968-1.617-7.304-1.617-11.374l11.652-15.823 6.445-2.073 15.545 2.073 6.547 5.687 9.655 22.092 15.646 34.78 24.265 47.291 7.103 14.028 3.791 12.992 1.416 3.968 2.449-.001v-2.275l1.997-26.641 3.69-32.707 3.589-42.084 1.239-11.854 5.863-14.206 11.652-7.683 9.099 4.348 7.482 10.716-1.036 6.926-4.449 28.915-8.72 45.294-5.687 30.331h3.313l3.792-3.791 15.342-20.372 25.782-32.227 11.374-12.789 13.27-14.129 8.517-6.724 16.1-.001 11.854 17.617-5.307 18.199-16.581 21.029-13.75 17.819-19.716 26.54-12.309 21.231 1.138 1.694 2.932-.278 44.536-9.479 24.062-4.347 28.714-4.928 12.992 6.066 1.416 6.167-5.106 12.613-30.71 7.583-36.018 7.204-53.636 12.689-.657.48.758.935 24.164 2.275 10.337.556h25.301l47.114 3.514 12.309 8.139 7.381 9.959-1.238 7.583-18.957 9.655-25.579-6.066-59.702-14.205-20.474-5.106-2.83-.001v1.694l17.061 16.682 31.266 28.233 39.152 36.397 1.997 8.999-5.03 7.102-5.307-.758-34.401-25.883-13.27-11.651-30.053-25.302-1.996-.001v2.654l6.926 10.136 36.574 54.975 1.895 16.859-2.653 5.485-9.479 3.311-10.414-1.895-21.408-30.054-22.092-33.844-17.819-30.331-2.173 1.238-10.515 113.261-4.929 5.788-11.374 4.348-9.478-7.204-5.03-11.652 5.03-23.027 6.066-30.052 4.928-23.886 4.449-29.674 2.654-9.858-.177-.657-2.173.278-22.37 30.71-34.021 45.977-26.919 28.815-6.445 2.553-11.173-5.789 1.037-10.337 6.243-9.2 37.257-47.392 22.47-29.371 14.508-16.961-.101-2.451h-.859l-98.954 64.251-17.618 2.275-7.583-7.103.936-11.652 3.589-3.791 29.749-20.474z" fill="#D97706" />
              </g>
            </svg>
          }
          label="Claude Config"
          active={activePanel === 'claude-config'}
          collapsed={navCollapsed}

          onClick={() => navigate('/claude-config')}
        />

        {/* Agents */}
        <NavItem
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 8V4H8" />
              <rect width="16" height="12" x="4" y="8" rx="2" />
              <path d="M2 14h2" />
              <path d="M20 14h2" />
              <path d="M15 13v2" />
              <path d="M9 13v2" />
            </svg>
          }
          label="Agents"
          active={activePanel === 'agents'}
          collapsed={navCollapsed}

          onClick={() => navigate('/agents')}
        />

        {/* Scratchpads */}
        <NavItem
          icon={
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
              <path
                d="M3 2.5A1.5 1.5 0 014.5 1h7A1.5 1.5 0 0113 2.5v11a1.5 1.5 0 01-1.5 1.5h-7A1.5 1.5 0 013 13.5v-11z"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <path d="M5.5 5h5M5.5 7.5h5M5.5 10h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
            </svg>
          }
          label="Scratchpads"
          active={activePanel === 'scratchpads'}
          collapsed={navCollapsed}

          onClick={() => navigate('/scratchpads')}
        />

        {/* Execution Log */}
        <NavItem
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="5,3 19,12 5,21" fill={activePanel === 'execution-log' ? 'currentColor' : 'none'} />
            </svg>
          }
          label="Execution Log"
          active={activePanel === 'execution-log'}
          collapsed={navCollapsed}
          badge={liveExecutionCount > 0 ? (liveExecutionCount > 9 ? '9+' : String(liveExecutionCount)) : undefined}
          onClick={() => navigate('/execution-log')}
        />

        {/* Cluster - hidden for now */}
      </div>

      {/* Analytics & Settings - bottom of sidebar */}
      <div className="flex flex-col gap-1">
        <NavItem
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3v18h18" /><path d="M7 16l4-8 4 4 4-6" />
            </svg>
          }
          label="Analytics"
          active={activePanel === 'analytics'}
          collapsed={navCollapsed}

          onClick={() => navigate('/analytics')}
        />
        <NavItem
          icon={
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6.86 1.45h2.28l.34 1.7a5.2 5.2 0 0 1 1.16.67l1.62-.54 1.14 1.97-1.28 1.08c.04.22.06.44.06.67s-.02.45-.06.67l1.28 1.08-1.14 1.97-1.62-.54c-.35.27-.74.5-1.16.67l-.34 1.7H6.86l-.34-1.7a5.2 5.2 0 0 1-1.16-.67l-1.62.54-1.14-1.97 1.28-1.08A4.3 4.3 0 0 1 3.82 8c0-.23.02-.45.06-.67L2.6 6.25l1.14-1.97 1.62.54c.35-.27.74-.5 1.16-.67l.34-1.7z" />
              <circle cx="8" cy="8" r="2" />
            </svg>
          }
          label="Settings"
          active={activePanel === 'settings'}
          collapsed={navCollapsed}

          onClick={() => navigate('/settings')}
        />
      </div>

      {/* Collapse/expand toggle */}
      <button
        className="flex items-center justify-center gap-1.5 border-t border-[var(--theme-border)] py-2.5 text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]"
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
        {!navCollapsed && (
          <span className="text-xs">Collapse</span>
        )}
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
        'relative flex items-center gap-2.5 border-l-2 px-4 py-3 text-[15px] transition-colors',
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
