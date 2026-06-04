import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotificationStore } from '../../stores/notificationStore';
import { useClickOutside } from '../../hooks/useClickOutside';
import { NotificationCard } from './NotificationCard';
import { cn } from '../../lib/cn';

/**
 * Fleex Pulse notification center — a floating bell (top-right) with an unseen
 * badge and a dropdown stacking the persistent notifications. Opening the bell
 * marks everything as seen and clears the badge (V1 behaviour).
 */
export function NotificationBell() {
  const navigate = useNavigate();
  const notifications = useNotificationStore((s) => s.notifications);
  const unseenCount = useNotificationStore((s) => s.unseenCount);
  const panelOpen = useNotificationStore((s) => s.panelOpen);
  const togglePanel = useNotificationStore((s) => s.togglePanel);
  const closePanel = useNotificationStore((s) => s.closePanel);
  const clear = useNotificationStore((s) => s.clear);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useClickOutside([buttonRef, panelRef], closePanel, panelOpen);

  return (
    <div className="fixed right-3 top-3 z-[9998]">
      <button
        ref={buttonRef}
        onClick={togglePanel}
        aria-label={unseenCount > 0 ? `Notifications (${unseenCount} unseen)` : 'Notifications'}
        className={cn(
          'relative flex h-9 w-9 items-center justify-center rounded-full border border-[var(--theme-border)] shadow-md transition-colors',
          panelOpen
            ? 'bg-[var(--theme-bg-hover)] text-[var(--theme-text-primary)]'
            : 'bg-[var(--theme-bg-overlay)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-primary)]',
        )}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unseenCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--theme-accent-active)] px-1 text-[9px] font-bold leading-none text-white">
            {unseenCount > 9 ? '9+' : unseenCount}
          </span>
        )}
      </button>

      {panelOpen && (
        <div
          ref={panelRef}
          className="absolute right-0 mt-2 flex max-h-[70vh] w-80 max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-base)] shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-[var(--theme-border-subtle)] px-3 py-2">
            <span className="text-xs font-semibold text-[var(--theme-text-primary)]">Notifications</span>
            {notifications.length > 0 && (
              <button
                className="text-[10px] text-[var(--theme-text-muted)] transition-colors hover:text-[var(--theme-text-primary)]"
                onClick={clear}
              >
                Clear all
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {notifications.length === 0 ? (
              <p className="px-2 py-8 text-center text-[11px] text-[var(--theme-text-faint)]">
                No notifications yet.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {notifications.map((n) => (
                  <NotificationCard
                    key={n.id}
                    notification={n}
                    onClick={() => {
                      navigate(n.link);
                      closePanel();
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
