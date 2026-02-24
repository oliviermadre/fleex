import { useState, useEffect } from 'react';
import type { TicketMention, MentionStatus, TicketWsMessage } from '@asm/shared';
import { ticketWs } from '../../services/websocket';
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

const STATUS_CONFIG: Record<MentionStatus, { label: string; color: string; bg: string; dot: string }> = {
  pending: {
    label: 'Pending',
    color: 'text-yellow-400',
    bg: 'bg-yellow-500/15',
    dot: 'bg-yellow-400',
  },
  acknowledged: {
    label: 'Acknowledged',
    color: 'text-blue-400',
    bg: 'bg-blue-500/15',
    dot: 'bg-blue-400',
  },
  resolved: {
    label: 'Resolved',
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/15',
    dot: 'bg-emerald-400',
  },
};

type FilterStatus = MentionStatus | 'all';

export function TicketMentions({ ticketId }: { ticketId: string }) {
  const [mentions, setMentions] = useState<TicketMention[]>([]);
  const [filter, setFilter] = useState<FilterStatus>('all');

  useEffect(() => {
    api.fetchTicketMentions(ticketId).then(setMentions).catch(() => {});
  }, [ticketId]);

  // Real-time updates
  useEffect(() => {
    const decoder = new TextDecoder();
    const unsub = ticketWs.onMessage((buf: ArrayBuffer) => {
      try {
        const msg = JSON.parse(decoder.decode(buf)) as TicketWsMessage;
        if (msg.type === 'mention:created') {
          const m = msg.data as TicketMention;
          if (m.ticketId === ticketId) {
            setMentions((prev) => {
              if (prev.some((x) => x.id === m.id)) return prev;
              return [...prev, m];
            });
          }
        } else if (msg.type === 'mention:acknowledged' || msg.type === 'mention:resolved') {
          const m = msg.data as TicketMention;
          if (m.ticketId === ticketId) {
            setMentions((prev) => prev.map((x) => (x.id === m.id ? m : x)));
          }
        }
      } catch {
        // ignore
      }
    });
    return unsub;
  }, [ticketId]);

  if (mentions.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center py-12 text-center">
        <div className="mb-2 text-2xl opacity-30">@</div>
        <p className="text-sm text-[var(--theme-text-muted)]">No mentions yet</p>
        <p className="mt-1 text-xs text-[var(--theme-text-faint)]">
          Use <span className="font-mono text-[var(--theme-accent)]">@agent:name</span> in comments to create mentions
        </p>
      </div>
    );
  }

  // Status counts for filter pills
  const counts: Record<FilterStatus, number> = {
    all: mentions.length,
    pending: mentions.filter((m) => m.status === 'pending').length,
    acknowledged: mentions.filter((m) => m.status === 'acknowledged').length,
    resolved: mentions.filter((m) => m.status === 'resolved').length,
  };

  const filtered = filter === 'all' ? mentions : mentions.filter((m) => m.status === filter);
  const sorted = [...filtered].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const filterOptions: { key: FilterStatus; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'pending', label: 'Pending' },
    { key: 'acknowledged', label: 'Acknowledged' },
    { key: 'resolved', label: 'Resolved' },
  ];

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      {/* Filter pills */}
      <div className="mb-3 flex flex-shrink-0 items-center gap-1.5">
        {filterOptions.map((opt) => {
          const count = counts[opt.key];
          if (opt.key !== 'all' && count === 0) return null;
          return (
            <button
              key={opt.key}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                filter === opt.key
                  ? 'bg-[var(--theme-accent)]/15 text-[var(--theme-accent)]'
                  : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)]'
              }`}
              onClick={() => setFilter(opt.key)}
            >
              {opt.label}
              <span className="ml-1 opacity-60">{count}</span>
            </button>
          );
        })}
      </div>

      {/* Mention list */}
      <div className="flex-1 overflow-y-auto">
        {sorted.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <p className="text-sm text-[var(--theme-text-muted)]">No {filter} mentions</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {sorted.map((m) => {
              const cfg = STATUS_CONFIG[m.status];

              return (
                <div
                  key={m.id}
                  className="rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-3 py-2.5"
                >
                  {/* Top row: source -> target + status */}
                  <div className="flex items-center gap-2">
                    {/* Source agent */}
                    <span className="text-xs font-medium text-blue-400">
                      {m.sourceAgent}
                    </span>

                    {/* Arrow */}
                    <svg className="h-3 w-3 flex-shrink-0 text-[var(--theme-text-faint)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>

                    {/* Target agent */}
                    <span className="text-xs font-medium text-purple-400">
                      {m.targetAgent}
                    </span>

                    {/* Spacer */}
                    <div className="flex-1" />

                    {/* Status badge */}
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${cfg.bg} ${cfg.color}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
                      {cfg.label}
                    </span>
                  </div>

                  {/* Bottom row: timestamps */}
                  <div className="mt-1.5 flex items-center gap-3 text-[10px] text-[var(--theme-text-faint)]">
                    <span>Created {relativeTime(m.createdAt)}</span>
                    {m.resolvedAt && (
                      <>
                        <span>&middot;</span>
                        <span>Resolved {relativeTime(m.resolvedAt)}</span>
                      </>
                    )}
                    {m.resolvedDeliverableId && (
                      <>
                        <span>&middot;</span>
                        <span className="text-[var(--theme-text-muted)]">Has deliverable</span>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
