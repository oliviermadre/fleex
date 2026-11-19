import { useCallback, useState } from 'react';
import { TICKET_PRIORITIES, TICKET_TYPES, type Ticket, type TicketPriority, type TicketType } from '@fleex/shared';
import { NewTaskCompose, type ComposeDraftState } from '../components/work/new/NewTaskCompose';
import { EMPTY_DRAFT } from '../components/work/new/draftMigration';
import type { WorkDraft } from '../stores/workStore';
import { useTicketStore } from '../stores/ticketStore';
import { toast } from '../lib/toast';
import { FactoryPopup } from './FactoryPopup';
import { useFactoryStore } from './factoryStore';
import type { DeskSpec } from './types';

const TYPES: readonly string[] = TICKET_TYPES, PRIORITIES: readonly string[] = TICKET_PRIORITIES;

/** The draft a desk starts from: the composer, empty, with the desk's board, type and priority. */
export function deskDraft(desk: DeskSpec | null, boardIds: readonly string[]): WorkDraft {
  const d = desk?.defaults ?? {};
  return {
    ...EMPTY_DRAFT,
    stage: 'compose',
    boardId: d.boardId && boardIds.includes(d.boardId) ? d.boardId : null,
    ...(d.type && TYPES.includes(d.type) ? { type: d.type as TicketType } : {}),
    ...(d.priority && PRIORITIES.includes(d.priority) ? { priority: d.priority as TicketPriority } : {}),
  };
}

/**
 * The ticket creation form of the Work view, over the floor (`NewTaskCompose` as it is, with a draft of its own).
 * The ticket it creates is born at the desk it was opened on: it is handed over to the Factory right there, and an arm
 * takes it out. With no desk on the floor it is handed over without a target, so it lands in Inbound.
 */
export function FactoryDeskForm({ desk, onClose }: { desk: DeskSpec | null; onClose: () => void }) {
  const boards = useTicketStore((s) => s.boards);
  const [draft, setDraft] = useState<WorkDraft>(() => deskDraft(desk, boards.map((b) => b.id)));
  const draftState: ComposeDraftState = {
    draft,
    update: (patch) => setDraft((d) => ({ ...d, ...patch })),
    /* starting over keeps what the desk gives */
    reset: () => setDraft(deskDraft(desk, boards.map((b) => b.id))),
  };
  const where = desk ? desk.name || 'Desk' : 'Inbound';

  const created = useCallback(async (ticket: Ticket) => {
    await useFactoryStore.getState().transfer(ticket.id, desk ? { machineId: desk.id } : {});
    toast.success(`#${ticket.displayId} ${ticket.title}`, { detail: desk ? `Born at ${where}` : 'Landed in Inbound: no desk on the floor' });
    onClose();
  }, [desk, where, onClose]);

  return (
    <FactoryPopup label={`New ticket at ${where}`} onClose={onClose} size="fit" maxWidth="max-w-3xl"
      bar={<span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--theme-text-primary)]">New ticket <span className="font-normal text-[var(--theme-text-muted)]">· {desk ? `born at ${where}` : 'lands in Inbound'}</span></span>}>
      <NewTaskCompose onStartOver={draftState.reset} draftState={draftState} onCreated={created} onCancel={onClose} />
    </FactoryPopup>
  );
}
