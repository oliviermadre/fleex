import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUIStore } from '../../stores/uiStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useAgentEventStore } from '../../stores/agentEventStore';
import { useRoutineStore } from '../../stores/routineStore';
import { cn } from '../../lib/cn';
import { RepositoriesIcon } from './icons';
import { NotificationNavItem } from '../notifications/NotificationNavItem';

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
  const streamingExecutionIds = useAgentEventStore((s) => s.streamingExecutionIds);
  const liveExecutionCount = Object.keys(streamingExecutionIds).length;
  const routinesAwaiting = useRoutineStore((s) => s.routines.filter((r) => r.awaitingAttention).length);
  const loadRoutines = useRoutineStore((s) => s.load);
  // The badge must be right before the user ever opens /routines, so the nav —
  // always mounted — is what primes the list.
  useEffect(() => { void loadRoutines(); }, [loadRoutines]);
  return (
    <div className="flex h-full flex-col border-r border-[var(--theme-border)] bg-[var(--theme-bg-base)]">
      <FleexLogo collapsed={navCollapsed} />
      <div className="flex flex-1 flex-col gap-1 pt-2">
        {/* === Pulse notifications (first position) === */}
        <NotificationNavItem collapsed={navCollapsed} />
        <div className="my-1 border-t border-[var(--theme-border-subtle)]" />

        {/* === Assistant === */}
        {/* Assistant (companion-backed LLM chat) */}
        <NavItem
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
              <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z" />
            </svg>
          }
          label="Assistant"
          shortLabel="Assistant"
          active={activePanel === 'assistant'}
          collapsed={navCollapsed}
          onClick={() => navigate('/assistant')}
        />

        {/* === Operational === */}
        <div className="my-1 border-t border-[var(--theme-border-subtle)]" />

        {/* Kanban (was Backlog / Tickets) */}
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
          label="Kanban"
          shortLabel="Kanban"
          active={activePanel === 'tickets'}
          collapsed={navCollapsed}
          onClick={() => navigate('/tickets')}
        />

        {/* Cockpit (cross-board list/focus monitoring) */}
        <NavItem
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="8" y1="6" x2="21" y2="6" />
              <line x1="8" y1="12" x2="21" y2="12" />
              <line x1="8" y1="18" x2="21" y2="18" />
              <circle cx="3.5" cy="6" r="1.2" fill="currentColor" stroke="none" />
              <circle cx="3.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
              <circle cx="3.5" cy="18" r="1.2" fill="currentColor" stroke="none" />
            </svg>
          }
          label="Cockpit"
          shortLabel="Cockpit"
          active={activePanel === 'list-focus'}
          collapsed={navCollapsed}
          onClick={() => navigate('/list-focus')}
        />

        {/* Sessions (live agent runs) */}
        <NavItem
          icon={
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="5" cy="3.5" r="1.5" />
              <circle cx="5" cy="12.5" r="1.5" />
              <circle cx="12" cy="7" r="1.5" />
              <path d="M5 5v6M5 7.5c0-1.5 1-3 4.5-3" />
            </svg>
          }
          label="Sessions"
          shortLabel="Sessions"
          active={activePanel === 'sessions'}
          collapsed={navCollapsed}
          badge={sessions.length > 0 ? (sessions.length > 9 ? '9+' : String(sessions.length)) : undefined}
          onClick={() => navigate('/sessions')}
        />

        {/* Execution Log */}
        <NavItem
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="5,3 19,12 5,21" fill={activePanel === 'execution-log' ? 'currentColor' : 'none'} />
            </svg>
          }
          label="Execution Log"
          shortLabel="Logs"
          active={activePanel === 'execution-log'}
          collapsed={navCollapsed}
          badge={liveExecutionCount > 0 ? (liveExecutionCount > 9 ? '9+' : String(liveExecutionCount)) : undefined}
          onClick={() => navigate('/execution-log')}
        />

        {/* Routines — workflow runs with no ticket. The badge counts routines
            whose active run is blocked on a gate or waiting for an answer:
            those runs have no ticket, so nothing else in the nav surfaces them. */}
        <NavItem
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 2l4 4-4 4" />
              <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
              <path d="M7 22l-4-4 4-4" />
              <path d="M21 13v1a4 4 0 0 1-4 4H3" />
            </svg>
          }
          label="Routines"
          shortLabel="Routines"
          active={activePanel === 'routines'}
          collapsed={navCollapsed}
          badge={routinesAwaiting > 0 ? String(routinesAwaiting) : undefined}
          onClick={() => navigate('/routines')}
        />

        {/* === Content === */}
        <div className="my-1 border-t border-[var(--theme-border-subtle)]" />

        {/* Notes (was Scratchpads) */}
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
          label="Notes"
          shortLabel="Notes"
          active={activePanel === 'scratchpads'}
          collapsed={navCollapsed}
          onClick={() => navigate('/scratchpads')}
        />

        {/* Documents */}
        <NavItem
          icon={
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"
              stroke="currentColor" strokeWidth="1.5"
              strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="5" width="14" height="12" rx="1.5" />
              <path d="M6 2h8" />
              <path d="M7 9h6M7 12h4" />
            </svg>
          }
          label="Documents"
          shortLabel="Docs"
          active={activePanel === 'documents'}
          collapsed={navCollapsed}
          onClick={() => navigate('/documents')}
        />

        {/* Cluster - hidden for now */}
      </div>

      {/* Config & meta - bottom of sidebar */}
      <div className="flex flex-col gap-1 border-t border-[var(--theme-border-subtle)] pt-1">
        {/* Agentic catalog (Personas / Skills / Panels / Workflows) — four
            geometric shapes (square, circle, triangle, diamond), one per
            primitive family. */}
        <NavItem
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <circle cx="17.5" cy="6.5" r="3.5" />
              <path d="M6.5 14 10 21 3 21 Z" />
              <path d="M17.5 14 21 17.5 17.5 21 14 17.5 Z" />
            </svg>
          }
          label="Agentic"
          shortLabel="Agentic"
          active={activePanel === 'agents'}
          collapsed={navCollapsed}
          onClick={() => navigate('/agents')}
        />
        <NavItem
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3v18h18" /><path d="M7 16l4-8 4 4 4-6" />
            </svg>
          }
          label="Analytics"
          shortLabel="Stats"
          active={activePanel === 'analytics'}
          collapsed={navCollapsed}
          onClick={() => navigate('/analytics')}
        />
        {/* Repositories */}
        <NavItem
          icon={<RepositoriesIcon size={20} />}
          label="Repositories"
          shortLabel="Repos"
          active={activePanel === 'repositories'}
          collapsed={navCollapsed}
          onClick={() => navigate('/repositories')}
        />
        <NavItem
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          }
          label="Settings"
          shortLabel="Config"
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
  shortLabel,
  active,
  collapsed,
  badge,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  shortLabel?: string;
  active: boolean;
  collapsed: boolean;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        'relative border-l-2 transition-colors',
        active
          ? 'border-[var(--theme-accent)] bg-[var(--theme-bg-hover)] text-[var(--theme-text-primary)]'
          : 'border-transparent text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]',
        collapsed
          ? 'flex flex-col items-center gap-1 px-1 py-2'
          : 'flex items-center gap-2.5 px-4 py-3 text-[15px]'
      )}
      onClick={onClick}
      title={collapsed ? label : undefined}
    >
      <span className="relative flex-shrink-0">
        {icon}
        {badge && collapsed && (
          <span className="absolute -right-1.5 -top-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[var(--theme-accent-active)] text-[8px] font-bold text-[var(--theme-accent-fg)]">
            {badge}
          </span>
        )}
      </span>
      {collapsed ? (
        <span
          className={cn(
            'max-w-full truncate text-[10px] font-medium leading-none tracking-tight',
            active ? 'text-[var(--theme-accent)]' : 'text-[var(--theme-text-faint)]'
          )}
        >
          {shortLabel ?? label}
        </span>
      ) : (
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
