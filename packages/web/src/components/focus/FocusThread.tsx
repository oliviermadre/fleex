/**
 * The ticket's conversation inside the Focus popup: the same stream as the Tasks
 * chat (description, comments, agent runs, deliverables, activity lines), live
 * over the tickets WS channel. Its answerable cards are off — the popup's action
 * zone owns the choices, so they are never offered twice.
 *
 * With « Assistant & threads » on, the popup's composer talks to the assistant,
 * so what the assistant does shows here as in the Tasks view: its answer while
 * it streams, a delegation card per thread, and its mode request with the two
 * buttons — the only place of the popup where that request can be answered.
 */
import { useCallback, useEffect, useMemo } from 'react';
import type { Ticket, TicketDeliverable } from '@fleex/shared';
import { useAgentEventStore } from '../../stores/agentEventStore';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useWorkStore } from '../../stores/workStore';
import { useAgentPersonas } from '../../hooks/useAgentPersonas';
import { useTaskConversation } from '../work/task/useTaskConversation';
import { useTicketThreads } from '../work/panel/useTicketThreads';
import { useTicketMentions } from '../work/task/useTicketMentions';
import { useModeRequestActions } from '../work/task/useModeRequestActions';
import { openTicketInWork } from '../work/openInWork';
import { TaskStream } from '../work/task/TaskStream';

interface Props {
  ticket: Ticket;
  deliverables: TicketDeliverable[];
  onOpenLogs: (executionId: string) => void;
}

export function FocusThread({ ticket, deliverables, onOpenLogs }: Props) {
  const convo = useTaskConversation(ticket.id);
  const threadsEnabled = useSettingsStore((s) => s.settings.workThreadsEnabled) === true;

  // Agent runs → the run cards (persona names come from the persona store).
  useAgentPersonas();
  const personas = useAgentPersonaStore((s) => s.personas);
  const executions = useAgentEventStore((s) => s.executionsByTicket[ticket.id]);
  const loadExecutionsForTicket = useAgentEventStore((s) => s.loadExecutionsForTicket);
  const subscribeTicket = useAgentEventStore((s) => s.subscribeTicket);
  const unsubscribeTicket = useAgentEventStore((s) => s.unsubscribeTicket);
  useEffect(() => {
    loadExecutionsForTicket(ticket.id);
    subscribeTicket(ticket.id);
    return () => unsubscribeTicket(ticket.id);
  }, [ticket.id, loadExecutionsForTicket, subscribeTicket, unsubscribeTicket]);

  // Assistant surfaces — nothing is loaded, and nothing changes, with the switch off.
  const threads = useTicketThreads(threadsEnabled ? ticket.id : null);
  const mentions = useTicketMentions(threadsEnabled ? ticket.id : null);
  const personaNames = useMemo(
    () => Object.fromEntries(personas.map((p) => [p.id, p.displayName])) as Record<string, string>,
    [personas],
  );
  const conversationMode = ticket.conversationMode ?? 'plan';
  const { grantMode, declineMode } = useModeRequestActions(ticket.id, conversationMode);
  // The turns of a thread live in the Threads panel of the Tasks view.
  const openThread = useCallback(
    (threadId: string) => {
      useWorkStore.getState().setSelectedThreadId(threadId);
      openTicketInWork(ticket.id, { rightPanel: 'thread' });
    },
    [ticket.id],
  );

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
      {...(threadsEnabled
        ? {
            threads, personaNames, mentions,
            onOpenThread: openThread,
            onAnswerThread: convo.postToThread,
            conversationMode,
            modeRequestActionable: true,
            onGrantMode: grantMode,
            onDeclineMode: declineMode,
          }
        : {})}
    />
  );
}
