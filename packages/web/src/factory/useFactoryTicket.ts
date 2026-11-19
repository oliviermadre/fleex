import { useEffect } from 'react';
import { useUIStore } from '../stores/uiStore';
import { useFactoryStore } from './factoryStore';
import type { FactoryTicket, MachineSpec } from './types';

/** How often the floor is read again while a ticket of it is open outside the Factory page (which reads it far more often itself). */
const POLL_MS = 4000;
let watchers = 0, timer: number | null = null;

/**
 * A ticket as the Factory sees it, for what shows it outside the floor (the Work view's context and thread): null
 * unless the Factory is on and the ticket was handed over to it. Keeps the floor fresh while something is mounted.
 */
export function useFactoryTicket(ticketId: string): { ticket: FactoryTicket; machine: MachineSpec | null; machines: readonly MachineSpec[] } | null {
  const enabled = useFactoryStore((s) => s.enabled);
  const managed = useFactoryStore((s) => s.managed.has(ticketId));
  const loadManaged = useFactoryStore((s) => s.loadManaged);
  const ticket = useFactoryStore((s) => s.snapshot?.tickets.find((t) => t.ticketId === ticketId) ?? null);
  const machines = useFactoryStore((s) => s.snapshot?.floor.layout.machines ?? null);
  const onFloor = useUIStore((s) => s.activePanel === 'factory');
  useEffect(() => { if (enabled) void loadManaged(); }, [enabled, ticketId, loadManaged]);
  useEffect(() => {
    if (!enabled || !managed || onFloor) return;
    const read = () => { if (!document.hidden) void useFactoryStore.getState().refresh(); };
    if (watchers++ === 0) { read(); timer = window.setInterval(read, POLL_MS); }
    return () => { if (--watchers === 0 && timer !== null) { window.clearInterval(timer); timer = null; } };
  }, [enabled, managed, onFloor]);
  if (!enabled || !managed || !ticket || !machines) return null;
  return { ticket, machines, machine: ticket.machineId ? machines.find((m) => m.id === ticket.machineId) ?? null : null };
}
