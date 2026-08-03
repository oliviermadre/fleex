import { useCallback, useEffect, useState } from 'react';
import type { AgentExecution } from '@fleex/shared';
import { useAgentEventStore } from '../../stores/agentEventStore';
import { AgentEventStream } from './AgentEventStream';
import { cn } from '../../lib/cn';
import * as api from '../../services/api';
import { tint, tintText, tintClasses } from '../../lib/tints';
import { createLogger } from '../../lib/logger';

const log = createLogger('components/main-panel/AgentExecutionsPanel');

function formatDuration(startedAt: string, completedAt?: string | null): string {
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const diffMs = Math.max(0, end - start);
  const totalSeconds = Math.floor(diffMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}

function useTickingClock(active: boolean): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [active]);
  return tick;
}

interface Props {
  executions: AgentExecution[];
}

export function AgentExecutionsPanel({ executions }: Props) {
  // Latest execution is expanded by default, others collapsed
  const sorted = [...executions].sort(
    (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
  );
  const latestId = sorted.length > 0 ? sorted[sorted.length - 1]!.id : null;

  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(latestId ? [latestId] : []),
  );

  // When a new execution arrives, auto-expand it and collapse the previous latest
  const [prevLatestId, setPrevLatestId] = useState(latestId);
  if (latestId !== prevLatestId) {
    setPrevLatestId(latestId);
    setExpandedIds(new Set(latestId ? [latestId] : []));
  }

  const hasRunning = sorted.some((e) => e.status === 'running');
  useTickingClock(hasRunning);

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const loadExecutions = useAgentEventStore((s) => s.loadExecutionsForTicket);

  const handleCancel = useCallback(async (executionId: string, ticketId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Cancel this execution? The agent will be interrupted and the mention reset to pending.')) return;
    try {
      await api.cancelExecution(executionId);
      loadExecutions(ticketId);
    } catch (err) {
      log.error('Failed to cancel execution', { err });
    }
  }, [loadExecutions]);

  if (sorted.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-[var(--theme-text-faint)]">
        No executions yet
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto bg-[var(--theme-bg-primary)]">
      {sorted.map((exec) => {
        const isExpanded = expandedIds.has(exec.id);
        return (
          <div key={exec.id} className="border-b border-[var(--theme-border)]">
            <button
              className={cn(
                'w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[var(--theme-bg-hover)] transition-colors',
                isExpanded && 'bg-[var(--theme-bg-hover)]',
              )}
              onClick={() => toggleExpanded(exec.id)}
            >
              <StatusBadge status={exec.status} />
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-xs text-[var(--theme-text-faint)]">
                  {new Date(exec.startedAt).toLocaleString(undefined, { hour12: false })}
                  {' · '}{exec.eventCount} events
                  {exec.status === 'running' && (
                    <> · <span className={tintText('blue')}>{formatDuration(exec.startedAt)}</span></>
                  )}
                  {exec.status !== 'running' && exec.completedAt && (
                    <> · {formatDuration(exec.startedAt, exec.completedAt)}</>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-2 ml-auto shrink-0">
                {exec.status === 'running' && (
                  <span
                    role="button"
                    tabIndex={0}
                    className={cn('px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer', tintClasses('red').bg, tintText('red'), tintClasses('red').hoverBg)}
                    onClick={(e) => handleCancel(exec.id, exec.ticketId, e)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleCancel(exec.id, exec.ticketId, e as unknown as React.MouseEvent); }}
                  >
                    Cancel
                  </span>
                )}
                <span className="text-[var(--theme-text-faint)]">
                  {isExpanded ? '▾' : '▸'}
                </span>
              </div>
            </button>
            {isExpanded && (
              <div className="flex flex-col overflow-hidden border-t border-[var(--theme-border)]" style={{ minHeight: '200px', maxHeight: '80vh' }}>
                <AgentEventStream executionId={exec.id} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function StatusBadge({ status }: { status: AgentExecution['status'] }) {
  const statusMap = {
    running: { classes: tint('blue'), label: 'Running' },
    completed: { classes: tint('green'), label: 'Completed' },
    failed: { classes: tint('red'), label: 'Failed' },
    interrupted: { classes: tint('yellow'), label: 'Interrupted' },
  } as const;
  const config = statusMap[status as keyof typeof statusMap];

  return (
    <span className={cn('shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium', config.classes)}>
      {config.label}
    </span>
  );
}
