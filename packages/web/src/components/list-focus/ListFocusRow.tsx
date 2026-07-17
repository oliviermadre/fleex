import type { AgentActivityState, Board, Ticket, TicketLink, TicketStatus, TicketUnreadCounts } from '@fleex/shared';
import { ActivityPill } from '../tickets/ActivityPill';
import { StatusChipDropdown } from './StatusChipDropdown';
import { CommentIcon, DeliverableIcon } from './icons';
import type { InspectorFocus } from '../../stores/listFocusStore';
import { cn } from '../../lib/cn';
import { tint } from '../../lib/tints';

/**
 * Shared column widths so the header labels line up with each row. Kept in one
 * place because the header (in ListFocusView) and every row must agree.
 *
 * Review feedback (#400): one single line per ticket, id first; no dedicated
 * "En attente de" column (waiting is the virtual top group + activity cell) and
 * no status column (the grouping already says it — the chip only shows inline
 * on waiting-group rows whose statuses differ).
 */
export const LIST_FOCUS_COL = {
  id: 'w-14 shrink-0',
  activity: 'w-[92px] shrink-0',
  main: 'min-w-0 flex-1',
  pr: 'w-[92px] shrink-0',
  badge: 'w-11 shrink-0',
} as const;

/** Running/waiting → pill (with detail tooltip); idle → subtle dot+label. */
function ActivityCell({ activity, detail }: { activity: AgentActivityState; detail?: string }) {
  if (activity === 'idle') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-[var(--theme-text-faint)]">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--theme-text-muted)] opacity-50" />
        Idle
      </span>
    );
  }
  return <ActivityPill activity={activity} detail={detail} />;
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
        'flex cursor-pointer items-center gap-3 border-l-2 px-3 py-2 text-left transition-colors',
        selected
          ? 'border-[var(--theme-accent)] bg-[var(--theme-bg-hover)]'
          : 'border-transparent hover:bg-[var(--theme-bg-hover)]',
      )}
    >
      {/* Id */}
      <div className={cn(LIST_FOCUS_COL.id, 'font-mono text-[11px] tabular-nums text-[var(--theme-text-muted)]')}>
        #{ticket.displayId}
      </div>

      {/* Activity */}
      <div className={LIST_FOCUS_COL.activity}>
        <ActivityCell activity={activity} detail={detail} />
      </div>

      {/* Title + board (+ status chip on waiting-group rows only) */}
      <div className={cn(LIST_FOCUS_COL.main, 'flex items-center gap-2')}>
        <span className="truncate text-sm font-medium text-[var(--theme-text-primary)]">
          {ticket.title}
        </span>
        {board && (
          <span className="max-w-[140px] shrink-0 truncate rounded bg-[var(--theme-bg-overlay)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--theme-text-muted)]">
            {board.emoji} {board.name}
          </span>
        )}
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
              title={state ? `PR ${state.toLowerCase()}` : 'Pull request'}
              className={cn(
                'inline-flex items-center gap-0.5 truncate rounded-full px-1.5 py-0.5 text-[10px] font-medium transition-colors',
                tint(hue),
              )}
            >
              <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" className="flex-shrink-0">
                <path d="M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218zM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5zm8-8a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5zM4.25 4a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5z" />
              </svg>
              <span className="truncate">{pr.label}</span>
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
