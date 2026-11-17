import { useState } from 'react';
import { useUIStore } from '../stores/uiStore';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { cn } from '../lib/cn';
import { tintSolid } from '../lib/tints';
import { useFactoryStore } from './factoryStore';
import { useFactoryTicket } from './useFactoryTicket';
import { needKind, standing } from './needs';
import { canSetAside, RUNS, SET_ASIDE } from './types';

/**
 * The Factory's group in a ticket's context: where the ticket is on the floor, and the one thing done from here,
 * taking it out of the line (set aside) or putting it back (another run, a way out, another machine). What the
 * floor asks of someone is asked in the thread, not here. Renders nothing for a ticket that is not on the floor.
 */
export function FactoryContextGroup({ ticketId }: { ticketId: string }) {
  const seen = useFactoryTicket(ticketId);
  const onFloor = useUIStore((s) => s.activePanel === 'factory');
  const [busy, setBusy] = useState(false);
  if (!seen) return null;
  const { ticket, machine, machines } = seen, store = useFactoryStore.getState();
  const { where, state } = standing(ticket, machine), need = needKind(ticket);
  const station = machine?.kind === 'station' && RUNS.includes(machine.exec) ? machine : null;
  const name = station?.name || 'the station';
  const aside = !!station && SET_ASIDE.includes(ticket.phase);
  const others = machines.filter((m) => (m.kind === 'station' || m.kind === 'zone') && m.id !== ticket.machineId);
  const run = (fn: () => Promise<void>) => { setBusy(true); void fn().catch(() => { /* the store already raised a toast */ }).finally(() => setBusy(false)); };

  return (
    <div className="border-b border-[var(--theme-border-subtle)] px-3 py-2.5" aria-label="Factory">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[10.5px] font-semibold tracking-[0.06em] text-[var(--theme-text-muted)]">FACTORY</span>
        {!onFloor && <button type="button" className="text-[11px] text-[var(--theme-text-muted)] underline hover:text-[var(--theme-text-primary)]" onClick={() => useUIStore.getState().setActivePanel('factory')}>Open the floor</button>}
      </div>
      <div className="flex items-center gap-2 text-[12.5px]">
        <span className={cn('h-2 w-2 flex-none rounded-full', tintSolid(need === 'failed' ? 'red' : need ? 'yellow' : 'green'))} aria-hidden />
        <b className="min-w-0 truncate text-[var(--theme-text-primary)]">{where}</b>
      </div>
      <div className="mt-0.5 text-[11.5px] text-[var(--theme-text-secondary)]">{state}</div>
      {ticket.phase !== 'wait' && ticket.note && <div className="mt-0.5 break-words text-[11px] text-[var(--theme-text-muted)]">{ticket.note}</div>}

      {canSetAside(ticket, machine) && (
        <div className="mt-2">
          <Button size="sm" disabled={busy} onClick={() => run(() => store.setAside(ticketId))}>Set aside</Button>
          <div className="mt-1 text-[11px] text-[var(--theme-text-faint)]">
            {ticket.phase === 'running' ? `Stops the run of ${name} and frees its place.` : `Takes it out of the line and frees its place in ${name}.`}
          </div>
        </div>
      )}
      {aside && station && (
        <div className="mt-2 flex flex-col gap-1.5">
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="primary" disabled={busy} onClick={() => run(() => store.putBack(ticketId))}>Run {name} again</Button>
            {station.outcomes.map((o) => <Button key={o} size="sm" disabled={busy} onClick={() => run(() => store.putBack(ticketId, o))}>Leave as {o}</Button>)}
          </div>
          {others.length > 0 && (
            <Select aria-label="Send to another machine" className="w-full px-2 py-1 text-xs" value="" disabled={busy}
              onChange={(e) => { const machineId = e.target.value; if (machineId) run(() => store.move(ticketId, { machineId })); }}
              options={[{ value: '', label: 'Send to another machine' }, ...others.map((m) => ({ value: m.id, label: ('name' in m && m.name) || (m.kind === 'zone' ? 'Zone' : 'Station') }))]} />
          )}
        </div>
      )}
      <div className="mt-2 text-[11px] text-[var(--theme-text-faint)]">Its status and what runs on it are driven from the floor.</div>
    </div>
  );
}
