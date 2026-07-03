import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import type {
  Ticket,
  TicketLink,
  TicketStatus,
  TicketPriority,
  Session,
  SessionGroup,
  BoardWithCounts,
  DashboardData,
  DashboardPullRequest,
  DashboardWorktree,
  DashboardGitHubIssue,
} from '@fleex/shared';
import { TICKET_PRIORITIES, TICKET_STATUS_LABELS } from '@fleex/shared';
import { importGitHubIssue, importGitHubPR, executeSkill } from '../../services/api';
import { useDashboardStore } from '../../stores/dashboardStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useTicketStore } from '../../stores/ticketStore';
import { useUIStore } from '../../stores/uiStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUnreadStore } from '../../stores/unreadStore';
import { useAgentEventStore } from '../../stores/agentEventStore';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';
import { cn } from '../../lib/cn';
import { useClickOutside } from '../../hooks/useClickOutside';
import { getPrBadgeClasses } from '../../lib/prBadgeStyle';
import { notifyHookStarted } from '../../lib/hookResultToast';
import { SmartSessionButton } from './SmartSessionButton';
import { ImportTaskButton } from './ImportTaskButton';
import { PriorityPickerPopover } from '../tickets/PriorityPickerPopover';
import { PriorityIndicator } from '../tickets/PriorityIndicator';
import { findSessionsForTicketId, findSessionsForPR, hasLocalWorktreeForPR } from './dashboard-helpers';

// ── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function getGreeting(): string {
  const h = new Date().getHours();
  return h >= 18 || h < 5 ? 'Bonsoir' : 'Bonjour';
}

function getTodayFrench(): string {
  const d = new Date();
  const days = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const months = [
    'janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre',
  ];
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
}

// Status colors matching the kanban NanoKanban palette
const STATUS_COLOR: Record<string, string> = {
  backlog: 'var(--theme-text-faint)',
  todo: '#fb923c',      // orange-400
  doing: '#60a5fa',     // blue-400
  reviewing: '#c084fc',  // purple-400
  done: '#4ade80',      // green-400
  cancelled: 'rgb(248 113 113 / 0.7)', // red-400/70
};

const STATUS_PULSE: Record<string, boolean> = {
  doing: true,
};

const INLINE_STATUSES: TicketStatus[] = [
  'backlog', 'todo', 'doing', 'reviewing', 'done', 'cancelled',
];

// ── Inline keyframes ─────────────────────────────────────────────────────────

const KEYFRAMES = `
@keyframes dashFadeIn {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes dashPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
@keyframes dashSkeleton {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
`;

// ── Sub-components ───────────────────────────────────────────────────────────

function SectionShell({
  children,
  delay = 0,
}: {
  children: React.ReactNode;
  delay?: number;
}) {
  return (
    <div
      className="rounded-xl border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-surface)] p-4"
      style={{
        animation: `dashFadeIn 0.4s ease-out ${delay}ms both`,
      }}
    >
      {children}
    </div>
  );
}

function SectionHeader({
  icon,
  title,
  count,
  subtitle,
  toolbar,
}: {
  icon?: React.ReactNode;
  title: string;
  count: number;
  subtitle?: string;
  toolbar?: React.ReactNode;
}) {
  return (
    <div className="-mx-4 -mt-4 mb-3 rounded-t-xl border-b border-[var(--theme-border-subtle)] px-4 py-2.5" style={{ backgroundColor: 'color-mix(in srgb, var(--theme-accent) 8%, var(--theme-bg-surface))' }}>
      <div className="flex items-center gap-2.5">
        {icon && (
          <span className="text-[var(--theme-text-secondary)]">
            {icon}
          </span>
        )}
        <span className="text-sm font-bold uppercase tracking-wider text-[var(--theme-text-primary)]">
          {title}
        </span>
        <span className="rounded-full bg-[var(--theme-bg-overlay)] px-2 py-0.5 text-[10px] font-medium text-[var(--theme-text-muted)]">
          {count}
        </span>
        {toolbar && (
          <>
            <span className="flex-1" />
            {toolbar}
          </>
        )}
      </div>
      {subtitle && (
        <span className="ml-7 text-[10px] text-[var(--theme-text-faint)]">{subtitle}</span>
      )}
    </div>
  );
}

function EmptyState({ icon, message }: { icon: React.ReactNode; message: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg px-3 py-6 text-sm text-[var(--theme-text-faint)]">
      <span className="flex-shrink-0 opacity-40">{icon}</span>
      <span>{message}</span>
    </div>
  );
}

function SkeletonBlock({ lines = 3 }: { lines?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="h-10 rounded-lg"
          style={{
            background: 'linear-gradient(90deg, var(--theme-bg-hover) 25%, var(--theme-bg-surface) 50%, var(--theme-bg-hover) 75%)',
            backgroundSize: '200% 100%',
            animation: 'dashSkeleton 1.5s ease-in-out infinite',
            animationDelay: `${i * 100}ms`,
          }}
        />
      ))}
    </div>
  );
}

