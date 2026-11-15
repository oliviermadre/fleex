import { useEffect } from 'react';
import { useUIStore } from '../stores/uiStore';
import { tint, tintSolid } from '../lib/tints';
import { cn } from '../lib/cn';
import { Button } from '../components/ui/Button';
import { useFactoryStore } from './factoryStore';
import { humanCall } from './types';

/** How often the banner re-reads the floor while a handed-over ticket is open. */
const POLL_MS = 4000;

/**
 * Shown on a ticket that was handed over to the Factory: its lifecycle is
 * driven from the floor, so moving it or starting agents on it from here would
 * fight the machines. Renders nothing when the Factory is off.
 *
 * A Factory run creates no mention and no workflow step run, so the usual
 * "waiting for your reply" and gate cards never see it: when the ticket waits
 * for a human (a question, a gate, a failed run), this banner is that signal,
 * with the action that unblocks it.
 */
export function FactoryBanner({ ticketId }: { ticketId: string }) {
  const enabled = useFactoryStore((s) => s.enabled);
  const managed = useFactoryStore((s) => s.managed.has(ticketId));
  const loadManaged = useFactoryStore((s) => s.loadManaged);
  const ticket = useFactoryStore((s) => s.snapshot?.tickets.find((t) => t.ticketId === ticketId) ?? null);
  const machine = useFactoryStore((s) => (ticket?.machineId ? s.snapshot?.floor.layout.machines.find((m) => m.id === ticket.machineId) ?? null : null));
  const retry = useFactoryStore((s) => s.retry);
  const resolve = useFactoryStore((s) => s.resolve);
  useEffect(() => { if (enabled) void loadManaged(); }, [enabled, ticketId, loadManaged]);
  useEffect(() => {
    if (!enabled || !managed) return;
    void useFactoryStore.getState().refresh();
    const id = window.setInterval(() => { if (!document.hidden) void useFactoryStore.getState().refresh(); }, POLL_MS);
    return () => window.clearInterval(id);
  }, [enabled, managed]);
  if (!enabled || !managed) return null;

  const openFloor = () => useUIStore.getState().setActivePanel('factory');
  const call = ticket ? humanCall(ticket) : null;
  const station = machine?.kind === 'station' ? machine : null;
  const where = machine?.name || (station ? 'The station' : 'An agent');

  if (!ticket || !call) {
    return (
      <div className={cn('flex items-center gap-2 px-3 py-1.5 text-xs', tint('green'))} role="status">
        <span className="font-semibold">Managed by the Factory</span>
        <span className="min-w-0 flex-1 truncate">Its status and agent runs are driven from the factory floor. Change them there.</span>
        <button type="button" className="font-semibold underline" onClick={openFloor}>Open the floor</button>
      </div>
    );
  }

  const inStation = !!station && (ticket.phase === 'question' || ticket.phase === 'failed' || ticket.phase === 'review');
  const title = call === 'decision' ? `${where} is waiting for your decision`
    : call === 'failed' ? `${where}: the run failed`
    : inStation ? `${where} asked you a question` : 'An agent asked you a question';
  const detail = call === 'decision' ? 'Pick the way the ticket leaves the gate.'
    : call === 'failed' ? ticket.note || 'See the execution log, then run the station again.'
    : inStation ? 'Reply in the thread below, then run the station again: replying alone restarts nothing.'
    : 'Reply in the thread below, then put the ticket back on a station from the floor.';

  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 text-xs', tint(call === 'failed' ? 'red' : 'yellow'))} role="alert">
      <span className="relative flex h-5 w-5 flex-none items-center justify-center" aria-hidden>
        <span className={cn('absolute inset-0 animate-ping rounded-full opacity-60', tintSolid(call === 'failed' ? 'red' : 'yellow'))} />
        <span className={cn('relative flex h-5 w-5 items-center justify-center rounded-full text-[13px] font-extrabold text-[var(--theme-bg-base)]', tintSolid(call === 'failed' ? 'red' : 'yellow'))}>{call === 'failed' ? '!' : '?'}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="font-semibold">{title}</span>
        <span className="ml-2 opacity-90">{detail}</span>
      </span>
      <span className="flex flex-none flex-wrap items-center gap-1.5">
        {call === 'decision' && station?.outcomes.map((o, i) => (
          <Button key={o} size="sm" variant={i === 0 ? 'primary' : 'secondary'} onClick={() => void resolve(ticketId, o)}>{o}</Button>
        ))}
        {inStation && call !== 'decision' && <Button size="sm" variant="primary" onClick={() => void retry(ticketId)}>Run again</Button>}
        <button type="button" className="font-semibold underline" onClick={openFloor}>Open the floor</button>
      </span>
    </div>
  );
}
