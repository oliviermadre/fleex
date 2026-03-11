import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type {
  Ticket,
  TicketStatus,
  Session,
  DashboardData,
  DashboardPullRequest,
  DashboardWorktree,
  DashboardGitHubIssue,
} from '@fleex/shared';
import { fetchDashboard, fetchBoards, importGitHubIssue, openSessionFromTicket, createWorktree, createSession, executeSkill } from '../../services/api';
import { useSessionStore } from '../../stores/sessionStore';
import { useTicketStore } from '../../stores/ticketStore';
import { useUIStore } from '../../stores/uiStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { cn } from '../../lib/cn';
import { SmartSessionButton } from './SmartSessionButton';
import { PriorityPickerPopover } from '../tickets/PriorityPickerPopover';
import { findSessionsForTicket, findSessionsForPR, hasLocalWorktreeForPR } from './dashboard-helpers';

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

function formatDueDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const due = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (diffDays < 0) return `${Math.abs(diffDays)}j en retard`;
  if (diffDays === 0) return "Aujourd'hui";
  if (diffDays === 1) return 'Demain';
  if (diffDays <= 7) return `${diffDays}j`;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function isDueDateOverdue(dateStr: string): boolean {
  const d = new Date(dateStr);
  const now = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()) < new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

const STATUS_DOT: Record<string, { color: string; pulse: boolean; label: string }> = {
  backlog: { color: 'var(--theme-text-faint)', pulse: false, label: 'Backlog' },
  todo: { color: '#60a5fa', pulse: false, label: 'A faire' },
  doing: { color: '#f59e0b', pulse: true, label: 'En cours' },
  reviewing: { color: '#a78bfa', pulse: false, label: 'En review' },
  done: { color: '#22c55e', pulse: false, label: 'Done' },
};

const INLINE_STATUSES: { value: TicketStatus; label: string }[] = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'todo', label: 'A faire' },
  { value: 'doing', label: 'En cours' },
  { value: 'reviewing', label: 'En review' },
  { value: 'done', label: 'Done' },
];

const STATUS_ORDER: Array<'doing' | 'reviewing' | 'todo'> = ['todo', 'doing', 'reviewing'];

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
  dotColor,
  title,
  count,
  subtitle,
  toolbar,
}: {
  dotColor: string;
  title: string;
  count: number;
  subtitle?: string;
  toolbar?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-col gap-0.5">
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: dotColor }}
        />
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--theme-text-secondary)]">
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
        <span className="ml-4 text-[10px] text-[var(--theme-text-faint)]">{subtitle}</span>
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

function InboxIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1.5" y="2" width="13" height="12" rx="2" />
      <path d="M1.5 10h4l1 2h3l1-2h4" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6" />
      <polyline points="5.5,8 7,9.5 10.5,6" />
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

function CoffeeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 5h8v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5z" />
      <path d="M11 6h1a2 2 0 0 1 0 4h-1" />
      <line x1="2" y1="15" x2="12" y2="15" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 1l1.5 4.5L14 7l-4.5 1.5L8 13l-1.5-4.5L2 7l4.5-1.5L8 1z" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2h8v8" />
      <line x1="14" y1="2" x2="6" y2="10" />
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

function LinkIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6.5 9.5l3-3" />
      <path d="M9 6.5l1.5-1.5a2.12 2.12 0 0 1 3 3L12 9.5" />
      <path d="M7 9.5L5.5 11a2.12 2.12 0 0 1-3-3L4 6.5" />
    </svg>
  );
}

// ── Ticket Card ──────────────────────────────────────────────────────────────

