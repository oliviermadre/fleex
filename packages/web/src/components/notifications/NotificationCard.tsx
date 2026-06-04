import type { PulseNotification, PulseLevel } from '../../notifications/types';
import { formatAge } from '../../lib/formatAge';
import { cn } from '../../lib/cn';

/** Left-border accent per severity. */
const levelAccent: Record<PulseLevel, string> = {
  info: 'border-l-blue-500',
  success: 'border-l-emerald-500',
  warning: 'border-l-amber-500',
  error: 'border-l-red-500',
  action: 'border-l-violet-500',
};

/**
 * Presentational card shared by the toast surface and the notification center.
 * Stateless: callers wire navigation (`onClick`) and dismissal (`onClose`).
 */
export function NotificationCard({
  notification,
  onClick,
  onClose,
}: {
  notification: PulseNotification;
  onClick?: () => void;
  onClose?: () => void;
}) {
  const { emoji, title, body, level, createdAt, seen } = notification;

  return (
    <div
      className={cn(
        'group flex items-start gap-2.5 rounded-md border border-[var(--theme-border)] border-l-2 px-3 py-2.5 text-left shadow-sm transition-colors',
        'bg-[var(--theme-bg-overlay)]',
        levelAccent[level],
        onClick && 'cursor-pointer hover:bg-[var(--theme-bg-hover)]',
      )}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      <span className="mt-0.5 shrink-0 text-base leading-none" aria-hidden>
        {emoji}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-xs font-semibold text-[var(--theme-text-primary)]">
            {title}
          </span>
          {!seen && (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--theme-accent-active)]"
              aria-label="unread"
            />
          )}
          <span className="ml-auto shrink-0 text-[10px] text-[var(--theme-text-faint)]">
            {formatAge(createdAt)}
          </span>
        </div>
        <p className="mt-0.5 break-words text-[11px] leading-snug text-[var(--theme-text-secondary)]">
          {body}
        </p>
      </div>
      {onClose && (
        <button
          className="shrink-0 opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          aria-label="Dismiss notification"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="4" y1="4" x2="12" y2="12" />
            <line x1="12" y1="4" x2="4" y2="12" />
          </svg>
        </button>
      )}
    </div>
  );
}
