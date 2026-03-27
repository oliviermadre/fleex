import { useCallback, useEffect, useState } from 'react';
import type { AgentExecution } from '@fleex/shared';
import { useAgentEventStore } from '../../stores/agentEventStore';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';
import { AgentEventStream } from '../main-panel/AgentEventStream';
import { cn } from '../../lib/cn';
import * as api from '../../services/api';

const EMPTY_EXECUTIONS: AgentExecution[] = [];

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

function formatTimeAgo(isoString: string): string {
  const diffMs = Math.max(0, Date.now() - new Date(isoString).getTime());
  const totalSeconds = Math.floor(diffMs / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s ago`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m ago`;
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

export function AgentEventsTab() {
  const selectedPersonaId = useAgentPersonaStore((s) => s.selectedPersonaId);
  const executions = useAgentEventStore((s) =>
    selectedPersonaId ? s.executionsByPersona[selectedPersonaId] ?? EMPTY_EXECUTIONS : EMPTY_EXECUTIONS
  );
  const loadExecutions = useAgentEventStore((s) => s.loadExecutionsForPersona);
  const [expandedExecutionId, setExpandedExecutionId] = useState<string | null>(null);

  const hasRunning = executions.some((e) => e.status === 'running');
  useTickingClock(hasRunning);

  useEffect(() => {
    if (selectedPersonaId) {
      loadExecutions(selectedPersonaId);
    }
  }, [selectedPersonaId, loadExecutions]);

  const handleCancel = useCallback(async (executionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Cancel this execution? The agent will be interrupted and the mention reset to pending.')) return;
    try {
      await api.cancelExecution(executionId);
      if (selectedPersonaId) loadExecutions(selectedPersonaId);
    } catch (err) {
      console.error('Failed to cancel execution:', err);
    }
  }, [selectedPersonaId, loadExecutions]);

  if (!selectedPersonaId) {
    return (
      <div className="flex flex-1 items-center justify-center text-[var(--theme-text-faint)]">
        Select a persona to view events
      </div>
    );
  }

  if (executions.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-[var(--theme-text-faint)]">
        No executions yet
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      {executions.map((exec) => (
        <div key={exec.id} className="border-b border-[var(--theme-border)]">
          <button
            className={cn(
              'w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[var(--theme-bg-hover)] transition-colors',
              expandedExecutionId === exec.id && 'bg-[var(--theme-bg-hover)]'
            )}
            onClick={() => setExpandedExecutionId(
              expandedExecutionId === exec.id ? null : exec.id
            )}
          >
            <StatusBadge status={exec.status} />
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-sm text-[var(--theme-text-primary)] truncate">
                Ticket: {exec.ticketId.slice(0, 8)}...
              </span>
              <span className="text-xs text-[var(--theme-text-faint)]">
                {new Date(exec.startedAt).toLocaleString(undefined, { hour12: false })}
                {' · '}{exec.eventCount} events
                {exec.status === 'running' && (
                  <> · <span className="text-blue-400">{formatDuration(exec.startedAt)}</span></>
                )}
                {exec.status !== 'running' && exec.completedAt && (
                  <> · {formatDuration(exec.startedAt, exec.completedAt)}</>
                )}
                {exec.status === 'running' && exec.lastEventAt && (
                  <> · last event {formatTimeAgo(exec.lastEventAt)}</>
                )}
              </span>
              <span className="text-[10px] font-mono text-[var(--theme-text-faint)] opacity-60">
                exec:{exec.id}
                {exec.sdkSessionId ? ` · session:${exec.sdkSessionId}` : ''}
              </span>
            </div>
            <div className="flex items-center gap-2 ml-auto shrink-0">
              {exec.status === 'running' && (
                <span
                  role="button"
                  tabIndex={0}
                  className="px-2 py-0.5 rounded text-[10px] font-medium bg-red-500/15 text-red-400 hover:bg-red-500/30 transition-colors cursor-pointer"
                  onClick={(e) => handleCancel(exec.id, e)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCancel(exec.id, e as unknown as React.MouseEvent); }}
                >
                  Cancel
                </span>
              )}
              <span className="text-[var(--theme-text-faint)]">
                {expandedExecutionId === exec.id ? '▾' : '▸'}
              </span>
            </div>
          </button>
          {expandedExecutionId === exec.id && (
            <div className="h-80 flex flex-col overflow-hidden border-t border-[var(--theme-border)]">
              <AgentEventStream executionId={exec.id} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: AgentExecution['status'] }) {
  const statusMap = {
    running: { bg: 'bg-blue-500/15', text: 'text-blue-400', label: 'Running' },
    completed: { bg: 'bg-green-500/15', text: 'text-green-400', label: 'Completed' },
    failed: { bg: 'bg-red-500/15', text: 'text-red-400', label: 'Failed' },
    interrupted: { bg: 'bg-yellow-500/15', text: 'text-yellow-400', label: 'Interrupted' },
  } as const;
  const config = statusMap[status as keyof typeof statusMap];

  return (
    <span className={cn('shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium', config.bg, config.text)}>
      {config.label}
    </span>
  );
}
