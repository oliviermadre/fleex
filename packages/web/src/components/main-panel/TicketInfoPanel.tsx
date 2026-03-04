import { useState } from 'react';
import { useTicketStore } from '../../stores/ticketStore';
import { TicketComments } from '../tickets/TicketComments';
import { TicketDeliverables } from '../tickets/TicketDeliverables';
import { TicketActivityTimeline } from '../tickets/TicketActivityTimeline';
import { MarkdownRenderer } from '../scratchpad/MarkdownRenderer';
import { cn } from '../../lib/cn';

type InfoTab = 'description' | 'comments' | 'deliverables' | 'activity';

export function TicketInfoPanel({ ticketId }: { ticketId: string }) {
  const ticket = useTicketStore((s) => s.tickets.find((t) => t.id === ticketId));
  const [activeTab, setActiveTab] = useState<InfoTab>('comments');

  if (!ticket) {
    return (
      <div className="flex flex-1 items-center justify-center text-[var(--theme-text-faint)]">
        <span className="text-sm">Ticket not found</span>
      </div>
    );
  }

  const tabs: { key: InfoTab; label: string }[] = [
    { key: 'description', label: 'Description' },
    { key: 'comments', label: 'Comments' },
    { key: 'deliverables', label: 'Deliverables' },
    { key: 'activity', label: 'Activity' },
  ];

  return (
    <div className="flex flex-1 flex-col overflow-hidden p-4">
      {/* Ticket title */}
      <h2 className="mb-3 flex-shrink-0 text-sm font-semibold text-[var(--theme-text-primary)] leading-snug">
        {ticket.title}
      </h2>

      {/* Sub-tabs */}
      <div className="mb-3 flex flex-shrink-0 items-center gap-1 border-b border-[var(--theme-border)]">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={cn(
              'px-3 py-1.5 text-xs font-medium transition-colors',
              activeTab === tab.key
                ? 'border-b-2 border-[var(--theme-accent)] text-[var(--theme-text-primary)]'
                : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)]',
            )}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {activeTab === 'description' && (
          <div className="flex-1 overflow-y-auto">
            {ticket.description.trim() ? (
              <MarkdownRenderer content={ticket.description} onToggleCheckbox={() => {}} />
            ) : (
              <p className="text-sm italic text-[var(--theme-text-muted)]">No description yet</p>
            )}
          </div>
        )}

        {activeTab === 'comments' && (
          <TicketComments ticketId={ticketId} />
        )}

        {activeTab === 'deliverables' && (
          <div className="flex-1 overflow-y-auto">
            <TicketDeliverables ticketId={ticketId} />
          </div>
        )}

        {activeTab === 'activity' && (
          <div className="flex-1 overflow-y-auto">
            <TicketActivityTimeline ticketId={ticketId} />
          </div>
        )}
      </div>
    </div>
  );
}