function TicketCard({
  ticket,
  boardLabel,
  sessions,
  onStatusChange,
  onNavigate,
  onCreateSession,
  creating,
  hasRepo,
}: {
  ticket: Ticket;
  boardLabel?: { name: string; emoji: string };
  sessions: Session[];
  onStatusChange: (ticketId: string, newStatus: TicketStatus) => void;
  onNavigate: (ticket: Ticket) => void;
  onCreateSession: (ticketId: string) => void;
  creating: boolean;
  hasRepo: boolean;
}) {
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const statusMenuRef = useRef<HTMLDivElement>(null);
  const updateTicket = useTicketStore.getState().updateTicket;

  useEffect(() => {
    if (!statusMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (statusMenuRef.current && !statusMenuRef.current.contains(e.target as Node)) {
        setStatusMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [statusMenuOpen]);

  const repoLink = ticket.links.find((l) => l.type === 'repository' || l.type === 'worktree');
  const repoLabel = repoLink
    ? repoLink.type === 'worktree'
      ? repoLink.ref.split(':')[0]
      : repoLink.ref
    : null;

  // Extract branch from worktree link
  const wtLink = ticket.links.find((l) => l.type === 'worktree');
  const branchName = wtLink ? wtLink.ref.split(':')[1] : null;

  const statusDot = STATUS_DOT[ticket.status];

  return (
    <button
      className="group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-all duration-150 hover:bg-[var(--theme-bg-hover)]"
      onClick={() => onNavigate(ticket)}
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
        <div className="flex items-center gap-2 text-xs text-[var(--theme-text-muted)]">
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
                  backgroundColor: statusDot?.color ?? '#60a5fa',
                  animation: statusDot?.pulse ? 'dashPulse 2s ease-in-out infinite' : 'none',
                }}
              />
              {statusDot?.label ?? ticket.status}
            </span>
            {statusMenuOpen && (
              <div className="absolute left-0 top-full z-50 mt-1 min-w-[120px] rounded-lg border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-surface)] py-1 shadow-lg">
                {INLINE_STATUSES.map((s) => (
                  <button
                    key={s.value}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-[var(--theme-bg-hover)]',
                      ticket.status === s.value && 'font-semibold text-[var(--theme-accent)]',
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (ticket.status !== s.value) {
                        onStatusChange(ticket.id, s.value);
                      }
                      setStatusMenuOpen(false);
                    }}
                  >
                    <span
                      className="inline-block h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: STATUS_DOT[s.value]?.color }}
                    />
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {boardLabel && (
            <span className="truncate rounded bg-[var(--theme-bg-overlay)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--theme-text-muted)]">
              {boardLabel.emoji} {boardLabel.name}
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
          {ticket.dueDate && (
            <span
              className={cn(
                'whitespace-nowrap',
                isDueDateOverdue(ticket.dueDate) && 'text-red-400',
              )}
            >
              {formatDueDate(ticket.dueDate)}
            </span>
          )}
        </div>
      </div>

      {/* SmartSessionButton */}
      <span
        className="flex-shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <SmartSessionButton
          sessions={sessions}
          creating={creating}
          onCreateSession={() => onCreateSession(ticket.id)}
          disabled={!hasRepo}
          ticketId={ticket.id}
          onExecuteSkill={(skillId) => executeSkill(skillId, ticket.id).catch(console.error)}
        />
      </span>
    </button>
  );
}

// ── GitHub Issue Row ─────────────────────────────────────────────────────────

function GitHubIssueRow({
  issue,
  tickets,
  onImport,
  onLinkToTicket,
  importing,
}: {
  issue: DashboardGitHubIssue;
  tickets: Ticket[];
  onImport: (issue: DashboardGitHubIssue) => void;
  onLinkToTicket: (issue: DashboardGitHubIssue, ticketId: string) => void;
  importing: boolean;
}) {
  const navigate = useNavigate();
  const [linkSelectorOpen, setLinkSelectorOpen] = useState(false);
  const selectorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!linkSelectorOpen) return;
    const handler = (e: MouseEvent) => {
      if (selectorRef.current && !selectorRef.current.contains(e.target as Node)) {
        setLinkSelectorOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [linkSelectorOpen]);

  const linkableTickets = tickets.filter(
    (t) => t.status === 'todo' || t.status === 'doing' || t.status === 'reviewing',
  );

  if (issue.hasLocalTicket) {
    // Find the linked ticket to show its title
    const linkedTicket = issue.linkedTicketId
      ? tickets.find((t) => t.id === issue.linkedTicketId)
      : null;

    return (
      <div className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-all duration-150 hover:bg-[var(--theme-bg-hover)]">
        <span className="flex-shrink-0 text-[var(--theme-text-faint)]">
          <CheckCircleIcon />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-sm text-[var(--theme-text-secondary)]">
            {issue.title}
          </span>
          <div className="flex items-center gap-2 text-xs text-[var(--theme-text-faint)]">
            <span>{issue.org}/{issue.name}</span>
            <a
              href={`https://github.com/${issue.org}/${issue.name}/issues/${issue.number}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 transition-colors hover:text-[var(--theme-text-secondary)]"
              onClick={(e) => e.stopPropagation()}
              title="Voir sur GitHub"
            >
              #{issue.number}
              <GitHubIcon size={11} />
            </a>
          </div>
        </div>
        {linkedTicket ? (
          <button
            className="flex flex-shrink-0 items-center gap-1 rounded bg-[var(--theme-bg-overlay)] px-2 py-0.5 text-[10px] font-medium text-[var(--theme-accent)] transition-colors hover:bg-[var(--theme-bg-hover)]"
            onClick={() =>
              navigate(`/tickets/board/${linkedTicket.boardId}/ticket/${linkedTicket.id}`)
            }
          >
            <LinkIcon />
            <span className="max-w-[120px] truncate">{linkedTicket.title}</span>
          </button>
        ) : issue.linkedTicketId ? (
          <button
            className="flex flex-shrink-0 items-center gap-1 rounded bg-[var(--theme-bg-overlay)] px-2 py-0.5 text-[10px] font-medium text-[var(--theme-accent)] transition-colors hover:bg-[var(--theme-bg-hover)]"
            onClick={() => {
              // Navigate to ticket even if we don't have the full object
              // We'll use the ticket panel
              useUIStore.getState().setActivePanel('tickets');
            }}
          >
            <LinkIcon />
            Voir le ticket
          </button>
        ) : (
          <span className="flex-shrink-0 rounded bg-[var(--theme-bg-overlay)] px-2 py-0.5 text-[10px] text-[var(--theme-text-faint)]">
            Importe
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-all duration-150 hover:bg-[var(--theme-bg-hover)]">
      <span className="flex-shrink-0 text-[var(--theme-accent)]">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
        </svg>
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium text-[var(--theme-text-primary)]">
          {issue.title}
        </span>
        <div className="flex items-center gap-2 text-xs text-[var(--theme-text-muted)]">
          <span>{issue.org}/{issue.name}</span>
          <a
            href={`https://github.com/${issue.org}/${issue.name}/issues/${issue.number}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 transition-colors hover:text-[var(--theme-text-secondary)]"
            onClick={(e) => e.stopPropagation()}
            title="Voir sur GitHub"
          >
            #{issue.number}
            <GitHubIcon size={11} />
          </a>
          <span>{timeAgo(issue.createdAt)}</span>
        </div>
      </div>
      <div className="flex flex-shrink-0 items-center gap-1.5">
        {/* Link to existing ticket */}
        <div className="relative" ref={selectorRef}>
          <button
            className={cn(
              'flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium transition-all',
              'text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-overlay)] hover:text-[var(--theme-text-secondary)]',
            )}
            onClick={() => setLinkSelectorOpen(!linkSelectorOpen)}
            title="Lier a un ticket existant"
          >
            <LinkIcon />
            <span className="hidden sm:inline">Lier</span>
          </button>
          {linkSelectorOpen && linkableTickets.length > 0 && (
            <div className="absolute right-0 top-full z-50 mt-1 max-h-[200px] min-w-[220px] overflow-y-auto rounded-lg border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-surface)] py-1 shadow-lg">
              {linkableTickets.map((t) => (
                <button
                  key={t.id}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-[var(--theme-bg-hover)]"
                  onClick={() => {
                    onLinkToTicket(issue, t.id);
                    setLinkSelectorOpen(false);
                  }}
                >
                  <span
                    className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full"
                    style={{ backgroundColor: STATUS_DOT[t.status]?.color ?? '#60a5fa' }}
                  />
                  <span className="truncate text-[var(--theme-text-primary)]">
                    {t.title}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        {/* Import & Start */}
        <button
          className={cn(
            'flex flex-shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
            'bg-[var(--theme-accent)] text-white hover:bg-[var(--theme-accent-hover)] active:bg-[var(--theme-accent-active)]',
            importing && 'pointer-events-none opacity-60',
          )}
          onClick={() => onImport(issue)}
          disabled={importing}
        >
          {importing ? (
            <span className="h-3 w-3 rounded-full border-2 border-white border-t-transparent animate-spin" />
          ) : (
            <SparkleIcon />
          )}
          Import & Start
        </button>
      </div>
    </div>
  );
}

// ── PR Row ───────────────────────────────────────────────────────────────────

function PRRow({
  pr,
  sessions,
  worktrees,
  onCreateSession,
  creating,
}: {
  pr: DashboardPullRequest;
  sessions: Session[];
  worktrees: DashboardWorktree[];
  onCreateSession: (pr: DashboardPullRequest) => void;
  creating: boolean;
}) {
  const navigate = useNavigate();
  const hasWorktree = hasLocalWorktreeForPR(pr, worktrees);

  const handleWorktreeClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Priority 1: last active session for this worktree
    const worktreeKey = `${pr.org}/${pr.name}:${pr.headRefName}`;
    const lastSessionId = useUIStore.getState().lastActiveTabByWorktree[worktreeKey];
    if (lastSessionId) {
      navigate(`/sessions/${lastSessionId}`);
      return;
    }
    // Priority 2: any existing session matching this PR's branch
    if (sessions.length > 0) {
      navigate(`/sessions/${sessions[0]!.id}`);
      return;
    }
    // Priority 3: no session yet — create one (same as clicking "Open")
    onCreateSession(pr);
  };

  return (
    <div className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-all duration-150 hover:bg-[var(--theme-bg-hover)]">
      <span className="flex-shrink-0 text-[var(--theme-text-muted)]">
        <GitPrIcon />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm text-[var(--theme-text-primary)]">
          {pr.title}
        </span>
        <div className="flex items-center gap-2 text-xs text-[var(--theme-text-muted)]">
          <span className="truncate font-mono text-[10px] text-[var(--theme-text-faint)]">
            {pr.headRefName}
          </span>
          {hasWorktree && (
            <button
              className="flex items-center gap-0.5 rounded bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-medium text-cyan-400 transition-colors hover:bg-cyan-500/20"
              onClick={handleWorktreeClick}
              title="Ouvrir la session"
            >
              <GitBranchIcon />
              worktree
            </button>
          )}
          <a
            href={`https://github.com/${pr.org}/${pr.name}/pull/${pr.number}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[var(--theme-text-faint)] transition-colors hover:text-[var(--theme-text-secondary)]"
            onClick={(e) => e.stopPropagation()}
            title="Voir sur GitHub"
          >
            <GitHubIcon size={11} />
          </a>
        </div>
      </div>
      <div className="flex flex-shrink-0 items-center gap-1.5">
        <span className="text-xs text-[var(--theme-text-faint)]">
          {timeAgo(pr.updatedAt)}
        </span>
        <span className="flex-shrink-0">
          <SmartSessionButton
            sessions={sessions}
            creating={creating}
            onCreateSession={() => onCreateSession(pr)}
          />
        </span>
      </div>
    </div>
  );
}

// ── PR Section with grouping & filter ────────────────────────────────────────

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

function PRToolbar({
  repos,
  repoFilter,
  setRepoFilter,
  sortOrder,
  setSortOrder,
}: {
  repos: string[];
  repoFilter: string;
  setRepoFilter: (v: string) => void;
  sortOrder: 'recent' | 'oldest';
  setSortOrder: (v: 'recent' | 'oldest') => void;
}) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!filterOpen && !sortOpen) return;
    const handler = (e: MouseEvent) => {
      if (filterOpen && filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false);
      if (sortOpen && sortRef.current && !sortRef.current.contains(e.target as Node)) setSortOpen(false);
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setFilterOpen(false); setSortOpen(false); }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, [filterOpen, sortOpen]);

  const isFilterActive = repoFilter !== 'all';

  return (
    <div className="flex items-center gap-1">
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

function PRSection({
  title,
  dotColor,
  prs,
  sessions,
  worktrees,
  delay,
  onCreateSession,
  creatingPR,
  emptyMessage,
}: {
  title: string;
  dotColor: string;
  prs: DashboardPullRequest[];
  sessions: Session[];
  worktrees: DashboardWorktree[];
  delay: number;
  onCreateSession: (pr: DashboardPullRequest) => void;
  creatingPR: string | null;
  emptyMessage: string;
}) {
  const [repoFilter, setRepoFilter] = useState<string>('all');
  const [sortOrder, setSortOrder] = useState<'recent' | 'oldest'>('recent');

  // Available repos
  const repos = useMemo(() => {
    const set = new Set(prs.map((pr) => `${pr.org}/${pr.name}`));
    return Array.from(set).sort();
  }, [prs]);

  // Filter + sort
  const filteredPRs = useMemo(() => {
    let result = repoFilter === 'all'
      ? prs
      : prs.filter((pr) => `${pr.org}/${pr.name}` === repoFilter);
    result = [...result].sort((a, b) => {
      const diff = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      return sortOrder === 'recent' ? diff : -diff;
    });
    return result;
  }, [prs, repoFilter, sortOrder]);

  // Group by repo
  const grouped = useMemo(() => {
    const map = new Map<string, DashboardPullRequest[]>();
    for (const pr of filteredPRs) {
      const key = `${pr.org}/${pr.name}`;
      const arr = map.get(key);
      if (arr) arr.push(pr);
      else map.set(key, [pr]);
    }
    return Array.from(map.entries());
  }, [filteredPRs]);

  return (
    <SectionShell delay={delay}>
      <SectionHeader
        dotColor={dotColor}
        title={title}
        count={prs.length}
        toolbar={prs.length > 0 ? (
          <PRToolbar
            repos={repos}
            repoFilter={repoFilter}
            setRepoFilter={setRepoFilter}
            sortOrder={sortOrder}
            setSortOrder={setSortOrder}
          />
        ) : undefined}
      />
      {prs.length === 0 ? (
        <EmptyState
          icon={<GitPrIcon />}
          message={emptyMessage}
        />
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {grouped.map(([repoKey, repoPRs]) => (
              <div key={repoKey}>
                {grouped.length > 1 && (
                  <div className="mb-0.5 px-3">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-faint)]">
                      {repoKey}
                    </span>
                  </div>
                )}
                <div className="flex flex-col">
                  {repoPRs.map((pr) => (
                    <PRRow
                      key={`${pr.org}/${pr.name}#${pr.number}`}
                      pr={pr}
                      sessions={findSessionsForPR(pr, sessions)}
                      worktrees={worktrees}
                      onCreateSession={onCreateSession}
                      creating={creatingPR === `${pr.org}/${pr.name}#${pr.number}`}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </SectionShell>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export function DashboardView() {
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [creatingSession, setCreatingSession] = useState<string | null>(null);
  const [importingIssue, setImportingIssue] = useState<string | null>(null);
  const [creatingPRSession, setCreatingPRSession] = useState<string | null>(null);

  // Live data from stores
  const humanDisplayName = useSettingsStore((s) => s.settings.humanDisplayName);
  const sessions = useSessionStore((s) => s.sessions);
  const selectSession = useSessionStore((s) => s.selectSession);
  const storeTickets = useTicketStore((s) => s.tickets);
  const boards = useTicketStore((s) => s.boards);
  const moveTicket = useTicketStore((s) => s.moveTicket);
  const addLink = useTicketStore((s) => s.addLink);

  const boardMap = useMemo(() => {
    const m = new Map<string, { name: string; emoji: string; repositoryOrg: string | null; repositoryName: string | null }>();
    for (const b of boards) m.set(b.id, { name: b.name, emoji: b.emoji, repositoryOrg: b.repositoryOrg ?? null, repositoryName: b.repositoryName ?? null });
    return m;
  }, [boards]);
  const setActivePanel = useUIStore((s) => s.setActivePanel);
  const setFloatingSession = useUIStore((s) => s.setFloatingSession);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const result = await fetchDashboard();
      setData(result);
    } catch {
      // toast handled by api layer
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Use store tickets when available (live), fall back to dashboard data
  const allTickets = storeTickets.length > 0 ? storeTickets : (data?.activeTickets ?? []);

  const handleCreateSession = useCallback(async (ticketId: string) => {
    if (creatingSession) return;
    setCreatingSession(ticketId);
    try {
      const { sessionId } = await openSessionFromTicket(ticketId);
      const tryOpen = () => {
        const session = useSessionStore.getState().sessions.find((s) => s.id === sessionId);
        if (session) {
          setFloatingSession(sessionId);
          setCreatingSession(null);
        } else {
          setTimeout(tryOpen, 300);
        }
      };
      tryOpen();
    } catch {
      setCreatingSession(null);
    }
  }, [creatingSession, setFloatingSession]);

  const handleStatusChange = useCallback(async (ticketId: string, newStatus: TicketStatus) => {
    try {
      await moveTicket(ticketId, newStatus);
      // Refresh dashboard data
      load(true);
    } catch {
      // handled by api layer
    }
  }, [moveTicket, load]);

  const handleImportIssue = useCallback(async (issue: DashboardGitHubIssue) => {
    const key = `${issue.org}/${issue.name}#${issue.number}`;
    if (importingIssue) return;
    setImportingIssue(key);
    try {
      const boards = await fetchBoards();
      const scoped = boards.find(
        (b) => b.repositoryOrg === issue.org && b.repositoryName === issue.name,
      );
      const board = scoped ?? boards[0];
      if (!board) return;
      const ticket = await importGitHubIssue(issue.org, issue.name, issue.number, board.id);
      const { sessionId } = await openSessionFromTicket(ticket.id);
      selectSession(sessionId);
      setActivePanel('sessions');
    } catch {
      // handled by api layer
    } finally {
      setImportingIssue(null);
    }
  }, [importingIssue, selectSession, setActivePanel]);

  const handleLinkToTicket = useCallback(async (issue: DashboardGitHubIssue, ticketId: string) => {
    try {
      await addLink(ticketId, {
        type: 'github_issue',
        ref: `${issue.org}/${issue.name}#${issue.number}`,
        label: issue.title,
      });
      // Refresh to update hasLocalTicket
      load(true);
    } catch {
      // handled by api layer
    }
  }, [addLink, load]);

  const handleTicketNavigate = useCallback((ticket: Ticket) => {
    navigate(`/tickets/board/${ticket.boardId}/ticket/${ticket.id}`);
  }, [navigate]);

  const handleCreatePRSession = useCallback(async (pr: DashboardPullRequest) => {
    const key = `${pr.org}/${pr.name}#${pr.number}`;
    if (creatingPRSession) return;
    setCreatingPRSession(key);
    try {
      // Check if worktree already exists
      const existingWt = data?.activeWorktrees.find(
        (wt) => wt.branch === pr.headRefName && wt.org === pr.org && wt.name === pr.name,
      );
      let cwd: string;
      if (existingWt) {
        cwd = existingWt.path;
      } else {
        const { path } = await createWorktree(pr.org, pr.name, {
          branch: pr.headRefName,
          createNewBranch: false,
          prNumber: pr.number,
        });
        cwd = path;
      }
      const session = await createSession({ type: 'claude', cwd });
      selectSession(session.id);
      setActivePanel('sessions');
    } catch {
      // handled by api layer
    } finally {
      setCreatingPRSession(null);
    }
  }, [creatingPRSession, data?.activeWorktrees, selectSession, setActivePanel]);

  // Group tickets by status
  const ticketsByStatus = data
    ? STATUS_ORDER.reduce<Record<string, Ticket[]>>((acc, status) => {
        const filtered = data.activeTickets.filter((t: Ticket) => t.status === status);
        if (filtered.length > 0) acc[status] = filtered;
        return acc;
      }, {})
    : {};

  const totalActiveTickets = data?.activeTickets.length ?? 0;
  const unimportedIssues = data?.assignedIssues.filter((i: DashboardGitHubIssue) => !i.hasLocalTicket) ?? [];
  const importedIssues = data?.assignedIssues.filter((i: DashboardGitHubIssue) => i.hasLocalTicket) ?? [];
  const totalIssues = data?.assignedIssues.length ?? 0;

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
            <button
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all',
                'text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]',
                refreshing && 'pointer-events-none opacity-60',
              )}
              onClick={() => load(true)}
              disabled={refreshing}
            >
              <RefreshIcon spinning={refreshing} />
              Rafraichir
            </button>
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
                <SkeletonBlock lines={2} />
              </SectionShell>
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <SectionShell delay={200}>
                  <div className="mb-3 h-4 w-28 rounded bg-[var(--theme-bg-hover)]" />
                  <SkeletonBlock lines={2} />
                </SectionShell>
                <SectionShell delay={300}>
                  <div className="mb-3 h-4 w-20 rounded bg-[var(--theme-bg-hover)]" />
                  <SkeletonBlock lines={2} />
                </SectionShell>
              </div>
            </div>
          )}

          {/* ── Loaded content ── */}
          {data && (
            <div className="flex flex-col gap-5">

              {/* ── MY WORK ── */}
              <SectionShell delay={0}>
                <SectionHeader
                  dotColor="#f59e0b"
                  title="Mon travail"
                  count={totalActiveTickets}
                />
                {totalActiveTickets === 0 ? (
                  <EmptyState
                    icon={<CoffeeIcon />}
                    message="RAS, profite. Ou alors va checker GitHub parce que c'est louche quand meme."
                  />
                ) : (
                  <div className="flex flex-col gap-3">
                    {STATUS_ORDER.map((status) => {
                      const tickets = ticketsByStatus[status];
                      if (!tickets || tickets.length === 0) return null;
                      const dot = STATUS_DOT[status]!;
                      return (
                        <div key={status}>
                          <div className="mb-1 flex items-center gap-2 px-3">
                            <span
                              className="inline-block h-1.5 w-1.5 rounded-full"
                              style={{
                                backgroundColor: dot.color,
                                animation: dot.pulse ? 'dashPulse 2s ease-in-out infinite' : 'none',
                              }}
                            />
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-faint)]">
                              {dot.label}
                            </span>
                            <span className="text-[10px] text-[var(--theme-text-faint)]">
                              {tickets.length}
                            </span>
                          </div>
                          <div className="flex flex-col">
                            {tickets.map((t: Ticket) => {
                              const board = boardMap.get(t.boardId);
                              const hasRepo = !!t.links.find(l => l.type === 'repository' || l.type === 'worktree')
                                || !!(board?.repositoryOrg && board?.repositoryName);
                              return (
                                <TicketCard
                                  key={t.id}
                                  ticket={t}
                                  boardLabel={board}
                                  sessions={findSessionsForTicket(t, sessions)}
                                  onStatusChange={handleStatusChange}
                                  onNavigate={handleTicketNavigate}
                                  onCreateSession={handleCreateSession}
                                  creating={creatingSession === t.id}
                                  hasRepo={hasRepo}
                                />
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </SectionShell>

              {/* ── GITHUB INBOX ── */}
              <SectionShell delay={80}>
                <SectionHeader
                  dotColor="var(--theme-accent)"
                  title="GitHub Inbox"
                  count={totalIssues}
                  subtitle="Issues assignees sur GitHub"
                />
                {totalIssues === 0 ? (
                  <EmptyState
                    icon={<InboxIcon />}
                    message="Inbox zero ! Soit t'es une machine, soit personne t'assigne de travail. Hmm."
                  />
                ) : (
                  <div className="flex flex-col">
                    {unimportedIssues.map((issue: DashboardGitHubIssue) => (
                      <GitHubIssueRow
                        key={`${issue.org}/${issue.name}#${issue.number}`}
                        issue={issue}
                        tickets={allTickets}
                        onImport={handleImportIssue}
                        onLinkToTicket={handleLinkToTicket}
                        importing={importingIssue === `${issue.org}/${issue.name}#${issue.number}`}
                      />
                    ))}
                    {importedIssues.map((issue: DashboardGitHubIssue) => (
                      <GitHubIssueRow
                        key={`${issue.org}/${issue.name}#${issue.number}`}
                        issue={issue}
                        tickets={allTickets}
                        onImport={handleImportIssue}
                        onLinkToTicket={handleLinkToTicket}
                        importing={false}
                      />
                    ))}
                  </div>
                )}
              </SectionShell>

              {/* ── PULL REQUESTS + REVIEWS ── */}
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <PRSection
                  title="Pull Requests"
                  dotColor="#22c55e"
                  prs={data.myPullRequests}
                  sessions={sessions}
                  worktrees={data.activeWorktrees}
                  delay={160}
                  onCreateSession={handleCreatePRSession}
                  creatingPR={creatingPRSession}
                  emptyMessage="Aucune PR ouverte. Ship it !"
                />
                <PRSection
                  title="Reviews"
                  dotColor="#a78bfa"
                  prs={data.reviewRequests}
                  sessions={sessions}
                  worktrees={data.activeWorktrees}
                  delay={240}
                  onCreateSession={handleCreatePRSession}
                  creatingPR={creatingPRSession}
                  emptyMessage="Personne a besoin de ton avis. Enfin, pour l'instant."
                />
              </div>

            </div>
          )}
        </div>
      </div>
    </>
  );
}
