import { useEffect, useState } from 'react';
import type { AgentExecution } from '@asm/shared';
import { useAgentEventStore } from '../../stores/agentEventStore';
import { useTicketStore } from '../../stores/ticketStore';
import { AgentEventStream } from './AgentEventStream';
import { cn } from '../../lib/cn';

const EMPTY_EXECUTIONS: AgentExecution[] = [];

interface Props {
  ticketId: string;
}

export function AgentWorktreePanel({ ticketId }: Props) {
  const ticket = useTicketStore((s) => s.tickets.find((t) => t.id === ticketId));
  const executions = useAgentEventStore((s) => s.executionsByTicket[ticketId] ?? EMPTY_EXECUTIONS);
  const loadExecutions = useAgentEventStore((s) => s.loadExecutionsForTicket);
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(null);

  useEffect(() => {
    loadExecutions(ticketId);
  }, [ticketId, loadExecutions]);

  // Auto-select latest execution
  useEffect(() => {
    if (executions.length > 0 && !selectedExecutionId) {
      setSelectedExecutionId(executions[0]!.id);
    }
  }, [executions, selectedExecutionId]);

  if (!ticket) {
    return (
      <div className="flex flex-1 items-center justify-center text-[var(--theme-text-faint)]">
        Ticket not found
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-[var(--theme-bg-primary)]">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--theme-border)] bg-[var(--theme-bg-secondary)]">
        <span className="text-xs font-mono text-[var(--theme-text-faint)]">#{ticket.displayId}</span>
        <span className="font-semibold text-[var(--theme-text-primary)] truncate">{ticket.title}</span>
        {ticket.assignee && (
          <span className="ml-auto text-xs px-2 py-0.5 rounded bg-[var(--theme-accent-muted)] text-[var(--theme-accent)]">
            @{ticket.assignee}
          </span>
        )}
      </div>

      {/* Execution tabs */}
      {executions.length > 0 && (
        <div className="flex items-center gap-1 px-4 py-1.5 border-b border-[var(--theme-border)] bg-[var(--theme-bg-secondary)] overflow-x-auto">
          {executions.map((exec) => (
            <ExecutionTab
              key={exec.id}
              execution={exec}
              isSelected={exec.id === selectedExecutionId}
              onClick={() => setSelectedExecutionId(exec.id)}
            />
          ))}
        </div>
      )}

      {/* Event stream */}
      {selectedExecutionId ? (
        <AgentEventStream executionId={selectedExecutionId} />
      ) : (
        <div className="flex flex-1 items-center justify-center text-[var(--theme-text-faint)]">
          No executions yet
        </div>
      )}
    </div>
  );
}

function ExecutionTab({ execution, isSelected, onClick }: {
  execution: AgentExecution;
  isSelected: boolean;
  onClick: () => void;
}) {
  const statusColor = execution.status === 'running' ? 'text-blue-400'
    : execution.status === 'completed' ? 'text-green-400'
    : execution.status === 'failed' ? 'text-red-400'
    : 'text-[var(--theme-text-faint)]';

  const time = new Date(execution.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <button
      className={cn(
        'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors',
        isSelected
          ? 'bg-[var(--theme-bg-hover)] text-[var(--theme-text-primary)]'
          : 'text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]'
      )}
      onClick={onClick}
    >
      <span className={cn('w-1.5 h-1.5 rounded-full', statusColor.replace('text-', 'bg-'))} />
      <span>{time}</span>
      <span className="text-[var(--theme-text-faint)]">({execution.eventCount})</span>
    </button>
  );
}
