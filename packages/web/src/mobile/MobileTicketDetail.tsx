import { useEffect, useState } from 'react';
import { TICKET_STATUSES, TICKET_STATUS_LABELS } from '@fleex/shared';
import type { Ticket, TicketStatus } from '@fleex/shared';
import { useTicketStore } from '../stores/ticketStore';
import { useAgentEventStore } from '../stores/agentEventStore';
import { MarkdownRenderer } from '../components/scratchpad/MarkdownRenderer';
import { MobileConversation } from './MobileConversation';
import { MobileExecutions } from './MobileExecutions';
import { MobileTicketRepos } from './MobileTicketRepos';

type Tab = 'description' | 'conversation' | 'runs';

export function MobileTicketDetail({ ticket }: { ticket: Ticket }) {
  const selectTicket = useTicketStore((s) => s.selectTicket);
  const moveTicket = useTicketStore((s) => s.moveTicket);

  const subscribeTicket = useAgentEventStore((s) => s.subscribeTicket);
  const unsubscribeTicket = useAgentEventStore((s) => s.unsubscribeTicket);
  const loadExecutionsForTicket = useAgentEventStore((s) => s.loadExecutionsForTicket);
  const runningCount = useAgentEventStore(
    (s) => (s.executionsByTicket[ticket.id] ?? []).filter((e) => e.status === 'running').length,
  );

  const [tab, setTab] = useState<Tab>('conversation');

  // Live agent activity for this ticket (new executions stream in via WS)
  useEffect(() => {
    loadExecutionsForTicket(ticket.id);
    subscribeTicket(ticket.id);
    return () => unsubscribeTicket(ticket.id);
  }, [ticket.id, loadExecutionsForTicket, subscribeTicket, unsubscribeTicket]);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'description', label: 'Description' },
    { id: 'conversation', label: 'Conversation' },
    { id: 'runs', label: runningCount > 0 ? `Runs ●` : 'Runs' },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header */}
      <header className="flex shrink-0 items-center gap-2 border-b border-[var(--theme-border)] px-2 py-2">
        <button
          onClick={() => selectTicket(null)}
          className="shrink-0 rounded-md px-2 py-1.5 text-xl leading-none text-[var(--theme-text-muted)]"
          aria-label="Retour au board"
        >
          ‹
        </button>
        <span className="shrink-0 font-mono text-xs text-[var(--theme-text-faint)]">
          #{ticket.displayId}
        </span>
        <div className="min-w-0 flex-1" />
        <select
          value={ticket.status}
          onChange={(e) => moveTicket(ticket.id, e.target.value as TicketStatus)}
          className="shrink-0 appearance-none rounded-md bg-[var(--theme-bg-secondary)] px-3 py-1.5 text-xs font-medium text-[var(--theme-text-primary)]"
        >
          {(TICKET_STATUSES as readonly TicketStatus[]).map((s) => (
            <option key={s} value={s}>
              {TICKET_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </header>

      {/* Title */}
      <div className="shrink-0 px-4 pb-1 pt-3">
        <h1 className="text-base font-semibold leading-snug text-[var(--theme-text-primary)]">
          {ticket.title}
        </h1>
      </div>

      {/* Repository links — required for worktrees and agent context */}
      <MobileTicketRepos ticket={ticket} />

      {/* Tabs */}
      <nav className="flex shrink-0 gap-1 border-b border-[var(--theme-border)] px-3 pt-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-t-md px-3 py-2 text-xs font-medium ${
              tab === t.id
                ? 'border-b-2 border-[var(--theme-accent)] text-[var(--theme-text-primary)]'
                : 'text-[var(--theme-text-muted)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {/* Content */}
      {tab === 'description' && (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-sm">
          {ticket.description ? (
            <MarkdownRenderer content={ticket.description} onToggleCheckbox={() => {}} />
          ) : (
            <p className="py-8 text-center text-sm text-[var(--theme-text-faint)]">
              Pas de description
            </p>
          )}
        </div>
      )}
      {tab === 'conversation' && <MobileConversation ticket={ticket} />}
      {tab === 'runs' && <MobileExecutions ticketId={ticket.id} />}
    </div>
  );
}
