import { memo, useState, useCallback, useRef, useEffect } from 'react';
import type { ExecutionLogEntry } from '@fleex/shared';
import { cancelExecution } from '../../services/api';
import { FloatingExecutionPanel } from '../tickets/ExecutionModal';
import { useTicketStore } from '../../stores/ticketStore';
import { useUIStore } from '../../stores/uiStore';
import { cn } from '../../lib/cn';

// ── Type icon (SVG) ──

function TypeIcon({ type }: { type: ExecutionLogEntry['type'] }) {
  if (type === 'agent') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 8V4H8" />
        <rect width="16" height="12" x="4" y="8" rx="2" />
        <path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" />
      </svg>
    );
  }
  if (type === 'panel') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8" /><path d="M12 17v4" />
      <path d="M7 8l3 3-3 3" /><path d="M13 14h3" />
    </svg>
  );
}

// Type badge — icon is colored per type, text is uniform
function TypeBadge({ type }: { type: ExecutionLogEntry['type'] }) {
  const iconColor = {
    agent: 'text-indigo-400',
    panel: 'text-violet-400',
    skill: 'text-cyan-400',
  }[type];

  return (
    <div className="flex w-[80px] flex-shrink-0 items-center gap-1.5">
      <span className={iconColor}><TypeIcon type={type} /></span>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--theme-text-secondary)]">{type}</span>
    </div>
  );
}

// ── Priority-colored ticket icon (same as session view) ──

const PRIORITY_COLORS: Record<string, string> = {
  none: 'text-[var(--theme-text-muted)]',
  low: 'text-blue-400',
  medium: 'text-yellow-400',
  high: 'text-red-400',
};

function TicketIcon({ priority }: { priority: string | null }) {
  const color = PRIORITY_COLORS[priority ?? 'none'] ?? PRIORITY_COLORS['none'];
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={cn('flex-shrink-0', color)}>
      <rect x="2" y="2" width="12" height="12" rx="2" />
      <path d="M5 6h6M5 9h4" />
    </svg>
  );
}

// ── Mode badge ──

function ModeBadge({ mode }: { mode: string | null | undefined }) {
  if (!mode) return null;
  const config: Record<string, { label: string; bg: string; text: string; border: string }> = {
    edit: { label: 'EDIT', bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20' },
    plan: { label: 'PLAN', bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20' },
    talk: { label: 'TALK', bg: 'bg-gray-500/10', text: 'text-gray-400', border: 'border-gray-500/20' },
  };
  const c = config[mode];
  if (!c) return null;

  return (
    <span className={cn('inline-flex items-center gap-1 rounded border px-1.5 py-px text-[10px] font-semibold', c.bg, c.text, c.border)}>
      {mode === 'edit' && (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
        </svg>
      )}
      {mode === 'plan' && (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="3" />
        </svg>
      )}
      {mode === 'talk' && (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      )}
      {c.label}
    </span>
  );
}

// ── Ticket type label ──

const TICKET_TYPE_LABELS: Record<string, string> = {
  build: 'Build', fix: 'Fix', review: 'Review', ops: 'Ops', lead: 'Lead', think: 'Think',
};

// ── Status badge ──

function StatusBadge({ status }: { status: ExecutionLogEntry['status'] }) {
  const config: Record<string, { label: string; dot: string; text: string; bg: string; border: string; pulse?: boolean }> = {
    running: { label: 'Running', dot: 'bg-emerald-500', text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', pulse: true },
    completed: { label: 'Completed', dot: 'bg-emerald-500', text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
    failed: { label: 'Failed', dot: 'bg-red-500', text: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' },
    interrupted: { label: 'Interrupted', dot: 'bg-orange-500', text: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/20' },
  };
  const c = config[status] ?? config['completed']!;

  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-semibold', c.bg, c.text, c.border)}>
      <span className="relative flex h-1.5 w-1.5">
        {c.pulse && <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-75', c.dot)} />}
        <span className={cn('relative inline-flex h-1.5 w-1.5 rounded-full', c.dot)} />
      </span>
      {c.label}
    </span>
  );
}

// ── Duration display ──

function formatDuration(ms: number): string {
  if (ms < 1000) return '<1s';
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function LiveDuration({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(Date.now());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    intervalRef.current = setInterval(() => setNow(Date.now()), 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);
  const ms = now - new Date(startedAt).getTime();
  return (
    <span className="font-mono text-xs text-[var(--theme-text-muted)]" title={new Date(startedAt).toLocaleString()}>
      {formatDuration(ms)}
    </span>
  );
}

// ── Relative time ("X ago") ──

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

function formatFullDatetime(iso: string): string {
  return new Date(iso).toLocaleString();
}

// ── Token display ──

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

// ── CTA icons ──

function CommentIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
      <path d="M2 3.5A1.5 1.5 0 013.5 2h9A1.5 1.5 0 0114 3.5v7a1.5 1.5 0 01-1.5 1.5H5l-3 2.5V3.5z" />
    </svg>
  );
}

function DeliverableIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="1.5" width="10" height="13" rx="1.5" />
      <path d="M5.5 5h5M5.5 8h5M5.5 11h3" />
    </svg>
  );
}

function TicketLinkIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18" />
      <path d="M9 21V9" />
    </svg>
  );
}

function ExecutionLogIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6,4 10,8 6,12" />
    </svg>
  );
}

