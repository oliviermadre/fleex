/**
 * The Timeline bottom drawer of the Work view (⌥T). Same slot, same resize
 * handle as the Shell drawer — the store keeps only one of the two open. It
 * wires the frieze to the ticket's data (useTicketTimeline) and maps picto
 * clicks to the app's existing actions: execution log, deliverable reader,
 * GitHub, the Shell pane, the conversation, the Workflow view.
 */
import { useCallback } from 'react';
import type { TicketDeliverable } from '@fleex/shared';
import { useWorkStore } from '../../../stores/workStore';
import { useUIStore } from '../../../stores/uiStore';
import { useUnreadStore } from '../../../stores/unreadStore';
import { useBottomDrawerResize } from '../useBottomDrawerResize';
import { openTicketSessionInWork } from '../openInWork';
import type { WorkTask } from '../types';
import type { TimelineAction } from './buildTimeline';
import { TicketTimeline } from './TicketTimeline';
import { useTicketTimeline } from './useTicketTimeline';

interface Props {
  task: WorkTask;
  deliverables: readonly TicketDeliverable[];
  onOpenExecution: (executionId: string, title: string) => void;
}

/** Scroll the conversation to a comment once the chat center has rendered. */
function revealComment(commentId: string) {
  let tries = 0;
  const tick = () => {
    const el = [...document.querySelectorAll<HTMLElement>('[data-comment-id]')].find((n) => n.dataset.commentId === commentId);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    else if (tries++ < 10) setTimeout(tick, 50);
  };
  requestAnimationFrame(tick);
}

export function TimelineDrawer({ task, deliverables, onOpenExecution }: Props) {
  const height = useWorkStore((s) => s.timelineHeight);
  const setTimelineHeight = useWorkStore((s) => s.setTimelineHeight);
  const filters = useWorkStore((s) => s.timelineFilters);
  const toggleTimelineFilter = useWorkStore((s) => s.toggleTimelineFilter);
  const onMouseDown = useBottomDrawerResize(setTimelineHeight);
  const { model } = useTicketTimeline(task, deliverables);

  const onAction = useCallback(
    (action: TimelineAction) => {
      switch (action.type) {
        case 'execution':
          onOpenExecution(action.executionId, action.title);
          return;
        case 'workflow':
          useWorkStore.getState().setMode('workflow');
          return;
        case 'deliverable': {
          const d = deliverables.find((x) => x.id === action.deliverableId);
          if (!d) return;
          if (d.ticketId) void useUnreadStore.getState().toggleDeliverableSeen(d.ticketId, d.id, true);
          useUIStore.getState().openDeliverableOverlay(d);
          return;
        }
        case 'comment':
          useWorkStore.getState().setMode('chat');
          revealComment(action.commentId);
          return;
        case 'url':
          window.open(action.url, '_blank', 'noopener');
          return;
        case 'session':
          openTicketSessionInWork(task.id, action.sessionId);
          return;
      }
    },
    [deliverables, onOpenExecution, task.id],
  );

  return (
    <div
      className="relative flex shrink-0 flex-col border-t border-[var(--theme-border)] bg-[var(--theme-bg-surface)]"
      style={{ height }}
      data-testid="timeline-drawer"
    >
      <div
        onMouseDown={onMouseDown}
        className="absolute -top-1 left-0 z-10 h-2 w-full cursor-row-resize hover:bg-[var(--theme-accent-muted)]"
        title="Drag to resize"
      />
      <TicketTimeline
        header={{ number: task.number, title: task.title, boardName: task.boardName, status: task.status, type: task.type }}
        model={model}
        filters={filters}
        onToggleFilter={toggleTimelineFilter}
        onAction={onAction}
      />
    </div>
  );
}
