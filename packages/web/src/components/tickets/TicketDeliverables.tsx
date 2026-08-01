import { useState, useEffect, useCallback } from 'react';
import type { TicketDeliverable, TicketWsMessage } from '@fleex/shared';
import { tint, tintText, tintClasses } from '../../lib/tints';
import { appWs } from '../../services/websocket';
import { useUIStore } from '../../stores/uiStore';
import { useUnreadStore } from '../../stores/unreadStore';
import { useDeliverableTypesStore } from '../../stores/deliverableTypesStore';
import { DeliverableTypePicker } from './DeliverableTypePicker';
import { DeliverableFormModal } from './DeliverableFormModal';
import { TicketPickerModal } from './TicketPickerModal';
import * as api from '../../services/api';

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function isUrl(text: string): boolean {
  return /^https?:\/\/\S+$/.test(text.trim());
}


export function TicketDeliverables({ ticketId }: { ticketId: string }) {
  const [deliverables, setDeliverables] = useState<TicketDeliverable[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [copyTarget, setCopyTarget] = useState<TicketDeliverable | null>(null);
  const openDeliverableOverlay = useUIStore((s) => s.openDeliverableOverlay);
  const floatingDeliverableIds = useUIStore((s) => s.floatingDeliverableIds);
  const bringDeliverableToFront = useUIStore((s) => s.bringDeliverableToFront);
  const updateFloatingDeliverable = useUIStore((s) => s.updateFloatingDeliverable);

  const seenSet = useUnreadStore((s) => s.seenDeliverablesByTicket[ticketId]);
  const toggleDeliverableSeen = useUnreadStore((s) => s.toggleDeliverableSeen);
  const loadSeenDeliverables = useUnreadStore((s) => s.loadSeenDeliverables);
  const labelForType = useDeliverableTypesStore((s) => s.labelFor);
  const colorForType = useDeliverableTypesStore((s) => s.colorFor);

  const handleOpenDeliverable = useCallback((d: TicketDeliverable) => {
    // Mark as seen when opening
    if (!seenSet?.has(d.id)) {
      toggleDeliverableSeen(ticketId, d.id, true).catch(() => {});
    }
    if (isUrl(d.content)) {
      window.open(d.content.trim(), '_blank', 'noopener');
    } else if (floatingDeliverableIds.includes(d.id)) {
      bringDeliverableToFront(d.id);
    } else {
      openDeliverableOverlay(d);
    }
  }, [ticketId, seenSet, toggleDeliverableSeen, floatingDeliverableIds, bringDeliverableToFront, openDeliverableOverlay]);

  // Toggle read/unread for a single deliverable
  const handleToggleRead = useCallback((d: TicketDeliverable, isSeen: boolean) => {
    toggleDeliverableSeen(ticketId, d.id, !isSeen).catch(() => {});
  }, [ticketId, toggleDeliverableSeen]);

  useEffect(() => {
    const ac = new AbortController();
    api.fetchTicketDeliverables(ticketId, { signal: ac.signal }).then(setDeliverables).catch(api.ignoreAbort);
    loadSeenDeliverables(ticketId);
    return () => ac.abort();
  }, [ticketId, loadSeenDeliverables]);

  // Real-time updates
  useEffect(() => {
    const unsub = appWs.onChannel('tickets', (raw) => {
      try {
        const msg = raw as TicketWsMessage;
        if (msg.type === 'deliverable:created') {
          const d = msg.data as TicketDeliverable;
          if (d.ticketId === ticketId) {
            setDeliverables((prev) => {
              if (prev.some((x) => x.id === d.id)) return prev;
              return [...prev, d];
            });
          }
        } else if (msg.type === 'deliverable:updated') {
          const d = msg.data as TicketDeliverable;
          if (d.ticketId === ticketId) {
            setDeliverables((prev) => prev.map((x) => (x.id === d.id ? d : x)));
            updateFloatingDeliverable(d);
          }
        } else if (msg.type === 'deliverable:deleted') {
          const { deliverableId, ticketId: tid } = msg.data as { deliverableId: string; ticketId: string };
          if (tid === ticketId) {
            setDeliverables((prev) => prev.filter((x) => x.id !== deliverableId));
          }
        }
      } catch {
        // ignore
      }
    });
    return unsub;
  }, [ticketId, updateFloatingDeliverable]);

  if (deliverables.length === 0) {
    return (
      <>
        <div className="flex flex-1 flex-col items-center justify-center py-12 text-center">
          <div className="mb-2 text-2xl opacity-30">&#x1F4E6;</div>
          <p className="text-sm text-[var(--theme-text-muted)]">No deliverables yet</p>
          <p className="mt-1 text-xs text-[var(--theme-text-faint)]">
            Agents produce deliverables as they work on this ticket
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="mt-3 rounded-md border border-[var(--theme-border)] px-3 py-1.5 text-xs font-medium text-[var(--theme-text-secondary)] transition-colors hover:border-[var(--theme-accent)] hover:text-[var(--theme-accent)]"
          >
            + Add deliverable
          </button>
        </div>
        <DeliverableFormModal open={showCreateModal} onClose={() => setShowCreateModal(false)} ticketId={ticketId} />
      </>
    );
  }

  // Sort most recent first
  const sorted = [...deliverables].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto">
      {/* Add deliverable button */}
      <div className="mb-2 flex justify-end">
        <button
          onClick={() => setShowCreateModal(true)}
          className="rounded-md border border-[var(--theme-border)] px-2.5 py-1 text-[11px] font-medium text-[var(--theme-text-secondary)] transition-colors hover:border-[var(--theme-accent)] hover:text-[var(--theme-accent)]"
        >
          + Add deliverable
        </button>
      </div>

      <div className="flex flex-col gap-2">
        {sorted.map((d) => {
          const contentIsUrl = isUrl(d.content);
          const isFloating = floatingDeliverableIds.includes(d.id);

          const isSeen = seenSet?.has(d.id) ?? false;

          return (
            <div
              key={d.id}
              className="rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)]"
            >
              {/* Header row — always visible */}
              <div className="group/deliv flex items-center">
                {/* Read/unread toggle */}
                <button
                  className={`ml-2 flex h-6 w-8 flex-shrink-0 items-center justify-center rounded transition-all ${
                    !isSeen
                      ? 'text-[var(--theme-accent)] opacity-100'
                      : 'text-[var(--theme-text-faint)] opacity-0 group-hover/deliv:opacity-60 hover:!opacity-100'
                  }`}
                  onClick={(e) => { e.stopPropagation(); handleToggleRead(d, isSeen); }}
                  title={isSeen ? 'Mark as unread' : 'Mark as read'}
                >
                  <span className="text-[9px] font-bold tracking-wider">NEW</span>
                </button>

                {/* Type badge — click to change type. Kept outside the row-open
                    button (no nested buttons); full label, configured colour. */}
                {(() => {
                  const c = colorForType(d.type);
                  return (
                    <div className="flex-shrink-0 py-2.5 pl-2">
                      <DeliverableTypePicker
                        deliverable={d}
                        onChanged={(u) => setDeliverables((prev) => prev.map((x) => (x.id === u.id ? u : x)))}
                      >
                        <span
                          className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${c ? '' : 'bg-[var(--theme-accent)]/15 text-[var(--theme-accent)]'}`}
                          style={c ? { backgroundColor: c.bg, color: c.text } : undefined}
                        >
                          {labelForType(d.type)}
                        </span>
                      </DeliverableTypePicker>
                    </div>
                  );
                })()}

                <button
                  className="flex flex-1 items-center gap-3 px-2 py-2.5 text-left transition-colors hover:bg-[var(--theme-bg-surface-hover)]"
                  onClick={() => handleOpenDeliverable(d)}
                >

                  {/* Title + meta */}
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-[var(--theme-text-primary)]">
                        {d.title}
                      </span>
                      {d.status === 'draft' && (
                        <span className={`flex-shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium ${tint('yellow')}`}>
                          draft
                        </span>
                      )}
                      {d.version > 1 && (
                        <span className="flex-shrink-0 text-[10px] text-[var(--theme-text-faint)]">
                          v{d.version}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] text-[var(--theme-text-faint)]">
                      <span className={tintText('purple')}>{d.agentName}</span>
                      <span>&middot;</span>
                      <span>{relativeTime(d.createdAt)}</span>
                    </div>
                  </div>

                  {/* Right side indicator */}
                  {contentIsUrl ? (
                    <svg className="h-3.5 w-3.5 flex-shrink-0 text-[var(--theme-text-faint)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  ) : isFloating ? (
                    <svg className={`h-3.5 w-3.5 flex-shrink-0 ${tintText('blue')}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                    </svg>
                  ) : (
                    <svg className="h-3.5 w-3.5 flex-shrink-0 text-[var(--theme-text-faint)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  )}
                </button>

                {/* Copy to button — visible on hover */}
                <button
                  className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded opacity-0 transition-all hover:bg-[var(--theme-accent)]/15 hover:text-[var(--theme-accent)] group-hover/deliv:opacity-100 text-[var(--theme-text-faint)]"
                  title="Copy to another ticket"
                  onClick={(e) => {
                    e.stopPropagation();
                    setCopyTarget(d);
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                  </svg>
                </button>

                {/* Delete button — visible on hover */}
                <button
                  className={`mr-2 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded opacity-0 transition-all group-hover/deliv:opacity-100 text-[var(--theme-text-faint)] ${tintClasses('red').hoverBg} ${tintClasses('red').hoverText}`}
                  title="Delete deliverable"
                  onClick={async (e) => {
                    e.stopPropagation();
                    try {
                      await api.deleteDeliverable(ticketId, d.id);
                      setDeliverables((prev) => prev.filter((x) => x.id !== d.id));
                    } catch { /* ignore */ }
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <line x1="4" y1="4" x2="12" y2="12" />
                    <line x1="12" y1="4" x2="4" y2="12" />
                  </svg>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <DeliverableFormModal open={showCreateModal} onClose={() => setShowCreateModal(false)} ticketId={ticketId} />
      {copyTarget && (
        <TicketPickerModal
          open={!!copyTarget}
          onClose={() => setCopyTarget(null)}
          deliverable={copyTarget}
          sourceTicketId={ticketId}
        />
      )}
    </div>
  );
}
