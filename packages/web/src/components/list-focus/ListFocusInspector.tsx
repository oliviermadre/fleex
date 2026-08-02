import { useEffect, useMemo, useState } from 'react';

import type { Board, Ticket, TicketStatus } from '@fleex/shared';

import { cn } from '../../lib/cn';
import { executeSkill } from '../../services/api';
import { appWs } from '../../services/websocket';
import { useSessionStore } from '../../stores/sessionStore';
import { useUIStore } from '../../stores/uiStore';
import { useWorkflowRunStore } from '../../stores/workflowRunStore';
import { findSessionsForTicketId } from '../dashboard/dashboard-helpers';
import { SmartSessionButton } from '../dashboard/SmartSessionButton';
import { SidebarWidthHandle } from '../main-panel/right-sidebar/SidebarWidthHandle';
import { TicketComments } from '../tickets/TicketComments';
import { TicketDeliverables } from '../tickets/TicketDeliverables';

import { CommentIcon, DeliverableIcon } from './icons';
import { StatusChipDropdown } from './StatusChipDropdown';

import type { InspectorFocus } from '../../stores/listFocusStore';

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
  /** Move the cursor to the previous/next ticket in the frozen list (the < > chevrons). */
  onPrev: () => void;
  onNext: () => void;
  /** Whether a previous/next ticket exists — disables the chevron at the bounds. */
  canPrev: boolean;
  canNext: boolean;
}

