/**
 * A timeline card for one agent execution (SPEC §5 / §6.2). It sits just before
 * the comment the run produced and shows the persona, the run's state and a
 * little meta (duration · cost). Clicking opens the execution log — the same
 * FloatingExecutionPanel the Kanban conversation uses — via `onOpen`.
 */
import { useState } from 'react';
import type { AgentExecution } from '@fleex/shared';
import { useAgentPersonaStore } from '../../../stores/agentPersonaStore';
import { toast } from '../../../lib/toast';
import { cn } from '../../../lib/cn';
import { tintText } from '../../../lib/tints';
import * as api from '../../../services/api';

type RunState = AgentExecution['status'];

const STATE_LABEL: Record<RunState, string> = {
  running: 'running',
  completed: 'ran',
  failed: 'failed',
  interrupted: 'interrupted',
};

/** Compact duration between two ISO timestamps, e.g. "12s" or "3m 05s". */
function formatDuration(startedAt: string, completedAt: string): string | null {
  const ms = Date.parse(completedAt) - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${String(s % 60).padStart(2, '0')}s`;
}

export function RunCard({
  execution,
  onOpen,
}: {
  execution: AgentExecution;
  onOpen: (executionId: string, title: string) => void;
}) {
  const [terminatingId, setTerminatingId] = useState<string | null>(null);
  const personaName = useAgentPersonaStore(
    (s) => s.personas.find((p) => p.id === execution.personaId)?.displayName,
  );
  const name = personaName ?? execution.model ?? 'Agent';
  const state = execution.status;

  const handleManualTerminate = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (state !== 'running') return;

    setTerminatingId(execution.id);
    try {
      await api.terminateExecution(execution.id);
      toast.success(`Terminated ${name}'s run.`);
    } catch (err) {
      toast.error(`Failed to terminate run`, {
        detail: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setTerminatingId(null);
    }
  };

  const stateText =
    state === 'completed'
      ? 'text-[var(--theme-text-muted)]'
      : state === 'failed'
        ? tintText('red')
        : state === 'interrupted'
          ? tintText('yellow')
          : 'text-[var(--theme-accent)]';

  const meta: string[] = [];
  if (state === 'completed' && execution.completedAt) {
    const d = formatDuration(execution.startedAt, execution.completedAt);
    if (d) meta.push(d);
  }
  if (execution.costUsd != null && execution.costUsd > 0) meta.push(`$${execution.costUsd.toFixed(2)}`);

  return (
    <button
      type="button"
      onClick={() => onOpen(execution.id, `${name} · execution log`)}
      title="Open execution log"
      className="group flex w-full items-center gap-2 rounded-md border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-surface)] px-2.5 py-1.5 text-left transition-colors hover:border-[var(--theme-accent)] hover:bg-[var(--theme-accent-muted)]"
    >
      <span aria-hidden className="text-[12px] text-[var(--tint-purple-text)]">⌬</span>

      {/* Manually-terminated badge */}
      {execution.manuallyTerminatedByUser && (
        <span className="shrink-0 text-[11px] font-semibold text-[var(--tint-red-text)]" title="Manually terminated by user">
          🛑
        </span>
      )}

      <span className="truncate text-[12px] text-[var(--theme-text-secondary)]">{name}</span>
      <span className={cn('flex items-center gap-1 text-[11px]', stateText)}>
        {state === 'running' && (
          <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--theme-accent)]" />
        )}
        {STATE_LABEL[state]}
      </span>
      {meta.length > 0 && (
        <span className="font-mono text-[10.5px] text-[var(--theme-text-faint)]">{meta.join(' · ')}</span>
      )}

      {/* Manual termination button (Priority 4) */}
      {state === 'running' && (
        <button
          type="button"
          onClick={handleManualTerminate}
          disabled={terminatingId === execution.id}
          title="Stop this run immediately"
          className="ml-auto shrink-0 rounded-md border border-[var(--tint-red-border)] bg-[var(--tint-red-bg)] px-1.5 py-0.5 text-[10px] text-[var(--tint-red-text)] transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {terminatingId === execution.id ? '⏳' : '🛑'} Stop
        </button>
      )}

      {state !== 'running' && (
        <span className="ml-auto shrink-0 text-[10.5px] text-[var(--theme-text-faint)] group-hover:text-[var(--theme-accent-fg)]">
          view log ›
        </span>
      )}
    </button>
  );
}
