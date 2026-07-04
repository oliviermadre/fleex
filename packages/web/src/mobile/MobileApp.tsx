import { useEffect } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import { useTickets } from '../hooks/useTickets';
import { useAgentPersonas } from '../hooks/useAgentPersonas';
import { useTicketStore } from '../stores/ticketStore';
import { useSettingsStore } from '../stores/settingsStore';
import { MobileBoard } from './MobileBoard';
import { MobileTicketDetail } from './MobileTicketDetail';

/**
 * Mobile shell: kanban + ticket detail only. Terminals, dashboards and the
 * config editor stay desktop-only — the phone is a remote control for boards
 * and SDK agent sessions, the laptop does the work.
 */
export function MobileApp() {
  useWebSocket();
  useTickets();
  useAgentPersonas();

  const loadSettings = useSettingsStore((s) => s.loadSettings);
  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const ticket = useTicketStore((s) =>
    s.selectedTicketId ? s.tickets.find((t) => t.id === s.selectedTicketId) ?? null : null,
  );

  return (
    <div
      className="flex h-dvh w-full flex-col overflow-hidden bg-[var(--theme-bg-base)] text-[var(--theme-text-primary)]"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {ticket ? <MobileTicketDetail ticket={ticket} /> : <MobileBoard />}
    </div>
  );
}
