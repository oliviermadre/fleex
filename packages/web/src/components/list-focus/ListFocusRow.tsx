import type { AgentActivityState, Board, Ticket, TicketLink, TicketStatus, TicketUnreadCounts } from '@fleex/shared';
import { ActivityPill } from '../tickets/ActivityPill';
import { PriorityIndicator } from '../tickets/PriorityIndicator';
import { TicketTypeBadge } from '../tickets/TicketTypeBadge';
import { DueDateBadge } from '../tickets/DueDateBadge';
import { StatusChipDropdown } from './StatusChipDropdown';
import { CommentIcon, DeliverableIcon } from './icons';
import type { InspectorFocus } from '../../stores/listFocusStore';
import { cn } from '../../lib/cn';
import { tint, tintClasses } from '../../lib/tints';

/**
 * Shared column widths so the header labels line up with each row. Kept in one
 * place because the header (in ListFocusView) and every row must agree.
 *
 * Review feedback (#400, pass 2): no dedicated activity column (most rows are
 * idle → a column of "Idle" was noise; running/waiting show as an inline pill),
 * and the board gets its own column instead of a chip squeezed after the title.
 */
export const LIST_FOCUS_COL = {
  id: 'w-14 shrink-0',
  board: 'w-[120px] shrink-0',
  main: 'min-w-0 flex-1',
  pr: 'w-[92px] shrink-0',
  badge: 'w-11 shrink-0',
} as const;

/** "org/repo#123" → "repo#123": the org prefix ate the narrow PR column. */
function stripOrg(label: string): string {
  const slash = label.indexOf('/');
  return slash === -1 ? label : label.slice(slash + 1);
}

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
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        'relative inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] tabular-nums transition-colors hover:bg-[var(--theme-bg-hover)]',
        unread > 0 ? 'text-[var(--theme-text-secondary)]' : 'text-[var(--theme-text-muted)]',
      )}
    >
      {icon}
      <span>{total}</span>
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
  unread: TicketUnreadCounts;
  prStates: Record<string, string>;
  selected: boolean;
  /** True for rows of the virtual waiting group, whose statuses differ per row. */
  showStatus: boolean;
  onOpen: (focus?: InspectorFocus) => void;
  onStatusChange: (status: TicketStatus) => void;
  onToggleFavorite: () => void;
}

export function ListFocusRow({
  ticket,
  board,
  activity,
  detail,
  unread,
  prStates,
  selected,
  showStatus,
  onOpen,
  onStatusChange,
  onToggleFavorite,
}: Props) {
  const prLinks = ticket.links.filter((l: TicketLink) => l.type === 'github_pr');

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
        'group flex cursor-pointer items-center gap-3 border-l-2 px-3 py-2 text-left transition-colors',
        selected
          ? 'border-[var(--theme-accent)] bg-[var(--theme-bg-hover)]'
          : 'border-transparent hover:bg-[var(--theme-bg-hover)]',
      )}
    >
      {/* Id */}
      <div className={cn(LIST_FOCUS_COL.id, 'font-mono text-[11px] tabular-nums text-[var(--theme-text-muted)]')}>
        #{ticket.displayId}
      </div>

      {/* Board (dedicated column, review remark 3) */}
      <div className={LIST_FOCUS_COL.board}>
        {board && (
          <span className="inline-block max-w-full truncate rounded bg-[var(--theme-bg-overlay)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--theme-text-muted)]">
            {board.emoji} {board.name}
          </span>
        )}
      </div>

      {/* Favorite ★ + priority pictos, title, then type / due-date / activity
          metadata (review remark 3). Same star affordance as the kanban card:
          visible when favorited, revealed on row hover otherwise. */}
      <div className={cn(LIST_FOCUS_COL.main, 'flex items-center gap-2')}>
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
                  'opacity-0 text-[var(--theme-text-faint)] group-hover:opacity-60 hover:opacity-100',
                  tintClasses('yellow').hoverText,
                ),
          )}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill={ticket.favorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
            <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
          </svg>
        </button>
        {ticket.priority !== 'none' && <PriorityIndicator priority={ticket.priority} />}
        <span className="truncate text-sm font-medium text-[var(--theme-text-primary)]">
          {ticket.title}
        </span>
        <TicketTypeBadge type={ticket.type} />
        <DueDateBadge dueDate={ticket.dueDate} status={ticket.status} />
        {activity !== 'idle' && <ActivityPill activity={activity} detail={detail} />}
        {showStatus && (
          <StatusChipDropdown status={ticket.status} onChange={onStatusChange} />
        )}
      </div>

      {/* PR (v1 = PR state only) */}
      <div className={cn(LIST_FOCUS_COL.pr, 'flex items-center gap-1')}>
        {prLinks.map((pr: TicketLink) => {
          const state = prStates[pr.ref];
          const hue = state === 'MERGED' ? 'purple' : state === 'CLOSED' ? 'red' : 'green';
          return (
            <a
              key={pr.id}
              href={pr.url ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              title={state ? `${pr.label} — ${state.toLowerCase()}` : pr.label}
              className={cn(
                'inline-flex items-center gap-0.5 truncate rounded-full px-1.5 py-0.5 text-[10px] font-medium transition-colors',
                tint(hue),
              )}
            >
              <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" className="flex-shrink-0">
                <path d="M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218zM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5zm8-8a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5zM4.25 4a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5z" />
              </svg>
              <span className="truncate">{stripOrg(pr.label)}</span>
            </a>
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
    </div>
  );
}
