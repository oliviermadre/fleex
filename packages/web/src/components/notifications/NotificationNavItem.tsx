import { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotificationStore } from '../../stores/notificationStore';
import { NotificationCard } from './NotificationCard';
import { usePopover, FloatingPortal } from '../../hooks/usePopover';
import { cn } from '../../lib/cn';

/** Grace period before the hover flyout closes, so the cursor can travel from
 *  the nav item across the small gap into the panel without it vanishing. */
const CLOSE_DELAY_MS = 150;

function BellIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

/**
 * Fleex Pulse notification center, integrated as the first entry of the
 * NavSidebar (matching the `NavItem` look). Hovering (or focusing) the item
 * reveals a flyout panel anchored to the sidebar's right edge and marks
 * everything as seen, clearing the unseen badge. A click is intentionally left
 * free — reserved for a future, fuller notification center view.
 */
export function NotificationNavItem({ collapsed }: { collapsed: boolean }) {
  const navigate = useNavigate();
  const notifications = useNotificationStore((s) => s.notifications);
  const unseenCount = useNotificationStore((s) => s.unseenCount);
  const panelOpen = useNotificationStore((s) => s.panelOpen);
  const openPanel = useNotificationStore((s) => s.openPanel);
  const closePanel = useNotificationStore((s) => s.closePanel);
  const clear = useNotificationStore((s) => s.clear);

  const closeTimer = useRef<number | null>(null);

  const cancelClose = () => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const open = useCallback(() => {
    cancelClose();
    openPanel();
  }, [openPanel]);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      closePanel();
    }, CLOSE_DELAY_MS);
  }, [closePanel]);

  // Viewport-aware positioning: flip/shift keep the flyout fully on-screen
  // even near the bottom edge.
  const { refs, floatingStyles, getFloatingProps } = usePopover({
    placement: 'right-start',
    role: null,
    enableClick: false,
    open: panelOpen,
    onOpenChange: (o) => {
      if (!o) closePanel();
    },
  });

  // Clean up a pending timer on unmount.
  useEffect(() => cancelClose, []);

  const badge = unseenCount > 0 ? (unseenCount > 9 ? '9+' : String(unseenCount)) : undefined;

  return (
    <>
      <button
        ref={refs.setReference}
        type="button"
        onMouseEnter={open}
        onMouseLeave={scheduleClose}
        onFocus={open}
        onBlur={scheduleClose}
        aria-label={unseenCount > 0 ? `Notifications (${unseenCount} unseen)` : 'Notifications'}
        aria-expanded={panelOpen}
        className={cn(
          'relative border-l-2 transition-colors',
          panelOpen
            ? 'border-[var(--theme-accent)] bg-[var(--theme-bg-hover)] text-[var(--theme-text-primary)]'
            : 'border-transparent text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]',
          collapsed
            ? 'flex flex-col items-center gap-1 px-1 py-2'
            : 'flex items-center gap-2.5 px-4 py-3 text-[15px]',
        )}
        title={collapsed ? 'Notifications' : undefined}
      >
        <span className="relative flex-shrink-0">
          <BellIcon />
          {badge && collapsed && (
            <span className="absolute -right-1.5 -top-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[var(--theme-accent-active)] text-[8px] font-bold text-white">
              {badge}
            </span>
          )}
        </span>
        {collapsed ? (
          <span
            className={cn(
              'max-w-full truncate text-[10px] font-medium leading-none tracking-tight',
              panelOpen ? 'text-[var(--theme-accent)]' : 'text-[var(--theme-text-faint)]',
            )}
          >
            Notifs
          </span>
        ) : (
          <>
            <span className="truncate">Notifications</span>
            {badge && (
              <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--theme-accent-active)] px-1 text-[10px] font-bold leading-none text-white">
                {badge}
              </span>
            )}
          </>
        )}
      </button>

      {panelOpen && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            onMouseEnter={open}
            onMouseLeave={scheduleClose}
            style={{ ...floatingStyles, zIndex: 9998 }}
            {...getFloatingProps()}
            className="flex max-h-[70vh] w-80 max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-base)] shadow-xl"
          >
          <div className="flex items-center justify-between border-b border-[var(--theme-border-subtle)] px-3 py-2">
            <span className="text-xs font-semibold text-[var(--theme-text-primary)]">Notifications</span>
            {notifications.length > 0 && (
              <button
                type="button"
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
                      cancelClose();
                      navigate(n.link);
                      closePanel();
                    }}
                  />
                ))}
              </div>
            )}
          </div>
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
