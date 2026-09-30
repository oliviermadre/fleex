/**
 * The ticket's conversation inside the Focus popup: the same stream as the Tasks
 * chat (description, comments, agent runs, deliverables, activity lines), live
 * over the tickets WS channel. Its answerable cards are off — the popup's action
 * zone owns the choices, so they are never offered twice.
 */
import { useEffect } from 'react';
import type { Ticket, TicketDeliverable } from '@fleex/shared';
import { useAgentEventStore } from '../../stores/agentEventStore';
import { useAgentPersonas } from '../../hooks/useAgentPersonas';
import { useTaskConversation } from '../work/task/useTaskConversation';
import { TaskStream } from '../work/task/TaskStream';

interface Props {
  ticket: Ticket;
  deliverables: TicketDeliverable[];
  onOpenLogs: (executionId: string) => void;
}

export function FocusThread({ ticket, deliverables, onOpenLogs }: Props) {
  const convo = useTaskConversation(ticket.id);

  // Agent runs → the run cards (persona names come from the persona store).
  useAgentPersonas();
  const executions = useAgentEventStore((s) => s.executionsByTicket[ticket.id]);
  const loadExecutionsForTicket = useAgentEventStore((s) => s.loadExecutionsForTicket);
  const subscribeTicket = useAgentEventStore((s) => s.subscribeTicket);
  const unsubscribeTicket = useAgentEventStore((s) => s.unsubscribeTicket);
  useEffect(() => {
    loadExecutionsForTicket(ticket.id);
    subscribeTicket(ticket.id);
    return () => unsubscribeTicket(ticket.id);
  }, [ticket.id, loadExecutionsForTicket, subscribeTicket, unsubscribeTicket]);

  return (
    <TaskStream
      ticketId={ticket.id}
      description={ticket.description ?? null}
      comments={convo.comments}
      events={convo.events}
      executions={executions ?? []}
      deliverables={deliverables}
      activity="idle"
      loading={convo.loading}
      error={convo.error}
      onAnswer={() => {}}
      onOpenExecution={(executionId) => onOpenLogs(executionId)}
      showActionCards={false}
    />
  );
}
