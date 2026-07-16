import { useEffect, useRef, useState, useCallback } from 'react';
import type { DomainEventLog } from '@fleex/shared';
import { useAuditTrailStore } from '../../stores/auditTrailStore';
import { cn } from '../../lib/cn';
import { tint } from '../../lib/tints';

const EVENT_DOMAIN_COLORS: Record<string, string> = {
  ticket: tint('blue'),
  comment: tint('purple'),
  mention: tint('green'),
  deliverable: tint('yellow'),
  persona: tint('orange'),
  board: tint('teal'),
  session: tint('teal'),
  worktree: tint('green'),
  execution: tint('red'),
};

function getEventDomain(eventType: string): string {
  return eventType.split('.')[0] ?? 'unknown';
}

function EventTypeBadge({ eventType }: { eventType: string }) {
  const domain = getEventDomain(eventType);
  const colorClass = EVENT_DOMAIN_COLORS[domain] ?? 'bg-[var(--theme-bg-overlay)] text-[var(--theme-text-secondary)]';

  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium', colorClass)}>
      {eventType}
    </span>
  );
}

function ExpandablePayload({ payload }: { payload: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(false);
  const json = JSON.stringify(payload, null, 2);
  const preview = JSON.stringify(payload).slice(0, 80);

  if (!expanded) {
    return (
      <button
        className="max-w-[300px] truncate text-left font-mono text-[11px] text-[var(--theme-text-faint)] hover:text-[var(--theme-text-secondary)]"
        onClick={() => setExpanded(true)}
      >
        {preview}{preview.length >= 80 ? '...' : ''}
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        className="absolute right-1 top-1 text-[10px] text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)]"
        onClick={() => setExpanded(false)}
      >
        collapse
      </button>
      <pre className="max-h-48 overflow-auto rounded bg-[var(--theme-bg-overlay)] p-2 font-mono text-[11px] text-[var(--theme-text-secondary)]">
        {json}
      </pre>
    </div>
  );
}

function EventRow({ event }: { event: DomainEventLog }) {
  const date = new Date(event.occurredAt);
  const timeStr = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  return (
    <tr className="border-b border-[var(--theme-border)] hover:bg-[var(--theme-bg-hover)] transition-colors">
      <td className="whitespace-nowrap px-3 py-2.5 text-xs text-[var(--theme-text-muted)]">
        <div>{dateStr}</div>
        <div className="font-mono text-[var(--theme-text-faint)]">{timeStr}</div>
      </td>
      <td className="px-3 py-2.5">
        <EventTypeBadge eventType={event.eventType} />
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-[var(--theme-text-faint)]">
        {event.instanceId}
      </td>
      <td className="px-3 py-2.5">
        <ExpandablePayload payload={event.payload} />
      </td>
    </tr>
  );
}

export function AuditTrailView() {
  const events = useAuditTrailStore((s) => s.events);
  const loading = useAuditTrailStore((s) => s.loading);
  const hasMore = useAuditTrailStore((s) => s.hasMore);
  const filters = useAuditTrailStore((s) => s.filters);
  const fetch = useAuditTrailStore((s) => s.fetch);
  const fetchMore = useAuditTrailStore((s) => s.fetchMore);
  const setFilter = useAuditTrailStore((s) => s.setFilter);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Initial fetch
  useEffect(() => {
    fetch();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Infinite scroll observer
  const handleObserver = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (entries[0]?.isIntersecting && hasMore && !loading) {
        fetchMore();
      }
    },
    [hasMore, loading, fetchMore],
  );

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(handleObserver, { threshold: 0.1 });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [handleObserver]);

  // Collect unique event types and instances for filter dropdowns
  const eventTypes = [...new Set(events.map((e) => getEventDomain(e.eventType)))];
  const instances = [...new Set(events.map((e) => e.instanceId))];

  return (
    <div className="flex h-full flex-col">
      {/* Filter bar */}
      <div className="flex items-center gap-3 border-b border-[var(--theme-border)] px-6 py-3">
        <select
          className="rounded border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-2.5 py-1.5 text-xs text-[var(--theme-text-secondary)]"
          value={filters.eventType}
          onChange={(e) => setFilter('eventType', e.target.value)}
        >
          <option value="">All event types</option>
          {eventTypes.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        <select
          className="rounded border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-2.5 py-1.5 text-xs text-[var(--theme-text-secondary)]"
          value={filters.instanceId}
          onChange={(e) => setFilter('instanceId', e.target.value)}
        >
          <option value="">All instances</option>
          {instances.map((i) => (
            <option key={i} value={i}>{i}</option>
          ))}
        </select>

        <input
          type="date"
          className="rounded border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-2.5 py-1.5 text-xs text-[var(--theme-text-secondary)]"
          value={filters.since ? filters.since.split('T')[0] : ''}
          onChange={(e) => setFilter('since', e.target.value ? new Date(e.target.value).toISOString() : '')}
        />

        {loading && (
          <span className="text-xs text-[var(--theme-text-faint)]">Loading...</span>
        )}

        <span className="ml-auto text-xs text-[var(--theme-text-faint)]">
          {events.length} event{events.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Event table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full">
          <thead className="sticky top-0 z-10 bg-[var(--theme-bg-primary)]">
            <tr className="border-b border-[var(--theme-border)]">
              <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">Timestamp</th>
              <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">Event Type</th>
              <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">Instance</th>
              <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">Payload</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </tbody>
        </table>

        {/* Infinite scroll sentinel */}
        <div ref={sentinelRef} className="h-8" />

        {events.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center py-20 text-[var(--theme-text-faint)]">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="mb-4 opacity-30">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <p className="text-sm">No events recorded yet</p>
            <p className="mt-1 text-xs">Events will appear here as actions occur</p>
          </div>
        )}
      </div>
    </div>
  );
}
