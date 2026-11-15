import { useEffect } from 'react';
import { useUIStore } from '../stores/uiStore';
import { tint } from '../lib/tints';
import { cn } from '../lib/cn';
import { useFactoryStore } from './factoryStore';

/**
 * Shown on a ticket that was handed over to the Factory: its lifecycle is
 * driven from the floor, so moving it or starting agents on it from here would
 * fight the machines. Renders nothing when the Factory is off.
 */
export function FactoryBanner({ ticketId }: { ticketId: string }) {
  const enabled = useFactoryStore((s) => s.enabled);
  const managed = useFactoryStore((s) => s.managed.has(ticketId));
  const loadManaged = useFactoryStore((s) => s.loadManaged);
  useEffect(() => { if (enabled) void loadManaged(); }, [enabled, ticketId, loadManaged]);
  if (!enabled || !managed) return null;
  return (
    <div className={cn('flex items-center gap-2 px-3 py-1.5 text-xs', tint('green'))} role="status">
      <span className="font-semibold">Managed by the Factory</span>
      <span className="min-w-0 flex-1 truncate">Its status and agent runs are driven from the factory floor. Change them there.</span>
      <button type="button" className="font-semibold underline" onClick={() => useUIStore.getState().setActivePanel('factory')}>Open the floor</button>
    </div>
  );
}
