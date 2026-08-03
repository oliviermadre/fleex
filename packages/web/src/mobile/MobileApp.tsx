import { useEffect, useState } from 'react';

import { useAgentPersonas } from '../hooks/useAgentPersonas';
import { useTickets } from '../hooks/useTickets';
import { useWebSocket } from '../hooks/useWebSocket';
import { useSettingsStore } from '../stores/settingsStore';
import { useTicketStore } from '../stores/ticketStore';

import { MobileAssistant } from './MobileAssistant';
import { MobileBoard } from './MobileBoard';
import { MobileTicketDetail } from './MobileTicketDetail';

type MobileView = 'board' | 'assistant';

/**
 * Mobile shell: kanban, ticket detail and the Fleex assistant. Terminals,
 * dashboards and the config editor stay desktop-only — the phone is a remote
 * control for boards and agent sessions, the laptop does the work.
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
    s.selectedTicketId ? (s.tickets.find((t) => t.id === s.selectedTicketId) ?? null) : null,
  );

  const [view, setView] = useState<MobileView>('board');

  return (
    <div
      className="flex h-dvh w-full flex-col overflow-hidden bg-[var(--theme-bg-base)] text-[var(--theme-text-primary)]"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {/* Both views stay mounted: the assistant streams over its own WS and a
          tab switch must not drop an in-flight conversation. */}
      <div className={view === 'board' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
        {ticket ? <MobileTicketDetail ticket={ticket} /> : <MobileBoard />}
      </div>
      <div className={view === 'assistant' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
        <MobileAssistant />
      </div>

      {/* Bottom tab bar */}
      <nav className="flex shrink-0 border-t border-[var(--theme-border)] bg-[var(--theme-bg-base)]">
        {(
          [
            { id: 'board', label: 'Board', icon: '▦' },
            { id: 'assistant', label: 'Assistant', icon: '✦' },
          ] as { id: MobileView; label: string; icon: string }[]
        ).map((t) => (
          <button
            key={t.id}
            onClick={() => setView(t.id)}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${
              view === t.id ? 'text-[var(--theme-accent)]' : 'text-[var(--theme-text-muted)]'
            }`}
          >
            <span className="text-base leading-none">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
