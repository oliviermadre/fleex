import { memo, useState, useCallback, useEffect, useRef } from 'react';
import type { ExecutionLogEntry } from '@fleex/shared';
import { cancelExecution } from '../../services/api';
import { FloatingExecutionPanel } from '../tickets/ExecutionModal';
import { cn } from '../../lib/cn';

// ── Type badge ──

function TypeBadge({ type }: { type: ExecutionLogEntry['type'] }) {
  const config = {
    agent: { label: 'AGENT', bg: 'bg-indigo-500/15', text: 'text-indigo-400', icon: '🤖' },
    panel: { label: 'PANEL', bg: 'bg-violet-500/15', text: 'text-violet-400', icon: '👥' },
    skill: { label: 'SKILL', bg: 'bg-cyan-500/15', text: 'text-cyan-400', icon: '📋' },
  }[type];

  return (
    <span
      className={cn(
        'inline-flex w-[76px] items-center justify-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
        config.bg,
        config.text,
      )}
    >
      <span>{config.icon}</span>
      <span>{config.label}</span>
    </span>
  );
}

// ── Mode badge ──

function ModeBadge({ mode }: { mode: string | null | undefined }) {
  if (!mode) return null;
  const config: Record<string, { icon: string; bg: string; text: string }> = {
    edit: { icon: '✏', bg: 'bg-emerald-500/15', text: 'text-emerald-400' },
    plan: { icon: '👁', bg: 'bg-blue-500/15', text: 'text-blue-400' },
    talk: { icon: '💬', bg: 'bg-gray-500/15', text: 'text-gray-400' },
  };
  const c = config[mode];
  if (!c) return null;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase',
        c.bg,
        c.text,
      )}
    >
      <span>{c.icon}</span>
      <span>{mode.toUpperCase()}</span>
    </span>
  );
}

// ── Status badge ──

function StatusBadge({ status }: { status: ExecutionLogEntry['status'] }) {
  const config: Record<
    string,
    { label: string; dot: string; text: string; bg: string; pulse?: boolean }
  > = {
    running: {
      label: 'Running',
      dot: 'bg-emerald-500',
      text: 'text-emerald-400',
      bg: 'bg-emerald-500/10',
      pulse: true,
    },
    completed: {
      label: 'Completed',
      dot: 'bg-emerald-500',
      text: 'text-emerald-400',
      bg: 'bg-emerald-500/10',
    },
    failed: {
      label: 'Failed',
      dot: 'bg-red-500',
      text: 'text-red-400',
      bg: 'bg-red-500/10',
    },
    interrupted: {
      label: 'Interrupted',
      dot: 'bg-orange-500',
      text: 'text-orange-400',
      bg: 'bg-orange-500/10',
    },
  };
  const c = config[status] ?? config['completed']!;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold',
        c.bg,
        c.text,
      )}
    >
      <span className="relative flex h-1.5 w-1.5">
        {c.pulse && (
          <span
            className={cn(
              'absolute inline-flex h-full w-full animate-ping rounded-full opacity-75',
              c.dot,
            )}
          />
        )}
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
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const ms = now - new Date(startedAt).getTime();
  return <span className="font-mono text-xs text-[var(--theme-text-muted)]">{formatDuration(ms)}</span>;
}

// ── Relative time ──

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

