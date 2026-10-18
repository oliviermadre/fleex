import { useEffect } from 'react';
import { NOOP } from './noop';
import type { TicketDeliverable } from '@fleex/shared';
import { stripHtmlCodeFence } from '@fleex/shared';
import { useUnreadStore } from '../stores/unreadStore';
import { useUIStore } from '../stores/uiStore';
import { useDeliverableTypesStore } from '../stores/deliverableTypesStore';
import { MarkdownRenderer } from '../components/scratchpad/MarkdownRenderer';
import { tint } from '../lib/tints';

/**
 * Full-screen reader for a deliverable; marks it seen on open. HTML-rendered
 * types (mockups…) play in an iframe, like the desktop overlay — the rest is
 * markdown.
 */
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
  const isHtml = useDeliverableTypesStore((s) => s.rendererFor)(deliverable.type) === 'html';

  useEffect(() => {
    if (ticketId && !seen?.has(deliverable.id)) {
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
            deliverable.status === 'final'
              ? tint('green')
              : tint('yellow')
          }`}
        >
          {deliverable.status}
        </span>
      </header>
      {isHtml ? (
        <iframe
          srcDoc={stripHtmlCodeFence(deliverable.content).replace(/<\\\/script\s*>/gi, '</script>')}
          title={deliverable.title}
          className="min-h-0 w-full flex-1 border-0 bg-white"
          style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
        />
      ) : (
        <div
          className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-sm"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}
        >
          <MarkdownRenderer content={deliverable.content} onToggleCheckbox={NOOP} />
        </div>
      )}
    </div>
  );
}

/**
 * The desktop overlay (`DeliverableReadingOverlay`, mounted by AppLayout) never
 * exists on the phone, so cards calling `openDeliverableOverlay` did nothing on
 * tap. This renders the mobile reader for them instead.
 */
export function MobileDeliverableOverlayHost() {
  const deliverable = useUIStore((s) => s.deliverableOverlay);
  const close = useUIStore((s) => s.closeDeliverableOverlay);
  if (!deliverable) return null;
  return <MobileDeliverableReader ticketId={deliverable.ticketId ?? ''} deliverable={deliverable} onClose={close} />;
}