/**
 * Right-side inspector (view #400). Non-fullscreen and resizable via the shared
 * SidebarWidthHandle + uiStore.rightSidebarWidth (same primitive as the ticket
 * panel's sidebar). Surfaces exactly the three cockpit actions: change status
 * (header chip), view deliverables, and read/write comments (full thread —
 * same TicketComments as the ticket panel) to relaunch an agent.
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
  onPrev,
  onNext,
  canPrev,
  canNext,
}: Props) {
  const width = useUIStore((s) => s.rightSidebarWidth);
  // Comment-first (review remark 2): the cockpit's primary action is reading /
  // answering the thread; deliverables only take over on a badge click.
  const [tab, setTab] = useState<InspectorTab>(
    focus === 'deliverables' ? 'deliverables' : 'comment',
  );

  // Resolve the ticket's sessions exactly like the cockpit rows and the kanban
  // card, so the header's Smart Session launcher shows the same state.
  const sessionGroups = useSessionStore((s) => s.sessionGroups);
  const ticketSessions = useMemo(
    () => findSessionsForTicketId(ticket.id, sessionGroups),
    [ticket.id, sessionGroups],
  );

  // Re-emphasise the requested section when the selection or the badge-driven
  // focus changes (e.g. clicking a deliverables badge on another row).
  useEffect(() => {
    setTab(focus === 'deliverables' ? 'deliverables' : 'comment');
  }, [focus, ticket.id]);

  // The human-gate card inside TicketComments reads workflowRunStore but relies
  // on its PARENT to load the runs (TicketDetail does the same). Without this,
  // the validation encart only appeared after visiting the full ticket once
  // (review remark 1). Same load + workflow:* WS wiring as TicketDetail.
  useEffect(() => {
    void useWorkflowRunStore.getState().loadForTicket(ticket.id);
  }, [ticket.id]);
  useEffect(() => {
    const unsub = appWs.onChannel('tickets', (raw) => {
      try {
        if (!raw.type.startsWith('workflow:')) return;
        const { ticketId: tid } = raw.data as { ticketId: string };
        if (tid !== ticket.id) return;
        useWorkflowRunStore.getState().applyEvent({
          type: raw.type,
          ticketId: tid,
          payload: raw.data as Record<string, unknown>,
        });
      } catch {
        /* ignore malformed events */
      }
    });
    return unsub;
  }, [ticket.id]);

  return (
    // shrink-0: the inspector holds its width; the list (flex-1) is the side
    // that shrinks, so the panel can never be squeezed off-screen by wide rows.
    <div className="flex h-full shrink-0">
      <SidebarWidthHandle parentRef={parentRef} />
      <aside
        style={{ width }}
        className="flex h-full flex-col border-l border-[var(--theme-border)] bg-[var(--theme-bg-surface)]"
      >
        {/* Header (NaS redesign, round 5 — matches the approved prototype).
            Three lines, each with a single job:
              1. meta bar — a [< n/total >] pill (prev/next stepper into the
                 frozen list) + the board (quiet), with "Open full ↗" + ✕ paired
                 top-right.
              2. the ticket title, given strong emphasis (xl/bold), with a faint
                 #id trailing it.
              3. the status dropdown (tinted to the current status) on the left
                 and the Smart Session launcher on the right. */}
        <div className="flex flex-col gap-3 border-b border-[var(--theme-border-subtle)] px-4 py-3">
          {/* Line 1 — meta bar. */}
          <div className="flex items-center gap-2 text-[11px] text-[var(--theme-text-faint)]">
            {/* Position stepper: < n/total >. The chevrons move the selection in
                the frozen list (same as ↑/↓); disabled at the list bounds. */}
            <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-overlay)] px-1 py-0.5">
              <button
                type="button"
                onClick={onPrev}
                disabled={!canPrev}
                title="Previous (↑)"
                className="flex h-4 w-4 items-center justify-center rounded text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)] disabled:pointer-events-none disabled:opacity-30"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="10,4 6,8 10,12" />
                </svg>
              </button>
              {positionLabel && (
                <span className="tabular-nums font-medium text-[var(--theme-text-muted)]">
                  {positionLabel}
                </span>
              )}
              <button
                type="button"
                onClick={onNext}
                disabled={!canNext}
                title="Next (↓)"
                className="flex h-4 w-4 items-center justify-center rounded text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)] disabled:pointer-events-none disabled:opacity-30"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="6,4 10,8 6,12" />
                </svg>
              </button>
            </div>
            {board && (
              <span className="flex min-w-0 items-center gap-1 truncate font-medium text-[var(--theme-text-muted)]">
                <span className="shrink-0">{board.emoji}</span>
                <span className="truncate">{board.name}</span>
              </span>
            )}
            <div className="ml-auto flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={onOpenFull}
                className="whitespace-nowrap text-[var(--theme-text-muted)] underline-offset-2 transition-colors hover:text-[var(--theme-accent)] hover:underline"
              >
                Open full ↗
              </button>
              <button
                type="button"
                onClick={onClose}
                title="Close (Esc)"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <line x1="4" y1="4" x2="12" y2="12" />
                  <line x1="12" y1="4" x2="4" y2="12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Line 2 — title (primary, strongly emphasised) + faint #id. */}
          <h2 className="text-xl font-bold leading-tight text-[var(--theme-text-primary)]">
            {ticket.title}
            <span className="ml-2 align-middle font-mono text-sm font-normal text-[var(--theme-text-faint)]">
              #{ticket.displayId}
            </span>
          </h2>

          {/* Line 3 — status dropdown (left) · Smart Session launcher (right).
              stopPropagation on the launcher wrapper: opening its menu must never
              bubble up to the aside / row-selection handlers. */}
          <div className="flex items-center justify-between gap-2">
            <StatusChipDropdown status={ticket.status} onChange={onStatusChange} size="md" />
            <div onClick={(e) => e.stopPropagation()}>
              <SmartSessionButton
                sessions={ticketSessions}
                ticketId={ticket.id}
                onExecuteSkill={(skillId) => executeSkill(skillId, ticket.id)}
              />
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-[var(--theme-border-subtle)] px-3 pt-2">
          {[
            { key: 'comment' as const, label: 'Comment', icon: <CommentIcon /> },
            { key: 'deliverables' as const, label: 'Deliverables', icon: <DeliverableIcon /> },
          ].map((t) => (
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

        {/* Content. The comment tab hosts the full TicketComments thread —
            same component as the ticket panel, so comments actually display
            here (read + compose + mark-read) — and it owns its own scroller,
            so overflow-y-auto only applies to the deliverables tab. */}
        {tab === 'deliverables' ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
            <TicketDeliverables ticketId={ticket.id} />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">
            <TicketComments ticketId={ticket.id} />
          </div>
        )}
      </aside>
    </div>
  );
}
