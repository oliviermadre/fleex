/**
 * One task row in the queue. Carries the Cockpit's inline-editable pictos —
 * priority and type pickers, favorite star, blocked padlock — plus a live
 * right-aligned SDK-activity badge (idle for {age} / Running for {age} /
 * Waiting for {age}) and, for running tasks, the detail line + progress bar. The
 * row is a div (not a button) so the picker buttons can nest legally; clicking
 * the row body selects the task.
 */
import type { KeyboardEvent } from 'react';
import { cn } from '../../../lib/cn';
import { tintClasses } from '../../../lib/tints';
import { useTicketStore } from '../../../stores/ticketStore';
import { TypePickerPopover } from '../../tickets/TypePickerPopover';
import { PriorityPickerPopover } from '../../tickets/PriorityPickerPopover';
import { QueueActivityTimer } from './QueueActivityTimer';
import type { WorkTask } from '../types';

/** ms epoch → ISO string for ActivityBadge / formatAge, or null. */
function msToIso(ms: number | null): string | null {
  return ms != null ? new Date(ms).toISOString() : null;
}

interface Props {
  task: WorkTask;
  selected: boolean;
  onSelect: () => void;
  /** Open the execution log for this task's running SDK run (from the activity badge). */
  onOpenExecution: (executionId: string, title: string) => void;
}

export function QueueRow({ task, selected, onSelect, onOpenExecution }: Props) {
  const ticket = useTicketStore((s) => s.tickets.find((t) => t.id === task.id) ?? null);
  const updateTicket = useTicketStore((s) => s.updateTicket);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect();
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      className={cn(
        'group w-full cursor-pointer border-l-2 px-2.5 py-2 text-left transition-colors',
        selected
          ? 'border-[var(--theme-accent)] bg-[var(--theme-accent-muted)]'
          : 'border-transparent hover:bg-[var(--theme-bg-hover)]',
      )}
    >
      <div className="flex items-center gap-1.5">
        {ticket && (
          <div className="flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
            <PriorityPickerPopover ticket={ticket} />
            <TypePickerPopover ticket={ticket} display="icon" />
          </div>
        )}

        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--theme-text-primary)]">
          {task.title}
        </span>

        {ticket && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void updateTicket(ticket.id, { blocked: !ticket.blocked });
            }}
            title={ticket.blocked ? 'Unblock' : 'Mark as blocked'}
            className={cn(
              'shrink-0 rounded p-0.5 transition-colors',
              // Blocked: always shown. Not blocked: takes no space until the row
              // is hovered (hidden → inline-flex), so it never crowds the title.
              ticket.blocked
                ? tintClasses('red').solidText
                : 'hidden group-hover:inline-flex text-[var(--theme-text-faint)] hover:text-[var(--theme-danger)]',
            )}
          >
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
              <rect x="3" y="7" width="10" height="8" rx="1.5" />
              <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
            </svg>
          </button>
        )}
        {ticket && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void updateTicket(ticket.id, { favorite: !ticket.favorite });
            }}
            title={ticket.favorite ? 'Remove from favorites' : 'Add to favorites'}
            className={cn(
              'shrink-0 rounded p-0.5 transition-colors',
              // Favorited: always shown. Not favorited: takes no space until the
              // row is hovered, so an empty star never eats into the title width.
              ticket.favorite
                ? tintClasses('yellow').solidText
                : cn('hidden group-hover:inline-flex text-[var(--theme-text-faint)]', tintClasses('yellow').hoverText),
            )}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill={ticket.favorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
              <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
            </svg>
          </button>
        )}

        <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
          <QueueActivityTimer
            activity={task.activity}
            lastActivityAt={msToIso(task.lastActivityAt)}
            since={msToIso(task.since)}
            onOpen={
              task.runningExecutionId
                ? () => onOpenExecution(task.runningExecutionId!, `${task.title} · execution log`)
                : undefined
            }
          />
        </span>
      </div>

      {task.activity !== 'idle' && (task.boardName || task.activityDetail) && (
        <div
          className={cn(
            'mt-1 truncate text-[11px]',
            task.activity === 'waiting' ? 'text-[var(--tint-yellow-text)]' : 'text-[var(--theme-text-secondary)]',
          )}
        >
          {task.activityDetail || task.boardName}
        </div>
      )}

      {task.activity === 'running' && (
        <div className="mt-1.5 h-[3px] w-full overflow-hidden rounded-[2px] bg-[var(--theme-border)]">
          <div
            className={cn(
              'h-full rounded-[2px] bg-[var(--theme-accent)]',
              task.progress == null && 'work-progress-indeterminate',
            )}
            style={task.progress != null ? { width: `${Math.round(task.progress * 100)}%` } : undefined}
          />
        </div>
      )}
    </div>
  );
}
