import { useEffect } from 'react';

import type { TicketDeliverable } from '@fleex/shared';

import { MarkdownRenderer } from '../components/scratchpad/MarkdownRenderer';
import { tint } from '../lib/tints';
import { useUnreadStore } from '../stores/unreadStore';

/** Full-screen markdown reader for a deliverable; marks it seen on open. */
export function MobileDeliverableReader({
  ticketId,
  deliverable,
  onClose,
}: {
  ticketId: string;
  deliverable: TicketDeliverable;
  onClose: () => void;
}) {
  const seen = useUnreadStore((s) => s.seenDeliverablesByTicket[ticketId]);
  const toggleSeen = useUnreadStore((s) => s.toggleDeliverableSeen);

  useEffect(() => {
    if (!seen?.has(deliverable.id)) {
      toggleSeen(ticketId, deliverable.id, true).catch(() => {});
    }
  }, [ticketId, deliverable.id, seen, toggleSeen]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[var(--theme-bg-base)]">
      <header
        className="flex shrink-0 items-center gap-2 border-b border-[var(--theme-border)] px-2 py-2"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 8px)' }}
      >
        <button
          onClick={onClose}
          className="shrink-0 rounded-md px-2 py-1.5 text-xl leading-none text-[var(--theme-text-muted)]"
          aria-label="Fermer"
        >
          ‹
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[var(--theme-text-primary)]">
            {deliverable.title}
          </p>
          <p className="truncate text-[10px] text-[var(--theme-text-faint)]">
            {deliverable.agentName} · {deliverable.type} · v{deliverable.version}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            deliverable.status === 'final' ? tint('green') : tint('yellow')
          }`}
        >
          {deliverable.status}
        </span>
      </header>
      <div
        className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-sm"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}
      >
        <MarkdownRenderer content={deliverable.content} onToggleCheckbox={() => {}} />
      </div>
    </div>
  );
}
