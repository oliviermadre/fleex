import { useMemo } from 'react';
import type { Board, AgentActivityState, Ticket, TicketLink, TicketUnreadCounts } from '@fleex/shared';
import { ActivityBadge } from './ActivityBadge';
import { PriorityPickerPopover } from '../tickets/PriorityPickerPopover';
import { TypePickerPopover } from '../tickets/TypePickerPopover';
import { DueDateBadge } from '../tickets/DueDateBadge';
import { CommentIcon, DeliverableIcon } from './icons';
import { SmartSessionButton } from '../dashboard/SmartSessionButton';
import { findSessionsForTicketId } from '../dashboard/dashboard-helpers';
import { useSessionStore } from '../../stores/sessionStore';
import { executeSkill } from '../../services/api';
import type { InspectorFocus } from '../../stores/listFocusStore';
import { cn } from '../../lib/cn';
import { tintClasses } from '../../lib/tints';
import { PrBadge } from '../ui/PrBadge';
import { parseGithubPrRef } from '../../lib/prRef';

/**
 * Shared column widths so the header labels line up with each row. Kept in one
 * place because the header (in ListFocusView) and every row must agree.
 *
 * Pass 7 column order: id · blocked+★+priority pictos · type · title ·
 * activity badge (waiting/running/idle since) · board · PR · count badges ·
 * SmartSessionButton. Leading columns are deliberately tight (narrow id,
 * gap-1.5 row) to free the width the session button needs at line end; type,
 * activity, board and PR are centered in their cells (pass 8).
 */
export const LIST_FOCUS_COL = {
  // w-9: fits "#1234" in 11px mono — pass 8 shrank it one more notch (from w-10)
  // to close the gap NaS flagged between the id and the first (blocked) picto.
  id: 'w-9 shrink-0',
  // Three always-visible fixed-size pictos: blocked · ★ · priority (pass 7).
  pictos: 'w-14 shrink-0',
  // w-14 (was w-16): the type badge is centered (pass 8) so a tighter slot both
  // densifies the type↔title spacing and keeps the badge visually centered.
  type: 'w-14 shrink-0',
  main: 'min-w-0 flex-1',
  // w-32: fits "Waiting for 59s" on one line — a wrapped badge is forbidden
  // (pass 6); the pill itself is also whitespace-nowrap.
  activity: 'w-32 shrink-0',
  board: 'w-[120px] shrink-0',
  pr: 'w-[92px] shrink-0',
  badge: 'w-11 shrink-0',
  // Matches SmartSessionButton's fixed BUTTON_WIDTH (w-[108px]).
  session: 'w-[108px] shrink-0',
} as const;

function CountBadge({
  icon,
  total,
  unread,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  total: number;
  unread: number;
  label: string;
  onClick: () => void;
}) {
  const title = unread > 0 ? `${total} ${label}, ${unread} unread` : `${total} ${label}`;
  // Clamp the visible count to "99+" so the badge stays mono-line in its narrow
  // column (pass 8) — the true total lives on in the tooltip.
  const display = total > 99 ? '99+' : String(total);
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        'relative inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1 py-0.5 text-[11px] tabular-nums transition-colors hover:bg-[var(--theme-bg-hover)]',
        unread > 0 ? 'text-[var(--theme-text-secondary)]' : 'text-[var(--theme-text-muted)]',
      )}
    >
      {icon}
      <span>{display}</span>
      {unread > 0 && (
        <span className="absolute right-0 top-0.5 h-1.5 w-1.5 rounded-full bg-[var(--theme-accent-active)]" />
      )}
    </button>
  );
}

interface Props {
  ticket: Ticket;
  board?: Board;
  activity: AgentActivityState;
  detail?: string;
  /** Last SDK activity for the "idle for {{age}}" badge (pass 4, remark 5). */
  lastActivityAt?: string | null;
  /** Start of the current waiting/running state ("Waiting for 2h", pass 5). */
  since?: string | null;
  unread: TicketUnreadCounts;
  prStates: Record<string, string>;
  selected: boolean;
  onOpen: (focus?: InspectorFocus) => void;
  onToggleFavorite: () => void;
  onToggleBlocked: () => void;
}

