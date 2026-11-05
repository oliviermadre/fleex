/**
 * A21 — "To schedule": open tickets without a due date, filtered like the
 * agenda (board / epic / tag). Drag one onto a day to give it that due date.
 */
import { useMemo, useState } from 'react';
import type { Ticket } from '@fleex/shared';
import { useTicketStore } from '../../stores/ticketStore';
import { useAgendaStore } from '../../stores/agendaStore';
import { cn } from '../../lib/cn';
import { FlagIcon, SearchIcon } from '../ui/icons/AgendaIcons';
import { useAgendaDnd } from './AgendaDnd';
import { useTicketsLoaded } from './EventEditor';

export const DRAWER_MAX = 50;

/** Open (not done / cancelled / archived), no due date, through the agenda's board / epic / tag filters. */
export function ticketsToSchedule(
  tickets: Ticket[],
  filters: { boards: string[]; epics: string[]; tags: string[] },
  query: string,
  hidden: ReadonlySet<string> = new Set(),
): Ticket[] {
  const q = query.trim().toLowerCase().replace(/^#/, '');
  return tickets
    .filter((t) => !t.dueDate && !t.archivedAt && t.status !== 'done' && t.status !== 'cancelled' && !hidden.has(t.id))
    .filter((t) => !filters.boards.length || filters.boards.includes(t.boardId))
    .filter((t) => !filters.epics.length || !t.epics?.length || t.epics.some((e) => filters.epics.includes(e.id)))
    .filter((t) => !filters.tags.length || !t.tags.length || t.tags.some((x) => filters.tags.includes(x)))
    .filter((t) => !q || `${t.displayId} ${t.title}`.toLowerCase().includes(q))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export function AgendaDrawer({ hidden }: { hidden: ReadonlySet<string> }) {
  const tickets = useTicketStore((s) => s.tickets);
  const filters = useAgendaStore((s) => s.prefs.filters);
  const dnd = useAgendaDnd();
  const [query, setQuery] = useState('');
  useTicketsLoaded();

  const list = useMemo(() => ticketsToSchedule(tickets, filters, query, hidden), [tickets, filters, query, hidden]);
  const shown = list.slice(0, DRAWER_MAX);

  return (
    <aside aria-label="To schedule" className="flex w-64 shrink-0 flex-col border-l border-[var(--theme-border)] bg-[var(--theme-bg-surface)]">
      <div className="space-y-1.5 border-b border-[var(--theme-border)] p-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--theme-text-primary)]">
          To schedule
          <span className="rounded-full border border-[var(--theme-border)] px-1.5 text-[10px] font-normal text-[var(--theme-text-muted)]">{list.length}</span>
        </div>
        <div className="flex items-center gap-1 rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-base)] px-1.5 focus-within:border-[var(--theme-accent)]">
          <SearchIcon size={12} className="shrink-0 text-[var(--theme-text-muted)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setQuery(''); e.currentTarget.blur(); } }}
            placeholder="Search tickets"
            aria-label="Search tickets to schedule"
            className="h-6 min-w-0 flex-1 bg-transparent text-xs text-[var(--theme-text-primary)] outline-none"
          />
        </div>
        <div className="text-[10.5px] text-[var(--theme-text-muted)]">Open tickets without a due date. Drag one onto a day.</div>
      </div>
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-1.5">
        {shown.map((t) => (
          <li key={t.id}>
            <div
              role="button"
              tabIndex={-1}
              data-drawer-ticket={t.id}
              onPointerDown={(e) => dnd?.beginTicket(e, { id: t.id, title: t.title })}
              className={cn(
                'flex cursor-grab items-center gap-1.5 rounded border border-[var(--theme-border)] bg-[var(--theme-bg-base)] px-1.5 py-1 text-[11px] hover:border-[var(--theme-border-input)]',
                dnd?.draggingId === `ticket:${t.id}` && 'opacity-40',
              )}
              title={`#${t.displayId} ${t.title}: drag onto a day to set its due date`}
            >
              <FlagIcon size={11} className="shrink-0 text-[var(--theme-text-muted)]" />
              <span className="shrink-0 tabular-nums text-[var(--theme-text-muted)]">#{t.displayId}</span>
              <span className="truncate text-[var(--theme-text-primary)]">{t.title}</span>
            </div>
          </li>
        ))}
        {list.length === 0 && <li className="px-1 py-2 text-xs text-[var(--theme-text-muted)]">{query ? 'No ticket matches.' : 'Nothing left to schedule.'}</li>}
        {list.length > DRAWER_MAX && (
          <li className="px-1 py-1 text-[10.5px] text-[var(--theme-text-muted)]">{list.length - DRAWER_MAX} more: refine the search.</li>
        )}
      </ul>
    </aside>
  );
}
