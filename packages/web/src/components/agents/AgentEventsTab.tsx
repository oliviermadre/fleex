import { useEffect, useState } from 'react';
import type { AgentExecution } from '@asm/shared';
import { useAgentEventStore } from '../../stores/agentEventStore';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';
import { AgentEventStream } from '../main-panel/AgentEventStream';
import { cn } from '../../lib/cn';

const EMPTY_EXECUTIONS: AgentExecution[] = [];

export function AgentEventsTab() {
  const selectedPersonaId = useAgentPersonaStore((s) => s.selectedPersonaId);
  const executions = useAgentEventStore((s) =>
    selectedPersonaId ? s.executionsByPersona[selectedPersonaId] ?? EMPTY_EXECUTIONS : EMPTY_EXECUTIONS
  );
  const loadExecutions = useAgentEventStore((s) => s.loadExecutionsForPersona);
  const [expandedExecutionId, setExpandedExecutionId] = useState<string | null>(null);

  useEffect(() => {
    if (selectedPersonaId) {
      loadExecutions(selectedPersonaId);
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
            <div className="flex flex-col min-w-0">
              <span className="text-sm text-[var(--theme-text-primary)] truncate">
                Ticket: {exec.ticketId.slice(0, 8)}...
              </span>
              <span className="text-xs text-[var(--theme-text-faint)]">
                {new Date(exec.startedAt).toLocaleString()} · {exec.eventCount} events
              </span>
              <span className="text-[10px] font-mono text-[var(--theme-text-faint)] opacity-60">
                exec:{exec.id}
                {exec.sdkSessionId ? ` · session:${exec.sdkSessionId}` : ''}
              </span>
            </div>
            <span className="ml-auto text-[var(--theme-text-faint)]">
              {expandedExecutionId === exec.id ? '▾' : '▸'}
            </span>
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
  const config = ({
    running: { bg: 'bg-blue-500/15', text: 'text-blue-400', label: 'Running' },
    completed: { bg: 'bg-green-500/15', text: 'text-green-400', label: 'Completed' },
    failed: { bg: 'bg-red-500/15', text: 'text-red-400', label: 'Failed' },
    interrupted: { bg: 'bg-yellow-500/15', text: 'text-yellow-400', label: 'Interrupted' },
  } as const)[status];

  return (
    <span className={cn('shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium', config.bg, config.text)}>
      {config.label}
    </span>
  );
}
