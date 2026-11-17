import { PriorityIndicator } from '../components/tickets/PriorityIndicator';
import { ComplexityBadge } from '../components/tickets/ComplexityBadge';
import { cn } from '../lib/cn';
import { span } from './format';
import { complexityOf, priorityOf, TicketToken } from './FactoryTicketMeta';
import { NEED_LABEL, type Need } from './needs';

const INK: Record<Need['kind'], string> = {
  decision: 'text-[var(--theme-warning)]', question: 'text-[var(--theme-warning)]', failed: 'text-[var(--theme-danger)]',
  aside: 'text-[var(--theme-accent)]', floor: 'text-[var(--theme-text-secondary)]',
};
const BAR: Record<Need['kind'], string> = {
  decision: 'bg-[var(--theme-warning)]', question: 'bg-[var(--theme-warning)]', failed: 'bg-[var(--theme-danger)]',
  aside: 'bg-[var(--theme-accent)]', floor: 'bg-[var(--theme-text-muted)]',
};

/**
 * The tickets that wait for someone, top-left over the floor, the way a party's frames sit over a game: what each
 * ticket is, where it stands and what it waits for, and for how long. Nothing else is listed here. A click selects
 * the ticket and shows its thread beside its machine; a second one opens it.
 */
export function FactoryNeeds({ needs, selected, onPick, onOpen }: { needs: Need[]; selected: string | null; onPick: (ticketId: string) => void; onOpen: (ticketId: string) => void }) {
  const longest = Math.max(3_600_000, ...needs.map((n) => n.waitMs));
  return (
    <div className="pointer-events-none absolute left-2.5 top-2.5 z-[5] flex max-h-[calc(100%-20px)] w-[272px] flex-col gap-1" aria-label="Needs you">
      <h2 className="flex items-center gap-2 pl-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-secondary)] [text-shadow:0_1px_2px_#000]">
        Needs you · {needs.length}
        <span className="font-normal normal-case tracking-normal text-[var(--theme-text-muted)]" title="N goes to the next one, Shift+N to the one before"><kbd className="rounded border border-[var(--theme-border-input)] bg-[var(--theme-bg-base)] px-1 font-mono">N</kbd> next</span>
      </h2>
      <div className="pointer-events-auto flex min-h-0 flex-col gap-1 overflow-y-auto">
        {needs.map((n) => {
          const t = n.ticket, info = t.info, on = selected === t.ticketId;
          return (
            <button
              key={t.ticketId} type="button" onClick={() => onPick(t.ticketId)} onDoubleClick={() => onOpen(t.ticketId)}
              className={cn('relative grid grid-cols-[30px_minmax(0,1fr)] items-center gap-x-2 overflow-hidden rounded-lg border px-2 pb-[7px] pt-1.5 text-left backdrop-blur-md',
                'bg-[color-mix(in_srgb,var(--theme-bg-base)_74%,transparent)]', on ? 'border-[var(--theme-text-primary)]' : 'border-[var(--theme-border)] hover:border-[var(--theme-border-input)]')}>
              <span className="row-span-2"><TicketToken info={info ? { ...info, favorite: false } : null} size={26} /></span>
              <span className="flex min-w-0 items-center gap-1.5">
                <b className="min-w-0 flex-1 truncate text-xs font-semibold text-[var(--theme-text-primary)]">{info?.title ?? t.ticketId}</b>
                <PriorityIndicator priority={priorityOf(info)} />
                <ComplexityBadge complexity={complexityOf(info)} />
              </span>
              <span className="flex min-w-0 items-center gap-1 whitespace-nowrap text-[11px] text-[var(--theme-text-secondary)]">
                <span className="truncate">{n.where}</span><span className={INK[n.kind]}>· {NEED_LABEL[n.kind]}</span>
                <span className="ml-auto font-mono text-[10.5px] text-[var(--theme-text-muted)]">{span(n.waitMs)}</span>
              </span>
              <span className={cn('absolute bottom-0 left-0 h-[2.5px]', BAR[n.kind])} style={{ width: `${Math.max(6, Math.round((n.waitMs / longest) * 100))}%` }} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
