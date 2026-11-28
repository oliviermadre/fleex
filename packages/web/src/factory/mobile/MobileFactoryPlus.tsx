import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Ticket } from '@fleex/shared';
import { NewTask } from '../../components/work/new/NewTask';
import { NewTaskDraftProvider, type NewTaskDraftState } from '../../components/work/new/newTaskDraft';
import type { WorkDraft } from '../../stores/workStore';
import { useRepositoryStore } from '../../stores/repositoryStore';
import { useTicketStore } from '../../stores/ticketStore';
import { toast } from '../../lib/toast';
import { MobileSheet } from '../../mobile/MobileSheet';
import { MobilePageHeader } from '../../mobile/MobilePageHeader';
import { useMobileNavStore } from '../../mobile/mobileNavStore';
import { deskDraft } from '../FactoryDeskForm';
import { useFactoryStore } from '../factoryStore';
import type { DeskSpec } from '../types';
import { BTN } from './MobileFactoryActs';
import { sendToFactory } from './gestures';

/** What the + opens next: the creation screen at a desk (null: no desk on the floor, the ticket lands in Inbound), or the tickets of Fleex. */
export type PlusStep = { new: DeskSpec | null } | 'fleex';

/**
 * The + of the Factory's bar: the two ways a ticket comes onto the floor from the phone. A new one, born at a desk
 * (one line a desk when the floor has several); or one Fleex drives today, sent to Inbound.
 */
export function MobileFactoryPlus({ onClose, onPick }: { onClose: () => void; onPick: (step: PlusStep) => void }) {
  const machines = useFactoryStore((s) => s.snapshot?.floor.layout.machines);
  const desks = useMemo(() => (machines ?? []).filter((m): m is DeskSpec => m.kind === 'desk'), [machines]);
  const option = 'flex min-h-[60px] w-full items-center gap-3 rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-3 py-2.5 text-left active:bg-[var(--theme-bg-overlay)]';
  const badge = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[var(--theme-accent)] text-xl font-bold text-[var(--theme-accent-fg)]';
  return (
    <MobileSheet grabber title="Onto the floor" onClose={onClose}>
      <div className="flex flex-col gap-2">
        {(desks.length ? desks : [null]).map((d) => (
          <button key={d?.id ?? 'inbound'} type="button" className={option} onClick={() => onPick({ new: d })}>
            <span className={badge} aria-hidden>+</span>
            <span className="min-w-0 flex-1">
              <b className="block text-[15px] font-semibold text-[var(--theme-text-primary)]">New ticket{desks.length > 1 && d ? ` · ${d.name || 'Desk'}` : ''}</b>
              <span className="block text-[12.5px] text-[var(--theme-text-muted)]">{d ? `Born at ${d.name || 'the desk'}: the first arm that wants it takes it out.` : 'No desk on the floor: it lands in Inbound and waits there.'}</span>
            </span>
          </button>
        ))}
        <button type="button" className={option} onClick={() => onPick('fleex')}>
          <span className={badge} aria-hidden>→</span>
          <span className="min-w-0 flex-1">
            <b className="block text-[15px] font-semibold text-[var(--theme-text-primary)]">From Fleex</b>
            <span className="block text-[12.5px] text-[var(--theme-text-muted)]">Send a ticket Fleex drives today. It waits in Inbound to be released.</span>
          </span>
        </button>
      </div>
    </MobileSheet>
  );
}

/**
 * A ticket born on the floor, from the phone: the new-task flow of Tasks as it is (`NewTask`), on a draft of its own
 * that starts from the desk's board, type and priority. Once created, the ticket is handed over to the Factory at that
 * desk, as the page's own form does (`FactoryDeskForm.tsx`).
 */
