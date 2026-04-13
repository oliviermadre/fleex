import { useMemo } from 'react';
import type { Ticket, TicketLink, BoardWithCounts } from '@fleex/shared';
import { TICKET_TYPE_LABELS } from '@fleex/shared';
import { PriorityPickerPopover } from './PriorityPickerPopover';
import { TYPE_ICONS, TYPE_COLORS } from './TicketTypeBadge';
import { DueDateBadge } from './DueDateBadge';
import { SmartSessionButton } from '../dashboard/SmartSessionButton';
import { findSessionsForTicket } from '../dashboard/dashboard-helpers';
import { useTicketStore } from '../../stores/ticketStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useUnreadStore } from '../../stores/unreadStore';
import { useTicketGroupStore } from '../../stores/ticketGroupStore';
import { executeSkill } from '../../services/api';
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

function formatTimeAgo(dateStr: string, fromMs?: number): string {
  const diff = (fromMs ?? Date.now()) - new Date(dateStr).getTime();
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
  prStates,
}: {
  ticket: Ticket;
  board?: BoardWithCounts | null;
  prStates?: Record<string, string>;
}) {
  const selectTicket = useTicketStore((s) => s.selectTicket);
  const updateTicket = useTicketStore((s) => s.updateTicket);
  const archiveTicket = useTicketStore((s) => s.archiveTicket);
  const sessions = useSessionStore((s) => s.sessions);
  const unread = useUnreadStore((s) => s.getUnread(ticket.id));
  const groups = useTicketGroupStore((s) => s.groups);
  const ticketGroupIds = useTicketGroupStore((s) => s.ticketGroupIds);

  const epicBadges = useMemo(() => {
    const gIds = ticketGroupIds[ticket.id] ?? [];
    if (gIds.length === 0) return [];
    return gIds
      .map((gId) => groups.find((g) => g.id === gId))
      .filter(Boolean)
      .map((g) => ({ id: g!.id, emoji: g!.emoji, name: g!.name }));
  }, [ticket.id, ticketGroupIds, groups]);

  const issueLinks = ticket.links.filter((l: TicketLink) => l.type === 'github_issue');
  const prLinks = ticket.links.filter((l: TicketLink) => l.type === 'github_pr');
  const ticketSessions = useMemo(
    () => findSessionsForTicket(ticket, sessions),
    [ticket, sessions],
  );

  const timeInColumn = formatTimeAgo(ticket.statusChangedAt);
  const isCompleted = ticket.status === 'done' || ticket.status === 'cancelled';

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
      className={`group relative cursor-pointer rounded-lg border transition-colors ${PRIORITY_BORDER[ticket.priority]} ${PRIORITY_LEFT[ticket.priority]} ${PRIORITY_BG[ticket.priority]}`}
    >
      {/* ── HEADER BAR ── priority dot + type emoji (left) | board? | blocked/fav (right) */}
      <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-1">
        {/* Priority dot — top left */}
        <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          <PriorityPickerPopover ticket={ticket} />
        </div>

        {/* Type emoji */}
        {ticket.type && (
          <span
            className={cn(
              'flex-shrink-0 flex items-center justify-center h-5 w-5 rounded text-[11px] leading-none',
              TYPE_COLORS[ticket.type],
            )}
            title={TICKET_TYPE_LABELS[ticket.type] ?? ticket.type}
          >
            {TYPE_ICONS[ticket.type]}
          </span>
        )}

        {/* Board badge (shown in "All boards" view) */}
        {board && (
          <span className="truncate rounded bg-[var(--theme-bg-overlay)] px-1.5 py-0.5 text-[10px] text-[var(--theme-text-muted)]">
            {board.emoji} {board.name}
          </span>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* GitHub issue link */}
        {issueLinks.length > 0 && issueLinks[0]?.url && (
          <a
            href={issueLinks[0].url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="github-glow-icon flex-shrink-0 cursor-pointer rounded p-0.5 text-[var(--theme-text-faint)] transition-all duration-200 hover:text-white"
            title={`GitHub ${issueLinks[0].ref}`}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
          </a>
        )}

        {/* Blocked */}
        {!isCompleted && (
          <button
            className={cn(
              'flex-shrink-0 rounded p-0.5 transition-all',
              ticket.blocked
                ? 'opacity-100 text-red-500 hover:text-red-400'
                : 'opacity-0 group-hover:opacity-60 text-[var(--theme-text-faint)] hover:opacity-100',
            )}
            onClick={(e) => {
              e.stopPropagation();
              updateTicket(ticket.id, { blocked: !ticket.blocked });
            }}
            title={ticket.blocked ? 'Unblock ticket' : 'Mark as blocked'}
          >
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
              <rect x="3" y="7" width="10" height="8" rx="1.5" />
              <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
            </svg>
          </button>
        )}

        {/* Favorite */}
        <button
          className={cn(
            'flex-shrink-0 rounded p-0.5 transition-all',
            ticket.favorite
              ? 'opacity-100 text-yellow-400'
              : 'opacity-0 group-hover:opacity-60 text-[var(--theme-text-faint)] hover:text-yellow-400 hover:opacity-100',
          )}
          onClick={(e) => {
            e.stopPropagation();
            updateTicket(ticket.id, { favorite: !ticket.favorite });
          }}
          title={ticket.favorite ? 'Remove from favorites' : 'Add to favorites'}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill={ticket.favorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
            <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
          </svg>
        </button>

      </div>

      {/* ── TITLE ZONE ── hero element, full width */}
      <div className="px-3 pb-1.5">
        <span className="line-clamp-2 text-sm font-medium leading-snug text-[var(--theme-text-primary)]">
          {ticket.title}
        </span>
      </div>

      {/* ── CHIPS ZONE ── epics + PRs + tags in one flow */}
      {(epicBadges.length > 0 || prLinks.length > 0 || ticket.tags.length > 0) && (
        <div className="flex flex-wrap gap-1 px-3 pb-2">
          {/* Epics */}
          {epicBadges.map((epic) => (
            <span
              key={epic.id}
              className="inline-flex items-center gap-0.5 rounded bg-[var(--theme-bg-overlay)] px-1.5 py-0.5 text-[10px] text-[var(--theme-text-muted)]"
            >
              <span>{epic.emoji}</span>
              <span className="truncate max-w-[80px]">{epic.name}</span>
            </span>
          ))}

          {/* PRs */}
          {prLinks.map((pr: TicketLink) => {
            const state = prStates?.[pr.ref];
            const isMerged = state === 'MERGED';
            const isClosed = state === 'CLOSED';
            const bgClass = isMerged
              ? 'bg-purple-500/15 text-purple-400'
              : isClosed
                ? 'bg-red-500/15 text-red-400'
                : 'bg-green-500/15 text-green-400';
            return (
              <a
                key={pr.id}
                href={pr.url ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className={cn('inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium transition-colors', bgClass)}
              >
                <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" className="flex-shrink-0">
                  <path d="M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218zM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5zm8-8a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5zM4.25 4a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5z" />
                </svg>
                {pr.label}
              </a>
            );
          })}

          {/* Tags */}
          {ticket.tags.slice(0, 3).map((tag: string) => (
            <span
              key={tag}
              className="rounded bg-[var(--theme-bg-overlay)] px-1.5 py-0.5 text-[10px] text-[var(--theme-text-muted)]"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* ── STATUS STRIP ── assignee, unread, due date, session */}
      {!isCompleted && (
        <div className="px-3 pb-1.5 space-y-1.5 text-xs text-[var(--theme-text-muted)]">
          <div className="flex items-center gap-1.5">
            {/* Assignee */}
            {ticket.assignee && (
              ticket.assignee === 'user' ? (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400" title="Me">
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="flex-shrink-0">
                    <rect x="2" y="3" width="12" height="10" rx="1.5" />
                    <circle cx="8" cy="7" r="1.5" />
                    <path d="M5 12c0-1.5 1.3-2.5 3-2.5s3 1 3 2.5" />
                  </svg>
                  <span className="max-w-[50px] truncate">Me</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-medium text-violet-400" title={`Agent: ${ticket.assignee}`}>
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="flex-shrink-0">
                    <rect x="3" y="5" width="10" height="8" rx="1.5" />
                    <path d="M5.5 8.5h1M9.5 8.5h1" />
                    <path d="M6 11h4" />
                    <line x1="8" y1="5" x2="8" y2="2.5" />
                    <circle cx="8" cy="2" r="0.75" />
                  </svg>
                  <span className="max-w-[50px] truncate">{ticket.assignee}</span>
                </span>
              )
            )}
            {unread.unreadComments > 0 && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-[var(--theme-accent)]/15 px-1.5 py-0.5 text-[10px] font-medium text-[var(--theme-accent)]" title={`${unread.unreadComments} unread comments`}>
                <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor"><path d="M2 3.5A1.5 1.5 0 013.5 2h9A1.5 1.5 0 0114 3.5v7a1.5 1.5 0 01-1.5 1.5H5l-3 2.5V3.5z" /></svg>
                {unread.unreadComments}
              </span>
            )}
            {unread.unreadDeliverables > 0 && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-orange-500/15 px-1.5 py-0.5 text-[10px] font-medium text-orange-400" title={`${unread.unreadDeliverables} unseen deliverables`}>
                <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor"><path d="M4 1h8a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1zm1 3h6M5 7h6M5 10h4" /></svg>
                {unread.unreadDeliverables}
              </span>
            )}
            <div className="flex-1" />
            <DueDateBadge dueDate={ticket.dueDate} status={ticket.status} size="sm" />
          </div>

          {/* Session button */}
          <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
            <SmartSessionButton
              sessions={ticketSessions}
              ticketId={ticket.id}
              onExecuteSkill={(skillId) => executeSkill(skillId, ticket.id).catch(console.error)}
            />
          </div>
        </div>
      )}

      {/* ── CARD FOOTER ── cycle time (left) | #ID (center) | time in column (right) */}
      <div className="flex items-center border-t border-[var(--theme-border)]/50 px-3 py-1.5 text-[10px] font-mono text-[var(--theme-text-faint)]">
        {/* Bottom-left: Cycle time */}
        <span className="flex-1 text-left" title={ticket.firstDoingAt ? `Cycle started: ${new Date(ticket.firstDoingAt).toLocaleString(undefined, { hour12: false })}` : 'Not started yet'}>
          {ticket.firstDoingAt ? (
            <>
              <svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="inline -mt-px mr-0.5">
                <circle cx="8" cy="8" r="6.5" />
                <path d="M8 4v4l3 2" />
              </svg>
              {formatTimeAgo(ticket.firstDoingAt, isCompleted ? new Date(ticket.statusChangedAt).getTime() : undefined)}
            </>
          ) : (
            <span className="text-[var(--theme-text-faint)]/50">&mdash;</span>
          )}
        </span>

        {/* Center: Display ID */}
        <span className="flex-shrink-0 text-[var(--theme-text-muted)]">
          #{ticket.displayId}
        </span>

        {/* Bottom-right: Time in column */}
        <span className="flex-1 text-right" title={`In this column since ${new Date(ticket.statusChangedAt).toLocaleString(undefined, { hour12: false })}`}>
          {timeInColumn}
          {isCompleted && (
            <button
              className="ml-1 opacity-0 group-hover:opacity-100 inline-flex rounded p-0.5 text-[var(--theme-text-faint)] hover:text-[var(--theme-text-primary)] transition-all align-middle"
              onClick={(e) => {
                e.stopPropagation();
                archiveTicket(ticket.id);
              }}
              title="Archive ticket"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="5" rx="1" />
                <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
                <path d="M10 12h4" />
              </svg>
            </button>
          )}
        </span>
      </div>
    </div>
  );
}
