import { useEffect, useState } from 'react';
import type { Board, Ticket, TicketStatus } from '@fleex/shared';
import { useUIStore } from '../../stores/uiStore';
import type { InspectorFocus } from '../../stores/listFocusStore';
import { TicketDeliverables } from '../tickets/TicketDeliverables';
import { SidebarWidthHandle } from '../main-panel/right-sidebar/SidebarWidthHandle';
import { StatusChipDropdown } from './StatusChipDropdown';
import { CommentComposer } from './CommentComposer';
import { CommentIcon, DeliverableIcon } from './icons';
import { cn } from '../../lib/cn';

type InspectorTab = 'deliverables' | 'comment';

interface Props {
  ticket: Ticket;
  board?: Board;
  focus: InspectorFocus;
  /** 1-based position within the frozen order, e.g. "3 / 12". */
  positionLabel: string;
  parentRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onStatusChange: (status: TicketStatus) => void;
  onOpenFull: () => void;
}

/**
 * Right-side inspector (view #400). Non-fullscreen and resizable via the shared
 * SidebarWidthHandle + uiStore.rightSidebarWidth (same primitive as the ticket
 * panel's sidebar). Surfaces exactly the three cockpit actions: change status
 * (header chip), view deliverables, and write a comment to relaunch an agent.
 *
 * ↑/↓ navigation and Escape are owned by ListFocusView (a single window-level
 * handler) so they work regardless of focus within the inspector.
 */
export function ListFocusInspector({
  ticket,
  board,
  focus,
  positionLabel,
  parentRef,
  onClose,
  onStatusChange,
  onOpenFull,
}: Props) {
  const width = useUIStore((s) => s.rightSidebarWidth);
  const [tab, setTab] = useState<InspectorTab>(focus === 'comments' ? 'comment' : 'deliverables');

  // Re-emphasise the requested section when the selection or the badge-driven
  // focus changes (e.g. clicking a comments badge on another row).
  useEffect(() => {
    setTab(focus === 'comments' ? 'comment' : 'deliverables');
  }, [focus, ticket.id]);

  return (
    // shrink-0: the inspector holds its width; the list (flex-1) is the side
    // that shrinks, so the panel can never be squeezed off-screen by wide rows.
    <div className="flex h-full shrink-0">
      <SidebarWidthHandle parentRef={parentRef} />
      <aside
        style={{ width }}
        className="flex h-full flex-col border-l border-[var(--theme-border)] bg-[var(--theme-bg-surface)]"
      >
        {/* Header */}
        <div className="flex items-start gap-2 border-b border-[var(--theme-border-subtle)] px-4 py-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex items-center gap-2 text-[10px] text-[var(--theme-text-faint)]">
              <span className="tabular-nums">{positionLabel}</span>
              {board && (
                <span className="truncate rounded bg-[var(--theme-bg-overlay)] px-1.5 py-0.5 font-medium text-[var(--theme-text-muted)]">
                  {board.emoji} {board.name}
                </span>
              )}
              <span>#{ticket.displayId}</span>
            </div>
            <h2 className="text-sm font-semibold leading-snug text-[var(--theme-text-primary)]">
              {ticket.title}
            </h2>
            <div className="flex items-center gap-2">
              <StatusChipDropdown status={ticket.status} onChange={onStatusChange} size="md" />
              <button
                type="button"
                onClick={onOpenFull}
                className="text-[10px] text-[var(--theme-text-muted)] underline-offset-2 transition-colors hover:text-[var(--theme-accent)] hover:underline"
              >
                Open full ticket ↗
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Close (Esc)"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="4" y1="4" x2="12" y2="12" />
              <line x1="12" y1="4" x2="4" y2="12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-[var(--theme-border-subtle)] px-3 pt-2">
          {([
            { key: 'deliverables' as const, label: 'Deliverables', icon: <DeliverableIcon /> },
            { key: 'comment' as const, label: 'Comment', icon: <CommentIcon /> },
          ]).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-t-md px-3 py-1.5 text-xs font-medium transition-colors',
                tab === t.key
                  ? 'border-b-2 border-[var(--theme-accent)] text-[var(--theme-text-primary)]'
                  : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)]',
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
          {tab === 'deliverables' ? (
            <TicketDeliverables ticketId={ticket.id} />
          ) : (
            <CommentComposer ticketId={ticket.id} autoFocus />
          )}
        </div>
      </aside>
    </div>
  );
}
