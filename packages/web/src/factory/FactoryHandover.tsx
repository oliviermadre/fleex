import { useEffect, useState } from 'react';
import { Button } from '../components/ui/Button';
import { useFactoryStore } from './factoryStore';

/**
 * Who drives a ticket, changed from the ticket itself: at the foot of its context, above "Delete Ticket". A ticket
 * plain Fleex drives is sent to the Factory, where it lands in the Inbound zone and waits; a ticket the Factory
 * drives is taken back, and is an ordinary ticket again, in the status it has. Renders nothing while the Factory
 * is off.
 */
export function FactoryHandover({ ticketId, status }: { ticketId: string; status?: string }) {
  const enabled = useFactoryStore((s) => s.enabled), managed = useFactoryStore((s) => s.managed.has(ticketId));
  const loadManaged = useFactoryStore((s) => s.loadManaged);
  const running = useFactoryStore((s) => s.snapshot?.tickets.find((t) => t.ticketId === ticketId)?.phase === 'running');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (enabled) void loadManaged(); }, [enabled, ticketId, loadManaged]);
  if (!enabled) return null;
  const closed = status === 'done' || status === 'cancelled';
  const run = (fn: () => Promise<void>) => { setBusy(true); void fn().catch(() => { /* the store already raised a toast */ }).finally(() => setBusy(false)); };
  const store = useFactoryStore.getState();
  return (
    <div className="mb-2" role="group" aria-label="Who drives this ticket">
      {managed ? (
        <>
          <Button size="sm" className="w-full" disabled={busy} onClick={() => run(() => store.giveBack(ticketId))}>Take back from Factory</Button>
          <p className="mt-1 text-[11px] text-[var(--theme-text-faint)]">
            {running ? 'It leaves the floor at once. The run in progress is left to finish, and its result is ignored.' : 'It leaves the floor and is an ordinary ticket again, in the status it has.'}
          </p>
        </>
      ) : (
        <>
          <Button size="sm" className="w-full" disabled={busy || closed} onClick={() => run(() => store.transfer(ticketId, {}))}>Send to Factory</Button>
          <p className="mt-1 text-[11px] text-[var(--theme-text-faint)]">
            {closed ? 'A ticket that is done or cancelled has nothing left to go through.' : 'It lands in the Inbound zone of the floor and waits there. From then on its status and what runs on it are driven from the floor.'}
          </p>
        </>
      )}
    </div>
  );
}