// ── Token display ──

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
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

  const handleCancel = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (cancelState === 'idle') {
        setCancelState('confirming');
        cancelTimerRef.current = setTimeout(() => setCancelState('idle'), 1500);
      } else if (cancelState === 'confirming') {
        if (cancelTimerRef.current) clearTimeout(cancelTimerRef.current);
        setCancelState('cancelling');
        try {
          await cancelExecution(entry.id);
        } catch {
          /* ignore */
        }
        setCancelState('idle');
      }
    },
    [cancelState, entry.id],
  );

  const handleRowClick = useCallback(() => {
    setShowPanel(true);
  }, []);

  return (
    <>
      <div
        onClick={handleRowClick}
        className={cn(
          'group flex cursor-pointer items-center gap-4 rounded-lg border border-transparent px-4 py-3 transition-colors',
          'hover:border-[var(--theme-border)] hover:bg-[var(--theme-bg-hover)]',
        )}
      >
        {/* Type badge */}
        <TypeBadge type={entry.type} />

        {/* Main info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-[var(--theme-text-primary)]">
              {entry.executorName} on {entry.ticketSlug ?? entry.ticketId.slice(0, 6)}
            </span>
            <ModeBadge mode={entry.effectiveMode} />
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--theme-text-faint)]">
            {entry.ticketTitle && (
              <span className="max-w-[300px] truncate">{entry.ticketTitle}</span>
            )}
            <span>·</span>
            <span>{relativeTime(entry.startedAt)}</span>
          </div>
        </div>

        {/* Executor name (right side, like mock) */}
        <div className="hidden min-w-[120px] text-right lg:block">
          <div className="text-xs font-medium text-[var(--theme-text-secondary)]">
            {entry.executorName}
          </div>
          {entry.model && (
            <div className="text-[10px] text-[var(--theme-text-faint)]">
              {entry.model}
            </div>
          )}
        </div>

        {/* Token stats */}
        {(entry.inputTokens || entry.outputTokens) && (
          <div className="hidden min-w-[80px] text-right text-[10px] text-[var(--theme-text-faint)] xl:block">
            {entry.inputTokens != null && (
              <span>in: {formatTokens(entry.inputTokens)}</span>
            )}
            {entry.inputTokens != null && entry.outputTokens != null && <span> · </span>}
            {entry.outputTokens != null && (
              <span>out: {formatTokens(entry.outputTokens)}</span>
            )}
          </div>
        )}

        {/* Cost */}
        {entry.costUsd != null && entry.costUsd > 0 && (
          <div className="hidden min-w-[50px] text-right text-[10px] text-[var(--theme-text-faint)] xl:block">
            ${entry.costUsd.toFixed(2)}
          </div>
        )}

        {/* Status badge */}
        <StatusBadge status={entry.status} />

        {/* Duration */}
        <div className="min-w-[60px] text-right">
          {live ? (
            <LiveDuration startedAt={entry.startedAt} />
          ) : entry.durationMs != null ? (
            <span className="font-mono text-xs text-[var(--theme-text-muted)]">
              {formatDuration(entry.durationMs)}
            </span>
          ) : null}
        </div>

        {/* Cancel / Chevron */}
        <div className="flex w-[70px] items-center justify-end gap-1">
          {live && (
            <button
              onClick={handleCancel}
              className={cn(
                'rounded px-2 py-0.5 text-[10px] font-semibold opacity-0 transition-opacity group-hover:opacity-100',
                cancelState === 'confirming'
                  ? 'bg-red-500 text-white opacity-100'
                  : cancelState === 'cancelling'
                    ? 'cursor-wait bg-red-500/20 text-red-400 opacity-100'
                    : 'bg-red-500/10 text-red-400 hover:bg-red-500/20',
              )}
            >
              {cancelState === 'idle' && 'Cancel'}
              {cancelState === 'confirming' && 'Confirm?'}
              {cancelState === 'cancelling' && 'Stopping…'}
            </button>
          )}
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="flex-shrink-0 text-[var(--theme-text-faint)] opacity-0 transition-opacity group-hover:opacity-100"
          >
            <polyline points="6,4 10,8 6,12" />
          </svg>
        </div>
      </div>

      {/* Floating execution panel */}
      {showPanel && (
        <FloatingExecutionPanel
          executionId={entry.id}
          title={`${entry.executorName} on ${entry.ticketSlug ?? entry.ticketId.slice(0, 6)}`}
          onClose={() => setShowPanel(false)}
        />
      )}
    </>
  );
});
