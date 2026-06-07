import type { TicketDeliverable } from '@fleex/shared';
import { useNavigate } from 'react-router-dom';
import { useTicketStore } from '../../stores/ticketStore';
import { useUIStore } from '../../stores/uiStore';
import { useDeliverableTypesStore } from '../../stores/deliverableTypesStore';
import { cn } from '../../lib/cn';

// Theme-accent fallback used when a type has no configured colour.
const ACCENT_BADGE = 'bg-[var(--theme-accent)]/15 text-[var(--theme-accent)]';

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

function getInitials(name: string): string {
  return name
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .slice(0, 2)
    .join('');
}

export function DocumentRow({ deliverable }: { deliverable: TicketDeliverable }) {
  const navigate = useNavigate();
  const tickets = useTicketStore((s) => s.tickets);
  const selectBoard = useTicketStore((s) => s.selectBoard);
  const selectTicket = useTicketStore((s) => s.selectTicket);
  const openDeliverableOverlay = useUIStore((s) => s.openDeliverableOverlay);
  const typeLabel = useDeliverableTypesStore((s) => s.labelFor)(deliverable.type);
  const typeColorCfg = useDeliverableTypesStore((s) => s.colorFor)(deliverable.type);

  const ticket = tickets.find((t) => t.id === deliverable.ticketId);
  const statusColor =
    deliverable.status === 'final'
      ? 'bg-green-500/10 text-green-400'
      : 'bg-amber-500/10 text-amber-400';

  const snippet = deliverable.content.split('\n').filter((l) => l.trim()).slice(0, 1).join('');

  const handleOpenTicket = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (ticket) {
      selectBoard(null);
      selectTicket(ticket.id);
      navigate(`/tickets/board/all/ticket/${ticket.id}`);
    }
  };

  const handleOpenDocument = (e: React.MouseEvent) => {
    e.stopPropagation();
    openDeliverableOverlay(deliverable);
  };

  return (
    <button
      className="group flex w-full items-center gap-3 border-b border-[var(--theme-border)] px-4 py-2.5 text-left transition-colors hover:bg-[var(--theme-bg-hover)]"
      onClick={() => openDeliverableOverlay(deliverable)}
    >
      {/* Title + snippet */}
      <div className="min-w-0 flex-[3]">
        <div className="truncate text-sm font-medium text-[var(--theme-text-primary)]">
          {deliverable.title}
        </div>
        {snippet && (
          <div className="mt-0.5 truncate text-[11px] text-[var(--theme-text-faint)]">
            {snippet}
          </div>
        )}
      </div>

      {/* Agent */}
      <div className="flex flex-[1.5] items-center gap-1.5">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-500/15 text-[9px] font-semibold text-violet-300">
          {getInitials(deliverable.agentName)}
        </span>
        <span className="truncate text-xs text-[var(--theme-text-secondary)]">
          {deliverable.agentName}
        </span>
      </div>

      {/* Ticket name */}
      <div className="flex-[2] truncate text-xs text-[var(--theme-text-secondary)]">
        {ticket ? ticket.title : <span className="text-[var(--theme-text-faint)]">&mdash;</span>}
      </div>

      {/* Type badge */}
      <div className="flex-[0.8]">
        <span
          className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium', !typeColorCfg && ACCENT_BADGE)}
          style={typeColorCfg ? { backgroundColor: typeColorCfg.bg, color: typeColorCfg.text } : undefined}
        >
          {typeLabel}
        </span>
      </div>

      {/* Status badge */}
      <div className="flex-[0.6]">
        <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', statusColor)}>
          {deliverable.status}
        </span>
      </div>

      {/* Updated */}
      <div className="w-16 shrink-0 text-right text-[10px] text-[var(--theme-text-faint)]">
        {formatRelativeTime(deliverable.updatedAt)}
      </div>

      {/* CTAs */}
      <div className="flex w-16 shrink-0 items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          className="rounded p-1 text-[var(--theme-text-faint)] hover:bg-[var(--theme-bg-overlay)] hover:text-[var(--theme-text-primary)]"
          onClick={handleOpenDocument}
          title="Open document"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        </button>
        {ticket && (
          <button
            className="rounded p-1 text-[var(--theme-text-faint)] hover:bg-[var(--theme-bg-overlay)] hover:text-[var(--theme-text-primary)]"
            onClick={handleOpenTicket}
            title="Open ticket"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </button>
        )}
      </div>
    </button>
  );
}
