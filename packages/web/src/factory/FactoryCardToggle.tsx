import { useState } from 'react';
import { cn } from '../lib/cn';
import { tintClasses } from '../lib/tints';
import { FactoryIcon } from './FactoryIcon';
import { useFactoryStore } from './factoryStore';

/**
 * On a Kanban card, beside blocked and favourite: who drives the ticket, as a toggle with the Factory's own icon (the
 * one of the navigation). Lit, the Factory drives it, and a click gives it back; dim, plain Fleex does, and a click
 * sends it to the Factory, where it lands in Inbound. Renders nothing while the Factory is off, nor on a ticket that
 * is done and was not handed over (it has nothing left to go through). Which tickets are on the floor is read once
 * by the board (`loadManaged`).
 */
export function FactoryCardToggle({ ticketId, closed }: { ticketId: string; closed: boolean }) {
  const enabled = useFactoryStore((s) => s.enabled), managed = useFactoryStore((s) => s.managed.has(ticketId));
  const [busy, setBusy] = useState(false);
  if (!enabled || (closed && !managed)) return null;
  const purple = tintClasses('purple');
  return (
    <button
      type="button" disabled={busy} aria-pressed={managed} aria-label={managed ? 'Give back from the Factory' : 'Send to the Factory'}
      className={cn('flex-shrink-0 rounded p-0.5 transition-all disabled:cursor-wait',
        managed ? cn('opacity-100', purple.solidText) : cn('opacity-0 group-hover:opacity-60 text-[var(--theme-text-faint)] hover:opacity-100', purple.hoverText))}
      onClick={(e) => {
        e.stopPropagation();
        const store = useFactoryStore.getState();
        setBusy(true);
        void (managed ? store.giveBack(ticketId) : store.transfer(ticketId, {}))
          .then(() => store.loadManaged())
          .catch(() => { /* the store already raised a toast */ })
          .finally(() => setBusy(false));
      }}
      title={managed ? 'Driven by the Factory: give it back to plain Fleex' : 'Send to the Factory: it lands in Inbound and is driven from the floor'}
    >
      <FactoryIcon size={12} />
    </button>
  );
}
