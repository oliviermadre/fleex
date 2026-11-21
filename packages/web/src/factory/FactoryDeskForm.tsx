import { useCallback, useState } from 'react';
import { TICKET_PRIORITIES, TICKET_TYPES, type Ticket, type TicketPriority, type TicketType } from '@fleex/shared';
import { NewTask } from '../components/work/new/NewTask';
import { NewTaskDraftProvider, type NewTaskDraftState } from '../components/work/new/newTaskDraft';
import { EMPTY_DRAFT } from '../components/work/new/draftMigration';
import type { WorkDraft } from '../stores/workStore';
import { useTicketStore } from '../stores/ticketStore';
import { toast } from '../lib/toast';
import { FactoryPopup } from './FactoryPopup';
import { useFactoryStore } from './factoryStore';
import type { DeskSpec } from './types';

const TYPES: readonly string[] = TICKET_TYPES, PRIORITIES: readonly string[] = TICKET_PRIORITIES;

/** The draft a desk starts from: the first screen of the flow (a title, a link, or a source), with the desk's board, type and priority. */
export function deskDraft(desk: DeskSpec | null, boardIds: readonly string[]): WorkDraft {
  const d = desk?.defaults ?? {};
  return {
    ...EMPTY_DRAFT,
    stage: 'entry',
    boardId: d.boardId && boardIds.includes(d.boardId) ? d.boardId : null,
    ...(d.type && TYPES.includes(d.type) ? { type: d.type as TicketType } : {}),
    ...(d.priority && PRIORITIES.includes(d.priority) ? { priority: d.priority as TicketPriority } : {}),
  };
}

/**
 * The new-task flow of the Work view, over the floor, as it is (`NewTask`, with a draft of its own): a title, a link
 * that is recognised and imported, or a source to browse (GitHub issues and pull requests, Slack), then the composer.
 * The ticket it creates is born at the desk it was opened on: it is handed over to the Factory right there, and an arm
 * takes it out. With no desk on the floor it is handed over without a target, so it lands in Inbound. An import that
 * already has a ticket opens that ticket (`onOpenTicket`) instead of creating a second one.
 */
export function FactoryDeskForm({ desk, onClose, onOpenTicket }: { desk: DeskSpec | null; onClose: () => void; onOpenTicket: (ticketId: string) => void }) {
  const boards = useTicketStore((s) => s.boards);
  const [draft, setDraft] = useState<WorkDraft>(() => deskDraft(desk, boards.map((b) => b.id)));
  const draftState: NewTaskDraftState = {
    draft,
    update: (patch) => setDraft((d) => ({ ...d, ...patch })),
    /* starting over keeps what the desk gives */
    reset: () => setDraft(deskDraft(desk, boards.map((b) => b.id))),
    cancel: onClose,
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
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <NewTaskDraftProvider value={draftState}>
          <NewTask onCreated={created} onOpenTicket={(id) => { onClose(); onOpenTicket(id); }} />
        </NewTaskDraftProvider>
      </div>
    </FactoryPopup>
  );
}
