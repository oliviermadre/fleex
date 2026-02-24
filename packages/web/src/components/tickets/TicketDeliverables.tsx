import { useState, useEffect } from 'react';
import type { TicketDeliverable, TicketWsMessage } from '@asm/shared';
import { ticketWs } from '../../services/websocket';
import { MarkdownRenderer } from '../scratchpad/MarkdownRenderer';
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
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    api.fetchTicketDeliverables(ticketId).then(setDeliverables).catch(() => {});
  }, [ticketId]);

  // Real-time updates
  useEffect(() => {
    const decoder = new TextDecoder();
    const unsub = ticketWs.onMessage((buf: ArrayBuffer) => {
      try {
        const msg = JSON.parse(decoder.decode(buf)) as TicketWsMessage;
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
          }
        }
      } catch {
        // ignore
      }
    });
    return unsub;
  }, [ticketId]);

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
          const isExpanded = expandedId === d.id;

          return (
            <div
              key={d.id}
              className="rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)]"
            >
              {/* Header row — always visible */}
              <button
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[var(--theme-bg-surface-hover)]"
                onClick={() => {
                  if (contentIsUrl) {
                    window.open(d.content.trim(), '_blank', 'noopener');
                  } else {
                    setExpandedId(isExpanded ? null : d.id);
                  }
                }}
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
                ) : (
                  <svg
                    className={`h-3.5 w-3.5 flex-shrink-0 text-[var(--theme-text-faint)] transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                )}
              </button>

              {/* Expanded content — only for non-URL deliverables */}
              {isExpanded && !contentIsUrl && (
                <div className="border-t border-[var(--theme-border)] px-3 py-3">
                  <div className="max-h-[400px] overflow-y-auto text-sm">
                    <MarkdownRenderer content={d.content} onToggleCheckbox={() => {}} />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