// ── Main row component ──

export const ExecutionRow = memo(function ExecutionRow({
  entry,
  live,
}: {
  entry: ExecutionLogEntry;
  live: boolean;
}) {
  const [showPanel, setShowPanel] = useState(false);
  const [cancelState, setCancelState] = useState<'idle' | 'confirming' | 'cancelling'>('idle');
  const cancelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectTicket = useTicketStore((s) => s.selectTicket);
  const setTicketTab = useTicketStore((s) => s.setTicketTab);
  const setActivePanel = useUIStore((s) => s.setActivePanel);

  const handleCancel = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (cancelState === 'idle') {
        setCancelState('confirming');
        cancelTimerRef.current = setTimeout(() => setCancelState('idle'), 1500);
      } else if (cancelState === 'confirming') {
        if (cancelTimerRef.current) clearTimeout(cancelTimerRef.current);
        setCancelState('cancelling');
        try { await cancelExecution(entry.id); } catch { /* ignore */ }
        setCancelState('idle');
      }
    },
    [cancelState, entry.id],
  );

  const navigateToTicket = useCallback((e: React.MouseEvent, tab?: 'comments' | 'deliverables') => {
    e.stopPropagation();
    selectTicket(entry.ticketId);
    if (tab) setTicketTab(tab);
    setActivePanel('tickets');
  }, [entry.ticketId, selectTicket, setTicketTab, setActivePanel]);

  const title = entry.ticketTitle || entry.executorName;
  const referenceTime = live ? entry.startedAt : (entry.completedAt ?? entry.startedAt);

  // Subtitle parts: mode · executorName · ticketType
  const subtitleParts: string[] = [];
  if (entry.executorName) subtitleParts.push(entry.executorName);
  if (entry.ticketType) subtitleParts.push(TICKET_TYPE_LABELS[entry.ticketType] ?? entry.ticketType);

  return (
    <>
      <div
        className="group flex w-full items-center gap-3 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-base)] px-4 py-3 transition-colors hover:bg-[var(--theme-bg-hover)]"
      >
        {/* Col 1: Type badge */}
        <TypeBadge type={entry.type} />

        {/* Col 2: Title block (ticket icon + title / mode + agent + ticket type) */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <TicketIcon priority={entry.ticketPriority} />
            <span className="truncate text-sm font-semibold text-[var(--theme-text-primary)]">{title}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 pl-[18px] text-xs text-[var(--theme-text-faint)]">
            <ModeBadge mode={entry.effectiveMode} />
            <span>{subtitleParts.join(' · ')}</span>
          </div>
        </div>

        {/* Col 3: Agent detail (name + model) */}
        <div className="hidden min-w-[110px] flex-shrink-0 text-right lg:block">
          <div className="text-xs font-medium text-[var(--theme-text-secondary)]">{entry.executorName}</div>
          {entry.model && <div className="text-[10px] text-[var(--theme-text-faint)]">{entry.model}</div>}
        </div>

        {/* Col 4: Status */}
        <div className="w-[100px] flex-shrink-0 text-center">
          <StatusBadge status={entry.status} />
        </div>

        {/* Col 5: Execution detail (tokens + cost) */}
        <div className="hidden min-w-[130px] flex-shrink-0 text-right text-[11px] text-[var(--theme-text-faint)] xl:block">
          {(entry.inputTokens != null || entry.outputTokens != null) ? (
            <div>
              {entry.inputTokens != null && <span>in: {formatTokens(entry.inputTokens)}</span>}
              {entry.inputTokens != null && entry.outputTokens != null && <span> · </span>}
              {entry.outputTokens != null && <span>out: {formatTokens(entry.outputTokens)}</span>}
            </div>
          ) : null}
          {entry.costUsd != null && entry.costUsd > 0 && (
            <div>${entry.costUsd.toFixed(2)}</div>
          )}
        </div>

        {/* Col 6: Duration */}
        <div
          className="min-w-[65px] flex-shrink-0 text-right"
          title={
            live
              ? `Started: ${formatFullDatetime(entry.startedAt)}`
              : entry.completedAt
                ? `Started: ${formatFullDatetime(entry.startedAt)}\nCompleted: ${formatFullDatetime(entry.completedAt)}`
                : `Started: ${formatFullDatetime(entry.startedAt)}`
          }
        >
          {live ? (
            <LiveDuration startedAt={entry.startedAt} />
          ) : entry.durationMs != null ? (
            <span className="font-mono text-xs text-[var(--theme-text-muted)]">{formatDuration(entry.durationMs)}</span>
          ) : null}
        </div>

        {/* Col 7: "X ago" */}
        <div
          className="min-w-[55px] flex-shrink-0 text-right text-xs text-[var(--theme-text-faint)]"
          title={formatFullDatetime(referenceTime)}
        >
          {relativeTime(referenceTime)}
        </div>

        {/* Col 8: CTAs — comments / deliverables / ticket / execution log */}
        <div className="flex flex-shrink-0 items-center gap-1">
          {/* Comment CTA */}
          <button
            onClick={(e) => navigateToTicket(e, 'comments')}
            className="flex cursor-pointer items-center gap-0.5 rounded px-1.5 py-1 text-[11px] text-[var(--theme-text-faint)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-primary)]"
            title={`${entry.commentCount} comments — open ticket`}
          >
            <CommentIcon />
            {entry.commentCount > 0 && <span>{entry.commentCount}</span>}
          </button>

          {/* Deliverable CTA */}
          <button
            onClick={(e) => navigateToTicket(e, 'deliverables')}
            className="flex cursor-pointer items-center gap-0.5 rounded px-1.5 py-1 text-[11px] text-[var(--theme-text-faint)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-primary)]"
            title={`${entry.deliverableCount} deliverables — open ticket`}
          >
            <DeliverableIcon />
            {entry.deliverableCount > 0 && <span>{entry.deliverableCount}</span>}
          </button>

          {/* Ticket CTA */}
          <button
            onClick={(e) => navigateToTicket(e)}
            className="flex cursor-pointer items-center rounded px-1.5 py-1 text-[var(--theme-text-faint)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-primary)]"
            title="Open ticket"
          >
            <TicketLinkIcon />
          </button>

          {/* Execution log CTA (open floating panel) */}
          <button
            onClick={(e) => { e.stopPropagation(); setShowPanel(true); }}
            className="flex cursor-pointer items-center rounded px-1.5 py-1 text-[var(--theme-text-faint)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-primary)]"
            title="View execution log"
          >
            <ExecutionLogIcon />
          </button>

          {/* Cancel (live only) */}
          {live && (
            <button
              onClick={handleCancel}
              className={cn(
                'rounded px-2 py-0.5 text-[10px] font-semibold transition-opacity',
                cancelState === 'idle' && 'bg-red-500/10 text-red-400 opacity-0 hover:bg-red-500/20 group-hover:opacity-100',
                cancelState === 'confirming' && 'bg-red-500 text-white',
                cancelState === 'cancelling' && 'cursor-wait bg-red-500/20 text-red-400',
              )}
            >
              {cancelState === 'idle' && 'Cancel'}
              {cancelState === 'confirming' && 'Confirm?'}
              {cancelState === 'cancelling' && 'Stopping…'}
            </button>
          )}
        </div>
      </div>

      {showPanel && (
        <FloatingExecutionPanel
          executionId={entry.id}
          title={`${entry.executorName} — ${title}`}
          onClose={() => setShowPanel(false)}
        />
      )}
    </>
  );
});
