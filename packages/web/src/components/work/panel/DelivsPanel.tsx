/**
 * Deliverables panel — the ticket's deliverables as cards mirroring the ticket
 * detail's Deliverables tab: kind badge · title · draft flag · a NEW badge for
 * unseen ones (toggles read via unreadStore) · author · generation date. The
 * list is passed down from WorkView (one shared WS-live subscription); clicking
 * a card opens the existing deliverable overlay.
 */
import { useEffect } from 'react';
import type { TicketDeliverable } from '@fleex/shared';
import { useUIStore } from '../../../stores/uiStore';
import { useUnreadStore } from '../../../stores/unreadStore';
import { tint, tintText } from '../../../lib/tints';
import { cn } from '../../../lib/cn';
import { DeliverableTypeBadge } from '../../ui/DeliverableTypeBadge';

/** Local relative-time, matching the Deliverables tab's own formatter. */
function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

interface Props {
  ticketId: string;
  deliverables: TicketDeliverable[];
}

export function DelivsPanel({ ticketId, deliverables }: Props) {
  const openDeliverableOverlay = useUIStore((s) => s.openDeliverableOverlay);
  const seenSet = useUnreadStore((s) => s.seenDeliverablesByTicket[ticketId]);
  const loadSeenDeliverables = useUnreadStore((s) => s.loadSeenDeliverables);
  const toggleDeliverableSeen = useUnreadStore((s) => s.toggleDeliverableSeen);

  useEffect(() => {
    void loadSeenDeliverables(ticketId);
  }, [ticketId, loadSeenDeliverables]);

  if (deliverables.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 text-center text-[12px] text-[var(--theme-text-faint)]">
        Nothing delivered yet.
      </div>
    );
  }

  // Most recent first.
  const ordered = [...deliverables].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-2">
      <div className="flex flex-col gap-1.5">
        {ordered.map((d) => {
          const isSeen = seenSet?.has(d.id) ?? false;
          return (
            <div
              key={d.id}
              className="group/deliv flex flex-col gap-1 rounded-lg border border-[var(--theme-border)] px-2.5 py-2 transition-colors hover:border-[var(--theme-border-input)] hover:bg-[var(--theme-bg-hover)]"
            >
              <div className="flex items-center gap-2">
                <DeliverableTypeBadge type={d.type} size="xs" />
                {d.status === 'draft' && (
                  <span className={cn('rounded-full px-1.5 py-px text-[10px] font-medium', tint('yellow'))}>draft</span>
                )}
                {d.version > 1 && <span className="text-[10px] text-[var(--theme-text-faint)]">v{d.version}</span>}
                <button
                  type="button"
                  onClick={() => void toggleDeliverableSeen(ticketId, d.id, !isSeen)}
                  title={isSeen ? 'Mark as unread' : 'Mark as read'}
                  className={cn(
                    'ml-auto cursor-pointer rounded text-[9px] font-bold tracking-wider transition-opacity',
                    isSeen
                      ? 'text-[var(--theme-text-faint)] opacity-0 group-hover/deliv:opacity-60 hover:!opacity-100'
                      : 'text-[var(--theme-accent)] opacity-100 hover:opacity-70',
                  )}
                >
                  NEW
                </button>
              </div>

              <button
                type="button"
                onClick={() => {
                  if (!isSeen) void toggleDeliverableSeen(ticketId, d.id, true);
                  openDeliverableOverlay(d);
                }}
                className="cursor-pointer text-left"
              >
                <div className="truncate text-[12px] font-medium text-[var(--theme-text-primary)]">{d.title}</div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[var(--theme-text-faint)]">
                  {d.agentName && <span className={tintText('purple')}>{d.agentName}</span>}
                  {d.agentName && <span>·</span>}
                  <span>{relativeTime(d.createdAt)}</span>
                </div>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