export function MobileFactoryNewTicket({ desk, onClose }: { desk: DeskSpec | null; onClose: () => void }) {
  const boards = useTicketStore((s) => s.boards);
  const [draft, setDraft] = useState<WorkDraft>(() => deskDraft(desk, boards.map((b) => b.id)));
  useEffect(() => { void useRepositoryStore.getState().fetchRepositories(); }, []);
  const where = desk ? desk.name || 'Desk' : 'Inbound';
  const draftState: NewTaskDraftState = {
    draft,
    update: (patch) => setDraft((d) => ({ ...d, ...patch })),
    /* starting over keeps what the desk gives */
    reset: () => setDraft(deskDraft(desk, boards.map((b) => b.id))),
    cancel: onClose,
  };
  const created = useCallback(async (ticket: Ticket) => {
    await useFactoryStore.getState().transfer(ticket.id, desk ? { machineId: desk.id } : {});
    toast.success(`#${ticket.displayId} ${ticket.title}`, { detail: desk ? `Born at ${where}` : 'Landed in Inbound: no desk on the floor' });
    onClose();
  }, [desk, where, onClose]);

  return (
    <div className="fixed inset-0 z-[45] flex flex-col bg-[var(--theme-bg-base)]" style={{ paddingTop: 'env(safe-area-inset-top)' }} role="dialog" aria-label={`New ticket at ${where}`}>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--theme-border)] px-2">
        <button type="button" onClick={onClose} className="flex min-h-11 shrink-0 items-center px-2 text-[15px] text-[var(--theme-accent)]">‹ Cancel</button>
        <h1 className="min-w-0 flex-1 truncate text-right text-[15px] font-semibold">New ticket <span className="font-normal text-[var(--theme-text-muted)]">· {desk ? `born at ${where}` : 'lands in Inbound'}</span></h1>
      </header>
      {/* the same screens as in Tasks; only the card padding is tightened for a phone */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto [&>div]:!p-3" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <NewTaskDraftProvider value={draftState}>
          <NewTask enterStarts={false} onCreated={created} onOpenTicket={(id) => { onClose(); useMobileNavStore.getState().openTicket(id, 'conversation'); }} />
        </NewTaskDraftProvider>
      </div>
    </div>
  );
}

/** How many tickets the list shows at once: past that, the search narrows it. */
const SHOWN = 60;

/**
 * The tickets Fleex drives today, to send one to the Factory: open ones only (a ticket that is done or cancelled has
 * nothing left to go through). Sent, it lands in Inbound and leaves this list.
 */
export function MobileFactoryFromFleex({ onClose }: { onClose: () => void }) {
  const tickets = useTicketStore((s) => s.tickets), fetchTickets = useTicketStore((s) => s.fetchTickets);
  const managed = useFactoryStore((s) => s.managed);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { if (tickets.length === 0) void fetchTickets(); }, [tickets.length, fetchTickets]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase().replace(/^#/, '');
    return tickets.filter((t) => !t.archivedAt && t.status !== 'done' && t.status !== 'cancelled' && !managed.has(t.id) && (!needle || t.title.toLowerCase().includes(needle) || String(t.displayId).includes(needle)));
  }, [tickets, managed, q]);
  const send = (t: Ticket) => { setBusy(t.id); void sendToFactory(t.id, `#${t.displayId}`).finally(() => setBusy(null)); };

  return (
    <div className="fixed inset-0 z-[45] flex flex-col bg-[var(--theme-bg-base)]" style={{ paddingTop: 'env(safe-area-inset-top)' }} role="dialog" aria-label="Send a ticket of Fleex to the Factory">
      <MobilePageHeader title="From Fleex" onBack={onClose} count={rows.length}
        sub={<input type="search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a ticket of Fleex" placeholder="Title or number" enterKeyHint="search"
          className="min-h-11 w-full rounded-xl border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-3 text-[15px] text-[var(--theme-text-primary)] outline-none placeholder:text-[var(--theme-text-faint)] focus:border-[var(--theme-accent)]" />} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 24px)' }}>
        <p className="py-2.5 text-[12.5px] text-[var(--theme-text-muted)]">A ticket you send lands in the Inbound zone and waits there to be released. From then on its status and what runs on it are driven from the floor.</p>
        {rows.length === 0 && <p className="py-10 text-center text-[13px] text-[var(--theme-text-muted)]">{q.trim() ? 'No open ticket matches.' : 'No open ticket to send.'}</p>}
        {rows.slice(0, SHOWN).map((t) => (
          <div key={t.id} className="flex min-h-[52px] items-center gap-2.5 border-b border-[var(--theme-border-subtle)] py-1">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] text-[var(--theme-text-primary)]"><span className="mr-1.5 font-mono text-[12px] text-[var(--theme-text-muted)]">#{t.displayId}</span>{t.title}</span>
              <span className="block text-[12px] text-[var(--theme-text-muted)]">{t.status}</span>
            </span>
            <button type="button" disabled={busy !== null} onClick={() => send(t)} className={`${BTN.accent} max-w-[84px]`}>{busy === t.id ? 'Sending…' : 'Send'}</button>
          </div>
        ))}
        {rows.length > SHOWN && <p className="py-3 text-center text-[12.5px] text-[var(--theme-text-muted)]">{rows.length - SHOWN} more: narrow the search.</p>}
      </div>
    </div>
  );
}