export function ListFocusRow({
  ticket,
  board,
  activity,
  detail,
  lastActivityAt,
  since,
  unread,
  prStates,
  selected,
  onOpen,
  onToggleFavorite,
  onToggleBlocked,
}: Props) {
  const prLinks = ticket.links.filter((l: TicketLink) => l.type === 'github_pr');
  const sessionGroups = useSessionStore((s) => s.sessionGroups);
  // Same session resolution as KanbanCard so the quick-action button shows the
  // exact same state on both surfaces.
  const ticketSessions = useMemo(
    () => findSessionsForTicketId(ticket.id, sessionGroups),
    [ticket.id, sessionGroups],
  );

  return (
    <div
      role="button"
      tabIndex={0}
      aria-current={selected}
      onClick={() => onOpen()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        // gap-1.5 (pass 8, was gap-2): one more notch of densification across
        // the leading columns — NaS "on peut encore gagner quelques px".
        'group flex cursor-pointer items-center gap-1.5 border-l-2 px-3 py-2 text-left transition-colors',
        selected
          ? 'border-[var(--theme-accent)] bg-[var(--theme-bg-hover)]'
          : 'border-transparent hover:bg-[var(--theme-bg-hover)]',
      )}
    >
      {/* Id */}
      <div className={cn(LIST_FOCUS_COL.id, 'font-mono text-[11px] tabular-nums text-[var(--theme-text-muted)]')}>
        #{ticket.displayId}
      </div>

      {/* Blocked + favorite ★ + priority pictos in a fixed column. Pass 7:
          every picto is ALWAYS visible with its real state (no hover-reveal),
          in fixed-size slots so the columns align across rows. Toggles are the
          same actions as the kanban card; priority is the same click-to-change
          picker (pass 3, remark 5). */}
      <div className={cn(LIST_FOCUS_COL.pictos, 'flex items-center gap-0.5')}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleBlocked();
          }}
          title={ticket.blocked ? 'Unblock ticket' : 'Mark as blocked'}
          className={cn(
            'shrink-0 rounded p-0.5 transition-all',
            ticket.blocked
              ? cn('opacity-100', tintClasses('red').solidText)
              : 'text-[var(--theme-text-faint)] opacity-60 hover:opacity-100',
          )}
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
            <rect x="3" y="7" width="10" height="8" rx="1.5" />
            <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
          </svg>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite();
          }}
          title={ticket.favorite ? 'Remove from favorites' : 'Add to favorites'}
          className={cn(
            'shrink-0 rounded p-0.5 transition-all',
            ticket.favorite
              ? cn('opacity-100', tintClasses('yellow').solidText)
              : cn(
                  'text-[var(--theme-text-faint)] opacity-60 hover:opacity-100',
                  tintClasses('yellow').hoverText,
                ),
          )}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill={ticket.favorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
            <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
          </svg>
        </button>
        <PriorityPickerPopover ticket={ticket} />
      </div>

      {/* Type in its own column between priority and title (pass 3, remark 3),
          clickable to change it — same picker as the kanban card (remark 5).
          Centered in its cell (pass 8). */}
      <div className={cn(LIST_FOCUS_COL.type, 'flex justify-center')}>
        <TypePickerPopover ticket={ticket} />
      </div>

      {/* Title + due date. */}
      <div className={cn(LIST_FOCUS_COL.main, 'flex items-center gap-2')}>
        <span className="truncate text-sm font-medium text-[var(--theme-text-primary)]">
          {ticket.title}
        </span>
        <DueDateBadge dueDate={ticket.dueDate} status={ticket.status} />
      </div>

      {/* Activity badge column, right after the title (pass 4, remark 5):
          Waiting/Running/idle, each with its live duration (pass 5). Centered
          in its cell (pass 8). */}
      <div className={cn(LIST_FOCUS_COL.activity, 'flex justify-center')}>
        <ActivityBadge
          activity={activity}
          detail={detail}
          lastActivityAt={lastActivityAt}
          since={since}
        />
      </div>

      {/* Board — between the title block and the PR column (pass 4, remark 2).
          Centered in its cell (pass 8). */}
      <div className={cn(LIST_FOCUS_COL.board, 'flex justify-center')}>
        {board && (
          <span className="inline-block max-w-full truncate rounded bg-[var(--theme-bg-overlay)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--theme-text-muted)]">
            {board.emoji} {board.name}
          </span>
        )}
      </div>

      {/* PR (v1 = PR state only) — centered in its cell (pass 8). */}
      <div className={cn(LIST_FOCUS_COL.pr, 'flex items-center justify-center gap-1')}>
        {prLinks.map((pr: TicketLink) => {
          const parsed = parseGithubPrRef(pr.ref);
          if (!parsed) return null;
          const state = (prStates[pr.ref]?.toLowerCase() ?? 'open') as 'open' | 'merged' | 'closed';
          return (
            <PrBadge
              key={pr.id}
              org={parsed.org}
              name={parsed.name}
              pr={{ number: parsed.number, state, title: pr.ref }}
              href={pr.url ?? undefined}
            />
          );
        })}
      </div>

      {/* Comments badge */}
      <div className={cn(LIST_FOCUS_COL.badge, 'flex justify-center')}>
        <CountBadge
          icon={<CommentIcon />}
          total={unread.totalComments}
          unread={unread.unreadComments}
          label="comments"
          onClick={() => onOpen('comments')}
        />
      </div>

      {/* Deliverables badge */}
      <div className={cn(LIST_FOCUS_COL.badge, 'flex justify-center')}>
        <CountBadge
          icon={<DeliverableIcon />}
          total={unread.totalDeliverables}
          unread={unread.unreadDeliverables}
          label="deliverables"
          onClick={() => onOpen('deliverables')}
        />
      </div>

      {/* SmartSessionButton — the quick-action launcher, at line end (pass 7).
          Same props as the kanban card: sessions / skills / workflows. */}
      <div
        className={cn(LIST_FOCUS_COL.session, 'flex justify-end')}
        onClick={(e) => e.stopPropagation()}
      >
        <SmartSessionButton
          sessions={ticketSessions}
          ticketId={ticket.id}
          onExecuteSkill={(skillId) => executeSkill(skillId, ticket.id)}
        />
      </div>
    </div>
  );
}