// ── Icons (inline SVGs) ──────────────────────────────────────────────────────

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('transition-transform', spinning && 'animate-spin')}
    >
      <path d="M2.5 8a5.5 5.5 0 0 1 9.3-4" />
      <polyline points="12,2 12,5.5 8.5,5.5" />
      <path d="M13.5 8a5.5 5.5 0 0 1-9.3 4" />
      <polyline points="4,14 4,10.5 7.5,10.5" />
    </svg>
  );
}

function GitPrIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="4" r="1.5" />
      <circle cx="5" cy="12" r="1.5" />
      <line x1="5" y1="5.5" x2="5" y2="10.5" />
      <circle cx="11" cy="4" r="1.5" />
      <path d="M11 5.5v3c0 1.1-.9 2-2 2H7.5" />
    </svg>
  );
}

function GitBranchIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="3.5" r="1.5" />
      <circle cx="5" cy="12.5" r="1.5" />
      <circle cx="11" cy="6.5" r="1.5" />
      <line x1="5" y1="5" x2="5" y2="11" />
      <path d="M11 8v2.5c0 1.1-.9 2-2 2H5" />
    </svg>
  );
}

function GitHubIcon({ size = 14 }: { size?: number } = {}) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function IssueIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6.5" />
      <circle cx="8" cy="8" r="1" fill="currentColor" />
    </svg>
  );
}

function BugIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="8" cy="9.5" rx="3.5" ry="4" />
      <path d="M6 6.5a2 2 0 0 1 4 0" />
      <line x1="1.5" y1="8" x2="4.5" y2="8" />
      <line x1="11.5" y1="8" x2="14.5" y2="8" />
      <line x1="2" y1="11.5" x2="4.5" y2="10.5" />
      <line x1="14" y1="11.5" x2="11.5" y2="10.5" />
      <line x1="3" y1="5" x2="5" y2="6.5" />
      <line x1="13" y1="5" x2="11" y2="6.5" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4,6 8,10 12,6" />
    </svg>
  );
}

function FilterIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="1 1 15 1 9 8 9 13 7 15 7 8 1 1" />
    </svg>
  );
}

function SortIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 2v12M4 14l-3-3M4 14l3-3" />
      <path d="M12 14V2M12 2l-3 3M12 2l3 3" />
    </svg>
  );
}

function CoffeeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 5h8v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5z" />
      <path d="M11 6h1a2 2 0 0 1 0 4h-1" />
      <line x1="2" y1="15" x2="12" y2="15" />
    </svg>
  );
}

// ── Dashboard Item Row ──────────────────────────────────────────────────────

type DashboardItem = (DashboardGitHubIssue | DashboardPullRequest) & { linkedTicketId?: string };

function isPR(item: DashboardItem): item is DashboardPullRequest {
  return 'headRefName' in item;
}

