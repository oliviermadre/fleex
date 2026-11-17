import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { WorkView } from '../components/work/WorkView';
import { useWorkStore } from '../stores/workStore';
import { Button } from '../components/ui/Button';
import { cn } from '../lib/cn';
import { FactorySheet, KBD } from './FactorySheet';
import { TicketToken } from './FactoryTicketMeta';
import type { Need } from './needs';
import type { FactoryTicket } from './types';

/** What the left and right arrows walk while a ticket is open: the tickets that wait for someone, or the ones of the same machine. */
export type WalkScope = 'needs' | 'station';

/** The tickets the arrows walk from `current`, in order. The open ticket is always one of them. */
export function walkSet(scope: WalkScope, current: FactoryTicket | null, needs: readonly Need[], tickets: readonly FactoryTicket[]): FactoryTicket[] {
  if (!current) return needs.map((n) => n.ticket);
  if (scope === 'station') return tickets.filter((t) => t.machineId === current.machineId).sort((a, b) => a.since.localeCompare(b.since));
  const list = needs.map((n) => n.ticket);
  return list.some((t) => t.ticketId === current.ticketId) ? list : [current, ...list];
}

/**
 * A ticket, opened from the floor: the Work view itself, sliding up from the bottom over the floor and its console,
 * nearly as wide and as high as the window. It is the same view as on the Work page (same modes, thread, panels and
 * tools), on the ticket that was opened: nothing about a ticket is done differently here.
 *
 * Left and right arrows go to the previous and the next ticket; a switch says which tickets those are, and they are
 * listed along the top. Escape goes back to the floor.
 */
export function FactoryWorkbench({ ticketId, needs, tickets, onNavigate, onClose }: {
  ticketId: string; needs: readonly Need[]; tickets: readonly FactoryTicket[]; onNavigate: (ticketId: string) => void; onClose: () => void;
}) {
  const [scope, setScope] = useState<WalkScope>('needs');
  const current = tickets.find((t) => t.ticketId === ticketId) ?? null;
  const set = useMemo(() => walkSet(scope, current, needs, tickets), [scope, current, needs, tickets]);

  /*
   * The Work view shows the ticket its store has selected: open this one in it, pinned so the queue's filters do not
   * hide it. The view is mounted only once that is done: mounted before, it would show the queue's first ticket for
   * a moment and then adopt it as the selection, over the one that was asked for.
   */
  const [armed, setArmed] = useState(false);
  useLayoutEffect(() => { const work = useWorkStore.getState(); work.openTicket(ticketId, work.modeByTicket[ticketId] ?? 'chat'); setArmed(true); }, [ticketId]);
  const go = useCallback((d: 1 | -1) => { if (set.length < 2) return; const i = set.findIndex((t) => t.ticketId === ticketId); onNavigate(set[(i + d + set.length) % set.length]!.ticketId); }, [set, ticketId, onNavigate]);
  const onKey = useCallback((e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); } else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
  }, [go]);
  return (
    <FactorySheet label="Workbench" onClose={onClose} onKey={onKey} bar={(
      <>
          <Button size="sm" onClick={() => go(-1)} disabled={set.length < 2} aria-label="Previous ticket"><kbd className={KBD}>←</kbd></Button>
          <Button size="sm" onClick={() => go(1)} disabled={set.length < 2} aria-label="Next ticket"><kbd className={KBD}>→</kbd></Button>
          <div className="flex flex-none gap-0.5 rounded-md border border-[var(--theme-border-input)] p-0.5" role="group" aria-label="What the arrows walk">
            {([['needs', 'Needs you'], ['station', 'Same station']] as const).map(([k, label]) => (
              <button key={k} type="button" aria-pressed={scope === k} onClick={() => setScope(k)}
                className={cn('h-[22px] whitespace-nowrap rounded px-2 text-xs', scope === k ? 'bg-[var(--theme-accent-muted)] text-[var(--theme-accent)]' : 'text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)]')}>{label}</button>
            ))}
          </div>
          <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto py-0.5 [scrollbar-width:none]">
            {set.map((t) => (
              <button key={t.ticketId} type="button" onClick={() => onNavigate(t.ticketId)} aria-current={t.ticketId === ticketId}
                className={cn('flex h-[26px] max-w-[220px] flex-none items-center gap-1.5 rounded-md border pl-1 pr-2 text-[11.5px]',
                  t.ticketId === ticketId ? 'border-[var(--theme-text-primary)] bg-[var(--theme-bg-overlay)] text-[var(--theme-text-primary)]' : 'border-[var(--theme-border)] text-[var(--theme-text-secondary)] hover:border-[var(--theme-border-input)]')}>
                <TicketToken info={t.info ? { ...t.info, favorite: false } : null} size={16} />
                <span className="truncate"><span className="font-mono">#{t.info?.displayId ?? '?'}</span> {t.info?.title ?? ''}</span>
              </button>
            ))}
          </div>
      </>
    )}>
      <div className="min-h-0 flex-1">{armed && <WorkView embedded />}</div>
    </FactorySheet>
  );
}
