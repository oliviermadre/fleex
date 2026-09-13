/**
 * The center column when a task is selected: header, conversation stream and
 * composer. Reads the ticket's description from ticketStore for the opening
 * message and drives comments through useTaskConversation. It also loads the
 * ticket's agent executions (for the run cards) and owns the floating execution
 * log a run card opens. Deliverables come down from WorkView (one shared WS-live
 * subscription). The composer text is owned here (cleared on task switch). The
 * suggestion chips are deferred to a dedicated task — the `Suggestions` component
 * and its `suggestionsFor` rules are kept for that.
 */
import { useEffect, useState } from 'react';
import type { TicketDeliverable } from '@fleex/shared';
import { useTicketStore } from '../../../stores/ticketStore';
import { useAgentEventStore } from '../../../stores/agentEventStore';
import { useAgentPersonas } from '../../../hooks/useAgentPersonas';
import type { WorkTask } from '../types';
import { TaskHeader } from './TaskHeader';
import { TaskStream } from './TaskStream';
import { Composer } from './Composer';
import { useTaskConversation } from './useTaskConversation';

export function TaskPane({
  task,
  deliverables,
  onOpenExecution,
}: {
  task: WorkTask | null;
  deliverables: TicketDeliverable[];
  onOpenExecution: (executionId: string, title: string) => void;
}) {
  const description = useTicketStore((s) =>
    task ? s.tickets.find((t) => t.id === task.id)?.description ?? null : null,
  );
  const convo = useTaskConversation(task?.id ?? null);
  const [composer, setComposer] = useState('');

  // Agent runs for this ticket → the run cards. Persona names come from the
  // persona store (kept fresh here); the executions say who ran and their state.
  useAgentPersonas();
  const executions = useAgentEventStore((s) => (task ? s.executionsByTicket[task.id] : undefined));
  const loadExecutionsForTicket = useAgentEventStore((s) => s.loadExecutionsForTicket);
  const subscribeTicket = useAgentEventStore((s) => s.subscribeTicket);
  const unsubscribeTicket = useAgentEventStore((s) => s.unsubscribeTicket);
  useEffect(() => {
    if (!task) return;
    loadExecutionsForTicket(task.id);
    subscribeTicket(task.id);
    return () => unsubscribeTicket(task.id);
  }, [task?.id, loadExecutionsForTicket, subscribeTicket, unsubscribeTicket]);

  // Clear the draft when switching tasks so a seeded mention doesn't leak across.
  useEffect(() => {
    setComposer('');
  }, [task?.id]);

  if (!task) {
    return (
      <div className="flex flex-1 items-center justify-center text-[13px] text-[var(--theme-text-faint)]">
        Select a task, or start a new one.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TaskHeader task={task} />
      <TaskStream
        description={description}
        comments={convo.comments}
        events={convo.events}
        executions={executions ?? []}
        deliverables={deliverables}
        activity={task.activity}
        loading={convo.loading}
        error={convo.error}
        onAnswer={convo.post}
        onOpenExecution={onOpenExecution}
      />
      <Composer value={composer} onChange={setComposer} posting={convo.posting} onSend={convo.post} />
    </div>
  );
}