function DashboardItemRow({
  kind,
  item,
  ticket,
  sessions,
  worktrees,
  boards,
  allPullRequests,
  onImport,
  importing,
  onStatusChange,
  onNavigate,
}: {
  kind: 'issue' | 'pr';
  item: DashboardItem;
  ticket?: Ticket;
  sessions: Session[];
  worktrees: DashboardWorktree[];
  boards: BoardWithCounts[];
  allPullRequests: DashboardPullRequest[];
  onImport: (boardId: string) => void;
  importing: boolean;
  onStatusChange: (ticketId: string, newStatus: TicketStatus) => void;
  onNavigate: (ticket: Ticket) => void;
}) {
  const navigate = useNavigate();
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const statusMenuRef = useRef<HTMLDivElement>(null);
  const updateTicket = useTicketStore.getState().updateTicket;

  useClickOutside(statusMenuRef, () => setStatusMenuOpen(false), statusMenuOpen);

  const ghUrl = kind === 'issue'
    ? `https://github.com/${item.org}/${item.name}/issues/${item.number}`
    : `https://github.com/${item.org}/${item.name}/pull/${item.number}`;

  // ── State A: No linked ticket ──
  if (!ticket) {
    return (
      <div className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-all duration-150 hover:bg-[var(--theme-bg-hover)]">
        <span className="flex-shrink-0 text-[var(--theme-text-muted)]">
          {kind === 'issue' ? <IssueIcon /> : <GitPrIcon />}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-sm text-[var(--theme-text-primary)]">
            {item.title}
          </span>
          <div className="flex items-center gap-2 text-xs text-[var(--theme-text-muted)]">
            <span className="truncate text-[10px] text-[var(--theme-text-faint)]">
              {item.org}/{item.name}
            </span>
            <a
              href={ghUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[var(--theme-text-faint)] transition-colors hover:text-[var(--theme-text-secondary)]"
              onClick={(e) => e.stopPropagation()}
            >
              #{item.number}
              <GitHubIcon size={11} />
            </a>
            <span className="text-[var(--theme-text-faint)]">{timeAgo(item.createdAt)}</span>
          </div>
        </div>
        <span className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          <ImportTaskButton boards={boards} onImport={onImport} importing={importing} />
        </span>
      </div>
    );
  }

  // ── State B: Has linked ticket ──
  const boardMap = useTicketStore.getState().boards;
  const board = boardMap.find((b) => b.id === ticket.boardId);

  const repoLink = ticket.links.find((l: TicketLink) => l.type === 'repository' || l.type === 'worktree');
  const repoLabel = repoLink
    ? repoLink.type === 'worktree'
      ? repoLink.ref.split(':')[0]
      : repoLink.ref
    : null;

  const wtLink = ticket.links.find((l: TicketLink) => l.type === 'worktree');
  const branchName = wtLink ? wtLink.ref.split(':')[1] : null;

  // Match PR for this ticket's worktree branch
  const ticketPR = (() => {
    if (!wtLink) return null;
    const [orgName, branch] = wtLink.ref.split(':');
    if (!orgName || !branch) return null;
    const [org, name] = orgName.split('/');
    return allPullRequests.find(
      (pr) => pr.org === org && pr.name === name && pr.headRefName === branch,
    ) ?? null;
  })();

  const statusColor = STATUS_COLOR[ticket.status] ?? '#60a5fa';
  const statusPulse = STATUS_PULSE[ticket.status] ?? false;
  const statusLabel = TICKET_STATUS_LABELS[ticket.status] ?? ticket.status;

  const hasWorktree = isPR(item) ? hasLocalWorktreeForPR(item, worktrees) : false;

  const handleWorktreeClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isPR(item)) return;
    const worktreeKey = `${item.org}/${item.name}:${item.headRefName}`;
    const lastSessionId = useUIStore.getState().lastActiveTabByWorktree[worktreeKey];
    if (lastSessionId) {
      navigate(`/sessions/${lastSessionId}`);
      return;
    }
    if (sessions.length > 0) {
      navigate(`/sessions/${sessions[0]!.id}`);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      className="group flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-all duration-150 hover:bg-[var(--theme-bg-hover)]"
      onClick={() => onNavigate(ticket)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNavigate(ticket); } }}
    >
      {/* Priority picker + blocked lock */}
      <div className="flex flex-shrink-0 flex-col items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <PriorityPickerPopover ticket={ticket} />
        <button
          className={cn(
            'rounded transition-all',
            ticket.blocked
              ? 'opacity-100 text-red-500 hover:text-red-400'
              : 'opacity-30 text-[var(--theme-text-muted)] hover:opacity-100',
          )}
          onClick={(e) => {
            e.stopPropagation();
            updateTicket(ticket.id, { blocked: !ticket.blocked });
          }}
          title={ticket.blocked ? 'Unblock ticket' : 'Mark as blocked'}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
            <rect x="3" y="7" width="10" height="8" rx="1.5" />
            <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium text-[var(--theme-text-primary)]">
          {ticket.title}
        </span>
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--theme-text-muted)]">
          {/* Status chip with dropdown */}
          <div className="relative" ref={statusMenuRef} onClick={(e) => e.stopPropagation()}>
            <span
              className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-[var(--theme-bg-overlay)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--theme-text-secondary)] transition-colors hover:bg-[var(--theme-bg-hover)]"
              role="button"
              tabIndex={-1}
              onClick={() => setStatusMenuOpen(!statusMenuOpen)}
            >
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{
                  backgroundColor: statusColor,
                  animation: statusPulse ? 'dashPulse 2s ease-in-out infinite' : 'none',
                }}
              />
              {statusLabel}
            </span>
            {statusMenuOpen && (
              <div className="absolute left-0 top-full z-50 mt-1 min-w-[120px] rounded-lg border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-surface)] py-1 shadow-lg">
                {INLINE_STATUSES.map((s) => (
                  <button
                    key={s}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-[var(--theme-bg-hover)]',
                      ticket.status === s && 'font-semibold text-[var(--theme-accent)]',
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (ticket.status !== s) {
                        onStatusChange(ticket.id, s);
                      }
                      setStatusMenuOpen(false);
                    }}
                  >
                    <span
                      className="inline-block h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: STATUS_COLOR[s] }}
                    />
                    {TICKET_STATUS_LABELS[s] ?? s}
                  </button>
                ))}
              </div>
            )}
          </div>
          {board && (
            <span className="truncate rounded bg-[var(--theme-bg-overlay)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--theme-text-muted)]">
              {board.emoji} {board.name}
            </span>
          )}
          {repoLabel && (
            <span className="truncate rounded bg-[var(--theme-bg-overlay)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--theme-text-faint)]">
              {repoLabel}
            </span>
          )}
          {branchName && (
            <span className="truncate font-mono text-[10px] text-[var(--theme-text-faint)]">
              {branchName}
            </span>
          )}
{ticketPR && (
            <a
              href={`https://github.com/${ticketPR.org}/${ticketPR.name}/pull/${ticketPR.number}`}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                'shrink-0 inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-medium',
                getPrBadgeClasses(ticketPR)
              )}
              onClick={(e) => e.stopPropagation()}
              title={ticketPR.title}
            >
              <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" /></svg>
              #{ticketPR.number}
            </a>
          )}
          <a
            href={ghUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[var(--theme-text-faint)] transition-colors hover:text-[var(--theme-text-secondary)]"
            onClick={(e) => e.stopPropagation()}
            title="Voir sur GitHub"
          >
            <GitHubIcon size={11} />
          </a>
          <span className="text-[var(--theme-text-faint)]">{timeAgo(item.createdAt)}</span>
        </div>
      </div>

      {/* SmartSessionButton */}
      <span className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
        <SmartSessionButton
          sessions={sessions}
          ticketId={ticket.id}
          onExecuteSkill={(skillId) => executeSkill(skillId, ticket.id)}
        />
      </span>
    </div>
  );
}

