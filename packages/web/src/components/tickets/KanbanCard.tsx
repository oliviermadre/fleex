import { useMemo } from 'react';
import type { Ticket, BoardWithCounts } from '@asm/shared';
import { PriorityIndicator } from './PriorityIndicator';
import { useTicketStore } from '../../stores/ticketStore';
import { useSessionStore } from '../../stores/sessionStore';
import { cn } from '../../lib/cn';

const PRIORITY_BORDER: Record<string, string> = {
  none: 'border-[var(--theme-border)] hover:border-[var(--theme-border-input)]',
  low: 'border-[var(--theme-border)] hover:border-blue-500/40',
  medium: 'border-[var(--theme-border)] hover:border-yellow-500/40',
  high: 'border-[var(--theme-border)] hover:border-red-500/50',
};

const PRIORITY_LEFT: Record<string, string> = {
  none: '',
  low: 'border-l-2 !border-l-blue-500/50',
  medium: 'border-l-2 !border-l-yellow-500/50',
  high: 'border-l-2 !border-l-red-500/60',
};

const PRIORITY_BG: Record<string, string> = {
  none: 'bg-[var(--theme-bg-surface)] hover:bg-[var(--theme-bg-hover)]',
  low: 'bg-blue-500/[0.04] hover:bg-blue-500/[0.08]',
  medium: 'bg-yellow-500/[0.04] hover:bg-yellow-500/[0.08]',
  high: 'bg-red-500/[0.05] hover:bg-red-500/[0.09]',
};

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 0) return 'just now';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w`;
}

export function KanbanCard({
  ticket,
  board,
  onOpenSession,
}: {
  ticket: Ticket;
  board?: BoardWithCounts | null;
  onOpenSession: (ticketId: string) => void;
}) {
  const selectTicket = useTicketStore((s) => s.selectTicket);
  const updateTicket = useTicketStore((s) => s.updateTicket);
  const sessions = useSessionStore((s) => s.sessions);

  const issueLinks = ticket.links.filter((l) => l.type === 'github_issue');
  const prLinks = ticket.links.filter((l) => l.type === 'github_pr');
  const worktreeLinks = ticket.links.filter((l) => l.type === 'worktree');
  const sessionLinks = ticket.links.filter((l) => l.type === 'session');

  const repoLinks = ticket.links.filter((l) => l.type === 'repository');

  const repoWorktreeInfo = useMemo(() => {
    const wtLink = worktreeLinks[0];
    if (wtLink) {
      const colonIdx = wtLink.ref.indexOf(':');
      if (colonIdx > 0) {
        const repoKey = wtLink.ref.substring(0, colonIdx);
        const branch = wtLink.ref.substring(colonIdx + 1);
        return { repo: repoKey, branch };
      }
    }
    // Fallback: show repo from repository link (no branch)
    const repoLink = repoLinks[0];
    if (repoLink) {
      return { repo: repoLink.ref, branch: null as string | null };
    }
    return null;
  }, [worktreeLinks, repoLinks]);

  const hasActiveSession = useMemo(() => {
    if (sessionLinks.length > 0) return true;
    if (!repoWorktreeInfo) return false;
    const [org, name] = repoWorktreeInfo.repo.split('/');
    return sessions.some(
      (s) =>
        s.status === 'running' &&
        s.repositoryOrg === org &&
        s.repositoryName === name &&
        s.worktreeBranch === repoWorktreeInfo.branch,
    );
  }, [sessionLinks, repoWorktreeInfo, sessions]);

  // Time spent in current column — based on when the ticket entered this status
  const timeInColumn = formatTimeAgo(ticket.statusChangedAt);

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-ticket-id', ticket.id);
        e.dataTransfer.effectAllowed = 'move';
        (e.currentTarget as HTMLElement).style.opacity = '0.5';
      }}
      onDragEnd={(e) => {
        (e.currentTarget as HTMLElement).style.opacity = '';
      }}
      onClick={() => selectTicket(ticket.id)}
      className={`group relative cursor-pointer rounded-lg border p-3.5 transition-colors ${PRIORITY_BORDER[ticket.priority]} ${PRIORITY_LEFT[ticket.priority]} ${PRIORITY_BG[ticket.priority]}`}
    >
      {/* Favorite star */}
      <button
        className={cn(
          'absolute right-2 top-2 z-10 rounded p-0.5 transition-all',
          ticket.favorite
            ? 'opacity-100 text-yellow-400'
            : 'opacity-0 group-hover:opacity-100 text-[var(--theme-text-faint)] hover:text-yellow-400',
        )}
        onClick={(e) => {
          e.stopPropagation();
          updateTicket(ticket.id, { favorite: !ticket.favorite });
        }}
        title={ticket.favorite ? 'Remove from favorites' : 'Add to favorites'}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill={ticket.favorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
          <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
        </svg>
      </button>

      {/* Board badge (shown in "All boards" view) */}
      {board && (
        <div className="mb-1.5">
          <span className="rounded bg-[var(--theme-bg-overlay)] px-2 py-0.5 text-[11px] text-[var(--theme-text-muted)]">
            {board.emoji} {board.name}
          </span>
        </div>
      )}

      {/* Priority + Lock + Title + GitHub icon */}
      <div className="flex items-start gap-2">
        {/* Left column: priority indicator + blocked lock */}
        <div className="flex flex-col items-center gap-1 flex-shrink-0">
          <PriorityIndicator priority={ticket.priority} size="md" />
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
        <span className="line-clamp-2 flex-1 text-sm font-medium leading-snug text-[var(--theme-text-primary)]">
          {ticket.title}
        </span>
        {issueLinks.length > 0 && issueLinks[0]?.url && (
          <a
            href={issueLinks[0].url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="github-glow-icon flex-shrink-0 cursor-pointer rounded p-0.5 text-[var(--theme-text-muted)] transition-all duration-200 hover:text-white"
            title={`GitHub ${issueLinks[0].ref}`}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
          </a>
        )}
      </div>

      {/* Repo & Worktree info */}
      {repoWorktreeInfo && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-[var(--theme-text-muted)]">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="flex-shrink-0">
            <circle cx="5" cy="3.5" r="1.5" />
            <circle cx="8" cy="12.5" r="1.5" />
            <line x1="5" y1="5" x2="8" y2="11" />
          </svg>
          <span className="truncate">
            <span className="text-[var(--theme-text-faint)]">{repoWorktreeInfo.repo}</span>
            {repoWorktreeInfo.branch && (
              <>
                {' '}
                <span className="font-medium text-[var(--theme-text-secondary)]">{repoWorktreeInfo.branch}</span>
              </>
            )}
          </span>
        </div>
      )}

      {/* PR badges */}
      {prLinks.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {prLinks.map((pr) => (
            <a
              key={pr.id}
              href={pr.url ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 rounded-full bg-purple-500/15 px-2 py-0.5 text-[11px] font-medium text-purple-400 hover:bg-purple-500/25 transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="flex-shrink-0">
                <path d="M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218zM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5zm8-8a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5zM4.25 4a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5z" />
              </svg>
              {pr.label}
            </a>
          ))}
        </div>
      )}

      {/* Tags */}
      {ticket.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {ticket.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="rounded bg-[var(--theme-bg-overlay)] px-2 py-0.5 text-[11px] text-[var(--theme-text-muted)]"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Bottom row: links + time + open session */}
      <div className="mt-2.5 flex items-center gap-2.5 text-xs text-[var(--theme-text-muted)]">
        {sessionLinks.length > 0 && (
          <span className="flex items-center gap-1">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
              <polyline points="4.5,7 6,8.5 4.5,10" />
            </svg>
            {sessionLinks.length}
          </span>
        )}
{ticket.assignee && (
          ticket.agentClaimedAt ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-[11px] font-medium text-violet-400" title={`Agent: ${ticket.assignee}`}>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="flex-shrink-0">
                <rect x="3" y="5" width="10" height="8" rx="1.5" />
                <path d="M5.5 8.5h1M9.5 8.5h1" />
                <path d="M6 11h4" />
                <line x1="8" y1="5" x2="8" y2="2.5" />
                <circle cx="8" cy="2" r="0.75" />
              </svg>
              <span className="max-w-[70px] truncate">{ticket.assignee}</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-400" title={ticket.assignee}>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="flex-shrink-0">
                <rect x="2" y="3" width="12" height="10" rx="1.5" />
                <circle cx="8" cy="7" r="1.5" />
                <path d="M5 12c0-1.5 1.3-2.5 3-2.5s3 1 3 2.5" />
              </svg>
              <span className="max-w-[70px] truncate">{ticket.assignee}</span>
            </span>
          )
        )}

        {/* Time in column */}
        <span className="text-[var(--theme-text-faint)]" title={`In this column since ${new Date(ticket.statusChangedAt).toLocaleString()}`}>
          {timeInColumn}
        </span>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Due date */}
        {ticket.dueDate && (
          <span>
            {new Date(ticket.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </span>
        )}

        {/* Open Session button */}
        <button
          className="flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium transition-colors hover:bg-[var(--theme-bg-overlay)]"
          style={{ color: hasActiveSession ? '#22c55e' : 'var(--theme-text-muted)' }}
          onClick={(e) => {
            e.stopPropagation();
            onOpenSession(ticket.id);
          }}
          title={hasActiveSession ? 'Open active session' : 'Start new session'}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
            <polyline points="4.5,7 6,8.5 4.5,10" />
          </svg>
          {hasActiveSession ? 'Session' : 'Open'}
        </button>
      </div>
    </div>
  );
}
