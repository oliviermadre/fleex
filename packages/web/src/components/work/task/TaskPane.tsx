/**
 * The center column when a task is selected: header, conversation stream and
 * composer. Reads the ticket's description from ticketStore for the opening
 * message and drives comments through useTaskConversation. It also loads the
 * ticket's agent executions (for the run cards) and owns the floating execution
 * log a run card opens. Deliverables come down from WorkView (one shared WS-live
 * subscription). The composer draft is persisted per ticket (useCommentDraft,
 * localStorage) so unsent text survives switching tasks and coming back. The
 * suggestion chips are deferred to a dedicated task — the `Suggestions` component
 * and its `suggestionsFor` rules are kept for that.
 */
import { useEffect } from 'react';
import type { TicketDeliverable } from '@fleex/shared';
import { useTicketStore } from '../../../stores/ticketStore';
import { useAgentEventStore } from '../../../stores/agentEventStore';
import { useAgentPersonas } from '../../../hooks/useAgentPersonas';
import { useCommentDraft } from '../../../hooks/useCommentDraft';
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
  // Draft is keyed by ticket and stored in localStorage; useCommentDraft re-reads
  // synchronously when the key (task) changes, so switching tasks swaps drafts
  // without a remount and none bleeds into another.
  const { draft, setDraft } = useCommentDraft(task?.id ?? '');

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
        ticketId={task.id}
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
      <Composer
        ticketId={task.id}
        value={draft}
        onChange={setDraft}
        posting={convo.posting}
        onSend={convo.post}
      />
    </div>
  );
}