// ── Section Toolbar ─────────────────────────────────────────────────────────

function SectionToolbar({
  repos,
  repoFilter,
  setRepoFilter,
  sortOrder,
  setSortOrder,
  searchQuery,
  setSearchQuery,
}: {
  repos: string[];
  repoFilter: string;
  setRepoFilter: (v: string) => void;
  sortOrder: 'recent' | 'oldest';
  setSortOrder: (v: 'recent' | 'oldest') => void;
  searchQuery: string;
  setSearchQuery: (v: string) => void;
}) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);

  useClickOutside(filterRef, () => setFilterOpen(false), filterOpen);
  useClickOutside(sortRef, () => setSortOpen(false), sortOpen);

  const isFilterActive = repoFilter !== 'all';

  return (
    <div className="flex items-center gap-1.5">
      {/* Search */}
      <div className="relative">
        <svg className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--theme-text-faint)]" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="7" cy="7" r="5" />
          <line x1="11" y1="11" x2="14" y2="14" />
        </svg>
        <input
          type="text"
          placeholder="Rechercher..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-7 w-36 rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-base)] pl-7 pr-2 text-[11px] text-[var(--theme-text-primary)] placeholder-[var(--theme-text-muted)] transition-colors focus:border-[var(--theme-accent)] focus:outline-none"
        />
      </div>

      {/* Filter icon */}
      {repos.length > 1 && (
        <div className="relative" ref={filterRef}>
          <button
            className={cn(
              'relative flex h-6 w-6 items-center justify-center rounded-md transition-colors',
              isFilterActive
                ? 'bg-[var(--theme-accent)]/15 text-[var(--theme-accent)]'
                : 'text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]',
              filterOpen && 'bg-[var(--theme-bg-hover)]',
            )}
            onClick={() => { setFilterOpen(!filterOpen); setSortOpen(false); }}
          >
            <FilterIcon />
          </button>
          {filterOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 min-w-[200px] rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-3 shadow-xl">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--theme-text-muted)]">Repository</span>
                {isFilterActive && (
                  <button
                    className="text-[10px] text-[var(--theme-accent)] transition-colors hover:underline"
                    onClick={() => setRepoFilter('all')}
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="flex flex-col gap-0.5">
                <button
                  className={cn(
                    'flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-[var(--theme-bg-hover)]',
                    repoFilter === 'all'
                      ? 'bg-[var(--theme-accent)]/10 text-[var(--theme-accent)]'
                      : 'text-[var(--theme-text-secondary)]',
                  )}
                  onClick={() => { setRepoFilter('all'); setFilterOpen(false); }}
                >
                  Tous
                </button>
                {repos.map((r) => (
                  <button
                    key={r}
                    className={cn(
                      'flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-[var(--theme-bg-hover)]',
                      repoFilter === r
                        ? 'bg-[var(--theme-accent)]/10 text-[var(--theme-accent)]'
                        : 'text-[var(--theme-text-secondary)]',
                    )}
                    onClick={() => { setRepoFilter(r); setFilterOpen(false); }}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Sort icon */}
      <div className="relative" ref={sortRef}>
        <button
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded-md transition-colors',
            sortOrder !== 'recent'
              ? 'bg-[var(--theme-accent)]/15 text-[var(--theme-accent)]'
              : 'text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]',
            sortOpen && 'bg-[var(--theme-bg-hover)]',
          )}
          onClick={() => { setSortOpen(!sortOpen); setFilterOpen(false); }}
        >
          <SortIcon />
        </button>
        {sortOpen && (
          <div className="absolute right-0 top-full z-50 mt-1 min-w-[130px] rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-1.5 shadow-xl">
            {([
              { value: 'recent' as const, label: 'Recent' },
              { value: 'oldest' as const, label: 'Ancien' },
            ]).map((opt) => (
              <button
                key={opt.value}
                className={cn(
                  'flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-[var(--theme-bg-hover)]',
                  sortOrder === opt.value
                    ? 'bg-[var(--theme-accent)]/10 text-[var(--theme-accent)]'
                    : 'text-[var(--theme-text-secondary)]',
                )}
                onClick={() => { setSortOrder(opt.value); setSortOpen(false); }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── GitHub Section ──────────────────────────────────────────────────────────

function GithubSection({
  title,
  icon,
  leftItems,
  rightItems,
  kind,
  allTickets,
  sessions,
  sessionGroups,
  worktrees,
  boards,
  allPullRequests,
  onImport,
  importingKey,
  onStatusChange,
  onNavigate,
  delay,
  emptyMessage,
}: {
  title: string;
  icon: React.ReactNode;
  leftItems: DashboardItem[];
  rightItems: DashboardItem[];
  kind: 'issue' | 'pr';
  allTickets: Ticket[];
  sessions: Session[];
  sessionGroups: SessionGroup[];
  worktrees: DashboardWorktree[];
  boards: BoardWithCounts[];
  allPullRequests: DashboardPullRequest[];
  onImport: (item: DashboardItem, boardId: string) => void;
  importingKey: string | null;
  onStatusChange: (ticketId: string, newStatus: TicketStatus) => void;
  onNavigate: (ticket: Ticket) => void;
  delay: number;
  emptyMessage: string;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [repoFilter, setRepoFilter] = useState<string>('all');
  const [sortOrder, setSortOrder] = useState<'recent' | 'oldest'>('recent');

  const totalCount = leftItems.length + rightItems.length;

  // All repos across both columns
  const repos = useMemo(() => {
    const set = new Set([...leftItems, ...rightItems].map((item) => `${item.org}/${item.name}`));
    return Array.from(set).sort();
  }, [leftItems, rightItems]);

  // Ticket lookup map
  const ticketMap = useMemo(() => {
    const map = new Map<string, Ticket>();
    for (const t of allTickets) map.set(t.id, t);
    return map;
  }, [allTickets]);

  // Filter + sort a column's items
  const filterAndSort = useCallback((items: DashboardItem[]) => {
    let result = items;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((item) => {
        if (item.title.toLowerCase().includes(q)) return true;
        // Also search the linked Fleex ticket title (may differ from GitHub title)
        const ticket = item.linkedTicketId ? ticketMap.get(item.linkedTicketId) : undefined;
        return ticket ? ticket.title.toLowerCase().includes(q) : false;
      });
    }
    if (repoFilter !== 'all') {
      result = result.filter((item) => `${item.org}/${item.name}` === repoFilter);
    }
    result = [...result].sort((a, b) => {
      const diff = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      return sortOrder === 'recent' ? diff : -diff;
    });
    return result;
  }, [searchQuery, repoFilter, sortOrder, ticketMap]);

  const filteredLeft = useMemo(() => filterAndSort(leftItems), [filterAndSort, leftItems]);
  const filteredRight = useMemo(() => filterAndSort(rightItems), [filterAndSort, rightItems]);

  const renderItem = (item: DashboardItem) => {
    const ticket = item.linkedTicketId ? ticketMap.get(item.linkedTicketId) : undefined;
    const key = `${item.org}/${item.name}#${item.number}`;

    const itemSessions = ticket
      ? findSessionsForTicketId(ticket.id, sessionGroups)
      : isPR(item) ? findSessionsForPR(item, sessions) : [];

    return (
      <DashboardItemRow
        key={key}
        kind={kind}
        item={item}
        ticket={ticket}
        sessions={itemSessions}
        worktrees={worktrees}
        boards={boards}
        allPullRequests={allPullRequests}
        onImport={(boardId) => onImport(item, boardId)}
        importing={importingKey === key}
        onStatusChange={onStatusChange}
        onNavigate={onNavigate}
      />
    );
  };

  return (
    <SectionShell delay={delay}>
      <SectionHeader
        icon={icon}
        title={title}
        count={totalCount}
        toolbar={totalCount > 0 ? (
          <SectionToolbar
            repos={repos}
            repoFilter={repoFilter}
            setRepoFilter={setRepoFilter}
            sortOrder={sortOrder}
            setSortOrder={setSortOrder}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
          />
        ) : undefined}
      />
      {totalCount === 0 ? (
        <EmptyState
          icon={kind === 'issue' ? <IssueIcon /> : <GitPrIcon />}
          message={emptyMessage}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr]">
          {/* Created by me */}
          <div className="min-w-0">
            <div className="mb-1.5 flex items-center gap-2 px-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
                Created by me
              </span>
              <span className="text-[10px] text-[var(--theme-text-faint)]">
                {filteredLeft.length}
              </span>
            </div>
            <div className="flex flex-col">
              {filteredLeft.length === 0 ? (
                <div className="px-3 py-4 text-xs text-[var(--theme-text-faint)]">
                  Nothing here
                </div>
              ) : (
                filteredLeft.map(renderItem)
              )}
            </div>
          </div>

          {/* Vertical separator */}
          <div className="mx-2 hidden w-px bg-[var(--theme-border-subtle)] lg:block" />

          {/* Assigned to me */}
          <div className="min-w-0">
            <div className="mb-1.5 flex items-center gap-2 px-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
                Assigned to me
              </span>
              <span className="text-[10px] text-[var(--theme-text-faint)]">
                {filteredRight.length}
              </span>
            </div>
            <div className="flex flex-col">
              {filteredRight.length === 0 ? (
                <div className="px-3 py-4 text-xs text-[var(--theme-text-faint)]">
                  Nothing here
                </div>
              ) : (
                filteredRight.map(renderItem)
              )}
            </div>
          </div>
        </div>
      )}
    </SectionShell>
  );
}

// ── Sync Toolbar ─────────────────────────────────────────────────────────────

const SYNC_OPTIONS = [
  { label: 'Disabled', ms: 0 },
  { label: '1 min', ms: 60_000 },
  { label: '2 min', ms: 120_000 },
  { label: '5 min', ms: 300_000 },
  { label: '15 min', ms: 900_000 },
  { label: '30 min', ms: 1_800_000 },
  { label: '1h', ms: 3_600_000 },
];

function useLiveSyncAge(lastFetchedAt: Date | null): string {
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    if (!lastFetchedAt) return;
    const id = setInterval(() => forceUpdate((n) => n + 1), 10_000);
    return () => clearInterval(id);
  }, [lastFetchedAt]);
  if (!lastFetchedAt) return 'never';
  return timeAgo(lastFetchedAt.toISOString());
}

function SyncToolbar() {
  const refreshing = useDashboardStore((s) => s.refreshing);
  const lastFetchedAt = useDashboardStore((s) => s.lastFetchedAt);
  const autoSyncIntervalMs = useDashboardStore((s) => s.autoSyncIntervalMs);
  const setAutoSyncInterval = useDashboardStore((s) => s.setAutoSyncInterval);
  const fetchDash = useDashboardStore((s) => s.fetch);

  const [syncOpen, setSyncOpen] = useState(false);
  const syncBtnRef = useRef<HTMLButtonElement>(null);
  const syncMenuRef = useRef<HTMLDivElement>(null);

  useClickOutside([syncBtnRef, syncMenuRef], () => setSyncOpen(false), syncOpen);

  const syncAge = useLiveSyncAge(lastFetchedAt);
  const currentLabel = SYNC_OPTIONS.find((o) => o.ms === autoSyncIntervalMs)?.label ?? 'Disabled';

  return (
    <div className="flex items-center gap-3">
      {/* Last sync */}
      <span className="text-[11px] text-[var(--theme-text-faint)]">
        Last sync: {syncAge}
      </span>

      {/* Auto-sync dropdown */}
      <button
        ref={syncBtnRef}
        className={cn(
          'flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors',
          autoSyncIntervalMs > 0
            ? 'bg-[var(--theme-accent)]/10 text-[var(--theme-accent)]'
            : 'text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]',
        )}
        onClick={() => setSyncOpen(!syncOpen)}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="8" cy="8" r="6" />
          <polyline points="8,4 8,8 11,10" />
        </svg>
        {currentLabel}
        <ChevronDownIcon />
      </button>
      {syncOpen && syncBtnRef.current && createPortal(
        <div
          ref={syncMenuRef}
          className="fixed z-50 min-w-[120px] rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-1.5 shadow-xl"
          style={{ left: syncBtnRef.current.getBoundingClientRect().left, top: syncBtnRef.current.getBoundingClientRect().bottom + 4 }}
        >
          {SYNC_OPTIONS.map((opt) => (
            <button
              key={opt.ms}
              className={cn(
                'flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-[var(--theme-bg-hover)]',
                autoSyncIntervalMs === opt.ms
                  ? 'bg-[var(--theme-accent)]/10 text-[var(--theme-accent)]'
                  : 'text-[var(--theme-text-secondary)]',
              )}
              onClick={() => { setAutoSyncInterval(opt.ms); setSyncOpen(false); }}
            >
              {opt.label}
            </button>
          ))}
        </div>,
        document.body,
      )}

      {/* Refresh now */}
      <button
        className={cn(
          'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all',
          'text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]',
          refreshing && 'pointer-events-none opacity-60',
        )}
        onClick={() => fetchDash()}
        disabled={refreshing}
        title="Refresh now"
      >
        <RefreshIcon spinning={refreshing} />
      </button>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export function DashboardView() {
  const navigate = useNavigate();
  const [importingKey, setImportingKey] = useState<string | null>(null);

  // Dashboard store
  const data = useDashboardStore((s) => s.data);
  const loading = useDashboardStore((s) => s.loading);
  const refreshing = useDashboardStore((s) => s.refreshing);
  const autoSyncIntervalMs = useDashboardStore((s) => s.autoSyncIntervalMs);
  const fetchDash = useDashboardStore((s) => s.fetch);

  // Live data from stores
  const humanDisplayName = useSettingsStore((s) => s.settings.humanDisplayName);
  const sessions = useSessionStore((s) => s.sessions);
  const sessionGroups = useSessionStore((s) => s.sessionGroups);
  const storeTickets = useTicketStore((s) => s.tickets);

  // Unread & agent activity
  const totalUnread = useUnreadStore((s) => s.totalUnread);
  const loadUnreadCounts = useUnreadStore((s) => s.loadUnreadCounts);
  const executionsByTicket = useAgentEventStore((s) => s.executionsByTicket);
  const personas = useAgentPersonaStore((s) => s.personas);

  const visibleTicketIds = useMemo(() => storeTickets.map((t) => t.id), [storeTickets]);
  useEffect(() => { loadUnreadCounts(visibleTicketIds); }, [loadUnreadCounts, visibleTicketIds]);

  // Fetch on mount only if no cached data
  useEffect(() => {
    if (!data) fetchDash();
  }, [data, fetchDash]);

  // Auto-sync interval (only while this view is mounted)
  useEffect(() => {
    if (autoSyncIntervalMs <= 0) return;
    const id = setInterval(fetchDash, autoSyncIntervalMs);
    return () => clearInterval(id);
  }, [autoSyncIntervalMs, fetchDash]);

  // Build recent agent activity from all executions
  const recentActivity = useMemo(() => {
    const allExecs = Object.values(executionsByTicket).flat();
    return [...allExecs]
      .filter((e) => e.status !== 'running')
      .sort((a, b) => new Date(b.completedAt ?? b.startedAt).getTime() - new Date(a.completedAt ?? a.startedAt).getTime())
      .slice(0, 10)
      .map((e) => {
        const persona = personas.find((p) => p.id === e.personaId);
        const ticket = storeTickets.find((t) => t.id === e.ticketId);
        return { ...e, personaName: persona?.displayName ?? persona?.name ?? 'Agent', ticketTitle: ticket?.title ?? `#${ticket?.displayId ?? '?'}` };
      });
  }, [executionsByTicket, personas, storeTickets]);

  const boards = useTicketStore((s) => s.boards);
  const moveTicket = useTicketStore((s) => s.moveTicket);

  // Merge live store updates on top of dashboard data
  const allTickets = useMemo(() => {
    const base = data?.activeTickets ?? [];
    if (storeTickets.length === 0) return base;
    const storeMap = new Map(storeTickets.map((t: Ticket) => [t.id, t]));
    return base.map((t: Ticket) => storeMap.get(t.id) ?? t);
  }, [data?.activeTickets, storeTickets]);

  const allPullRequests = useMemo(
    () => [...(data?.myPullRequests ?? []), ...(data?.reviewRequests ?? [])],
    [data?.myPullRequests, data?.reviewRequests],
  );

  const handleStatusChange = useCallback(async (ticketId: string, newStatus: TicketStatus) => {
    try {
      await moveTicket(ticketId, newStatus);
      fetchDash();
    } catch {
      // handled by api layer
    }
  }, [moveTicket, fetchDash]);

  const handleTicketNavigate = useCallback((ticket: Ticket) => {
    navigate(`/tickets/board/${ticket.boardId}/ticket/${ticket.id}`);
  }, [navigate]);

  const handleImportIssue = useCallback(async (item: DashboardItem, boardId: string) => {
    const key = `${item.org}/${item.name}#${item.number}`;
    if (importingKey) return;
    setImportingKey(key);
    try {
      await importGitHubIssue(item.org, item.name, item.number, boardId);
      await fetchDash();
    } catch {
      // handled by api layer
    } finally {
      setImportingKey(null);
    }
  }, [importingKey, fetchDash]);

  const handleImportPR = useCallback(async (item: DashboardItem, boardId: string) => {
    const key = `${item.org}/${item.name}#${item.number}`;
    if (importingKey || !isPR(item)) return;
    setImportingKey(key);
    try {
      await importGitHubPR(item.org, item.name, item.number, item.title, item.headRefName, boardId);
      await fetchDash();
    } catch {
      // handled by api layer
    } finally {
      setImportingKey(null);
    }
  }, [importingKey, fetchDash]);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: KEYFRAMES }} />
      <div className="flex h-full min-w-0 flex-1 flex-col overflow-y-auto bg-[var(--theme-bg-base)]">
        <div className="flex w-full flex-col gap-5 px-6 py-6">

          {/* ── Header ── */}
          <div
            className="flex items-center justify-between"
            style={{ animation: 'dashFadeIn 0.4s ease-out both' }}
          >
            <div className="flex flex-col gap-0.5">
              <h1 className="text-lg font-semibold text-[var(--theme-text-primary)]">
                {getGreeting()}{humanDisplayName ? ` ${humanDisplayName}` : ''}
              </h1>
              <span className="text-xs text-[var(--theme-text-muted)]">
                {getTodayFrench()}
              </span>
            </div>
            <SyncToolbar />
          </div>

          {/* ── Loading skeleton ── */}
          {loading && !data && (
            <div className="flex flex-col gap-5">
              <SectionShell>
                <div className="mb-3 h-4 w-24 rounded bg-[var(--theme-bg-hover)]" />
                <SkeletonBlock lines={3} />
              </SectionShell>
              <SectionShell delay={100}>
                <div className="mb-3 h-4 w-32 rounded bg-[var(--theme-bg-hover)]" />
                <SkeletonBlock lines={3} />
              </SectionShell>
            </div>
          )}

          {/* ── Loaded content ── */}
          {data && (
            <div className="flex flex-col gap-5">

              {/* ── AGENT ACTIVITY ── */}
              {(recentActivity.length > 0 || totalUnread > 0) && (
                <SectionShell delay={0}>
                  <SectionHeader
                    icon={<span className="text-purple-400"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M8 1l1.5 4.5L14 7l-4.5 1.5L8 13l-1.5-4.5L2 7l4.5-1.5L8 1z" /></svg></span>}
                    title="Agent Activity"
                    count={recentActivity.length}
                    subtitle={totalUnread > 0 ? `${totalUnread} unread` : undefined}
                  />
                  {recentActivity.length > 0 ? (
                    <div className="flex flex-col gap-1">
                      {recentActivity.map((a) => (
                        <button
                          key={a.id}
                          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-[var(--theme-bg-hover)]"
                          onClick={() => {
                            const ticket = storeTickets.find((t) => t.id === a.ticketId);
                            if (ticket) {
                              navigate('/tickets');
                              setTimeout(() => useTicketStore.getState().selectTicket(ticket.id), 100);
                            }
                          }}
                        >
                          <span className={cn(
                            'h-1.5 w-1.5 flex-shrink-0 rounded-full',
                            a.status === 'completed' ? 'bg-green-400' : a.status === 'failed' ? 'bg-red-400' : 'bg-yellow-400',
                          )} />
                          <span className="font-medium text-purple-400">{a.personaName}</span>
                          <span className="text-[var(--theme-text-muted)]">
                            {a.status === 'completed' ? 'finished' : a.status === 'failed' ? 'failed' : 'interrupted'}
                          </span>
                          <span className="min-w-0 truncate text-[var(--theme-text-secondary)]">{a.ticketTitle}</span>
                          <span className="ml-auto flex-shrink-0 text-[var(--theme-text-faint)]">
                            {timeAgo(a.completedAt ?? a.startedAt)}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-[var(--theme-text-muted)]">
                      {totalUnread} unread items across your tickets
                    </p>
                  )}
                </SectionShell>
              )}

              {/* ── ISSUES ── */}
              <GithubSection
                title="Remote Issues"
                icon={<BugIcon />}
                kind="issue"
                leftItems={data.myIssues}
                rightItems={data.assignedIssues}
                allTickets={allTickets}
                sessions={sessions}
                sessionGroups={sessionGroups}
                worktrees={data.activeWorktrees}
                boards={boards}
                allPullRequests={allPullRequests}
                onImport={handleImportIssue}
                importingKey={importingKey}
                onStatusChange={handleStatusChange}
                onNavigate={handleTicketNavigate}
                delay={80}
                emptyMessage="Inbox zero ! Soit t'es une machine, soit personne t'assigne de travail. Hmm."
              />

              {/* ── PULL REQUESTS ── */}
              <GithubSection
                title="Pull Requests"
                icon={<GitPrIcon />}
                kind="pr"
                leftItems={data.myPullRequests}
                rightItems={data.reviewRequests}
                allTickets={allTickets}
                sessions={sessions}
                sessionGroups={sessionGroups}
                worktrees={data.activeWorktrees}
                boards={boards}
                allPullRequests={allPullRequests}
                onImport={handleImportPR}
                importingKey={importingKey}
                onStatusChange={handleStatusChange}
                onNavigate={handleTicketNavigate}
                delay={160}
                emptyMessage="Aucune PR ouverte. Ship it !"
              />

            </div>
          )}
        </div>
      </div>
    </>
  );
}
