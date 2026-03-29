import { useState, useEffect, useCallback } from 'react';
import type { TicketDeliverable, TicketWsMessage } from '@fleex/shared';
import { appWs } from '../../services/websocket';
import { useUIStore } from '../../stores/uiStore';
import { useUnreadStore } from '../../stores/unreadStore';
import { DeliverableReadingOverlay } from './DeliverableReadingOverlay';
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

function typeIcon(type: string): string {
  switch (type) {
    case 'prd': return 'PRD';
    case 'spec': return 'SPEC';
    case 'url': return 'URL';
    case 'pr': return 'PR';
    case 'plan': return 'PLAN';
    default: return type.toUpperCase().slice(0, 4);
  }
}

export function TicketDeliverables({ ticketId }: { ticketId: string }) {
  const [deliverables, setDeliverables] = useState<TicketDeliverable[]>([]);
  const openDeliverableOverlay = useUIStore((s) => s.openDeliverableOverlay);
  const floatingDeliverableIds = useUIStore((s) => s.floatingDeliverableIds);
  const bringDeliverableToFront = useUIStore((s) => s.bringDeliverableToFront);
  const updateFloatingDeliverable = useUIStore((s) => s.updateFloatingDeliverable);

  const isDeliverableSeen = useUnreadStore((s) => s.isDeliverableSeen);
  const toggleDeliverableSeen = useUnreadStore((s) => s.toggleDeliverableSeen);
  const loadSeenDeliverables = useUnreadStore((s) => s.loadSeenDeliverables);

  const handleOpenDeliverable = useCallback((d: TicketDeliverable) => {
    // Mark as seen when opening
    if (!isDeliverableSeen(ticketId, d.id)) {
      toggleDeliverableSeen(ticketId, d.id, true).catch(() => {});
    }
    if (isUrl(d.content)) {
      window.open(d.content.trim(), '_blank', 'noopener');
    } else if (floatingDeliverableIds.includes(d.id)) {
      bringDeliverableToFront(d.id);
    } else {
      openDeliverableOverlay(d);
    }
  }, [ticketId, isDeliverableSeen, toggleDeliverableSeen, floatingDeliverableIds, bringDeliverableToFront, openDeliverableOverlay]);

  // Toggle read/unread for a single deliverable
  const handleToggleRead = useCallback((d: TicketDeliverable, isSeen: boolean) => {
    toggleDeliverableSeen(ticketId, d.id, !isSeen).catch(() => {});
  }, [ticketId, toggleDeliverableSeen]);

  // Toggle context inclusion for a deliverable
  const handleToggleContext = useCallback(async (d: TicketDeliverable) => {
    const newValue = !d.excludedFromContext;
    // Optimistic update
    setDeliverables((prev) => prev.map((x) => (x.id === d.id ? { ...x, excludedFromContext: newValue } : x)));
    try {
      await api.patchDeliverable(ticketId, d.id, { excludedFromContext: newValue });
    } catch {
      // Revert on failure
      setDeliverables((prev) => prev.map((x) => (x.id === d.id ? { ...x, excludedFromContext: !newValue } : x)));
    }
  }, [ticketId]);

  useEffect(() => {
    api.fetchTicketDeliverables(ticketId).then(setDeliverables).catch(() => {});
    loadSeenDeliverables(ticketId);
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
      <div className="flex flex-1 flex-col items-center justify-center py-12 text-center">
        <div className="mb-2 text-2xl opacity-30">&#x1F4E6;</div>
        <p className="text-sm text-[var(--theme-text-muted)]">No deliverables yet</p>
        <p className="mt-1 text-xs text-[var(--theme-text-faint)]">
          Agents produce deliverables as they work on this ticket
        </p>
      </div>
    );
  }

  // Sort most recent first
  const sorted = [...deliverables].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto">
      <div className="flex flex-col gap-2">
        {sorted.map((d) => {
          const contentIsUrl = isUrl(d.content);
          const isFloating = floatingDeliverableIds.includes(d.id);

          const isSeen = isDeliverableSeen(ticketId, d.id);

          return (
            <div
              key={d.id}
              className={`rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] transition-opacity ${d.excludedFromContext ? 'opacity-50' : ''}`}
            >
              {/* Header row — always visible */}
              <div className="group/deliv flex items-center">
                {/* Read/unread toggle */}
                <button
                  className={`ml-2 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded transition-all ${
                    !isSeen
                      ? 'text-[var(--theme-accent)] opacity-100'
                      : 'text-[var(--theme-text-faint)] opacity-0 group-hover/deliv:opacity-60 hover:!opacity-100'
                  }`}
                  onClick={(e) => { e.stopPropagation(); handleToggleRead(d, isSeen); }}
                  title={isSeen ? 'Mark as unread' : 'Mark as read'}
                >
                  {!isSeen ? (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><circle cx="5" cy="5" r="5" /></svg>
                  ) : (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="5" cy="5" r="4" /></svg>
                  )}
                </button>

                <button
                  className="flex flex-1 items-center gap-3 px-2 py-2.5 text-left transition-colors hover:bg-[var(--theme-bg-surface-hover)]"
                  onClick={() => handleOpenDeliverable(d)}
                >

                  {/* Type badge */}
                  <span className="flex-shrink-0 rounded bg-[var(--theme-accent)]/15 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-[var(--theme-accent)]">
                    {typeIcon(d.type)}
                  </span>

                  {/* Title + meta */}
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-[var(--theme-text-primary)]">
                        {d.title}
                      </span>
                      {d.status === 'draft' && (
                        <span className="flex-shrink-0 rounded-full bg-yellow-500/15 px-1.5 py-px text-[10px] font-medium text-yellow-400">
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
                      <span className="text-purple-400">{d.agentName}</span>
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
                    <svg className="h-3.5 w-3.5 flex-shrink-0 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                    </svg>
                  ) : (
                    <svg className="h-3.5 w-3.5 flex-shrink-0 text-[var(--theme-text-faint)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  )}
                </button>

                {/* Context toggle — visible on hover, stays visible when excluded */}
                <button
                  className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded transition-all ${
                    d.excludedFromContext
                      ? 'text-yellow-500 opacity-100 hover:bg-yellow-500/15'
                      : 'text-[var(--theme-text-faint)] opacity-0 group-hover/deliv:opacity-100 hover:bg-[var(--theme-accent)]/15 hover:text-[var(--theme-accent)]'
                  }`}
                  title={d.excludedFromContext ? 'Include in AI context' : 'Exclude from AI context'}
                  onClick={(e) => { e.stopPropagation(); handleToggleContext(d); }}
                >
                  {d.excludedFromContext ? (
                    /* Eye-off icon */
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    /* Eye icon */
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>

                {/* Delete button — visible on hover */}
                <button
                  className="mr-2 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded opacity-0 transition-all hover:bg-red-500/15 hover:text-red-400 group-hover/deliv:opacity-100 text-[var(--theme-text-faint)]"
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

      <DeliverableReadingOverlay />
    </div>
  );
}
