/**
 * The Timeline bottom drawer of the Work view (⌥T). Same slot, same resize
 * handle as the Shell drawer — the store keeps only one of the two open. It
 * wires the frieze to the ticket's data (useTicketTimeline) and maps picto
 * clicks to the app's existing actions: execution log, deliverable reader,
 * GitHub, the Shell pane, the conversation, the Workflow view.
 *
 * It also owns the annotation popovers (composer, reader, stack list): the
 * frieze reports clicks with a screen rect, the drawer opens the popover there.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TicketDeliverable } from '@fleex/shared';
import { useWorkStore } from '../../../stores/workStore';
import { useUIStore } from '../../../stores/uiStore';
import { useUnreadStore } from '../../../stores/unreadStore';
import { useTicketStore } from '../../../stores/ticketStore';
import { useAnnotationStore, type UiAnnotation } from '../../../stores/annotationStore';
import { useBottomDrawerResize } from '../useBottomDrawerResize';
import { openTicketSessionInWork } from '../openInWork';
import type { WorkTask } from '../types';
import type { TimelineAction } from './buildTimeline';
import { TicketTimeline, type TimelineAnnotationsProps } from './TicketTimeline';
import { AnnotationComposer, AnnotationStackList, AnnotationViewer, type AnchorRect } from './AnnotationPopovers';
import type { PlacedCard } from './layoutAnnotations';
import { useTicketTimeline } from './useTicketTimeline';

interface Props {
  task: WorkTask;
  deliverables: readonly TicketDeliverable[];
  onOpenExecution: (executionId: string, title: string) => void;
}

const EMPTY: UiAnnotation[] = [];

const rectOf = (el: Element): AnchorRect => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
};

/** Scroll the conversation to a comment once the chat center has rendered. */
export function revealComment(commentId: string) {
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
  const ticketCreatedAt = useTicketStore((s) => s.tickets.find((t) => t.id === task.id)?.createdAt ?? null);

  // ── Annotations ──
  const list = useAnnotationStore((s) => s.byTicket[task.id] ?? EMPTY);
  const highlight = useAnnotationStore((s) => s.highlight);
  const composer = useAnnotationStore((s) => (s.composer?.ticketId === task.id ? s.composer : null));
  const [composerAnchor, setComposerAnchor] = useState<AnchorRect | null>(null);
  const [viewer, setViewer] = useState<{ id: string; anchor: AnchorRect } | null>(null);
  const [stack, setStack] = useState<{ ids: string[]; anchor: AnchorRect } | null>(null);
  const [contentH, setContentH] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void useAnnotationStore.getState().load(task.id);
  }, [task.id]);

  // A composer opened from elsewhere (pin a comment) comes without a rect:
  // anchor it on the comment's picto, else on the drawer itself.
  useEffect(() => {
    if (!composer || composerAnchor) return;
    const id = requestAnimationFrame(() => {
      const node = composer.mode === 'promote'
        ? root.current?.querySelector(`[data-timeline-node="${CSS.escape(`comment:${composer.commentId}`)}"]`)
        : null;
      const r = (node ?? root.current)?.getBoundingClientRect();
      if (r) setComposerAnchor(node ? rectOf(node) : { left: r.left + r.width / 2, top: r.top + 40, width: 0, height: 0 });
    });
    return () => cancelAnimationFrame(id);
  }, [composer, composerAnchor]);

  const annotations = useMemo<TimelineAnnotationsProps>(() => ({
    list,
    highlight,
    onCreateAt: (at: number, anchor: AnchorRect) => {
      setViewer(null);
      setStack(null);
      setComposerAnchor(anchor);
      useAnnotationStore.getState().openComposer({
        mode: 'create', ticketId: task.id, draft: { at: new Date(at).toISOString(), title: '', body: '', tone: 'info' },
      });
    },
    onOpenCard: (card: PlacedCard<UiAnnotation>, anchor: AnchorRect) => {
      setStack(null);
      if (card.kind === 'stack') {
        setViewer(null);
        setStack({ ids: card.items.map((i) => i.annotation.id), anchor });
        return;
      }
      const a = card.item.annotation;
      if (a.uiState === 'error') {
        setComposerAnchor(anchor);
        useAnnotationStore.getState().openComposer({
          mode: 'retry', ticketId: task.id, tempId: a.id, commentId: a.sourceCommentId,
          draft: { at: a.at, title: a.title, body: a.body, tone: a.tone },
        });
        return;
      }
      if (!a.uiState) setViewer({ id: a.id, anchor });
    },
  }), [list, highlight, task.id]);

  const closeComposer = useCallback(() => {
    // Closing a failed draft's retry keeps the red card: "Réessayer / Abandonner" stays on it.
    useAnnotationStore.getState().closeComposer();
    setComposerAnchor(null);
  }, []);
  const viewed = viewer ? list.find((a) => a.id === viewer.id) ?? null : null;

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
      ref={root}
      className="relative flex shrink-0 flex-col border-t border-[var(--theme-border)] bg-[var(--theme-bg-surface)]"
      // The annotation band sits on top of the frieze: grow to show it whole.
      style={{ height: Math.max(height, contentH + 16) }}
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
        annotations={annotations}
        onContentHeight={setContentH}
      />
      {composer && composerAnchor && (
        <AnnotationComposer
          key={`${composer.mode}:${composer.mode === 'edit' ? composer.annotationId : composer.draft.at}`}
          request={composer}
          anchor={composerAnchor}
          ticketCreatedAt={ticketCreatedAt}
          onCancel={closeComposer}
          onDiscard={composer.mode === 'retry' ? () => {
            useAnnotationStore.getState().discard(task.id, composer.tempId);
            closeComposer();
          } : undefined}
          onSubmit={(req) => {
            setComposerAnchor(null);
            void useAnnotationStore.getState().submit(req);
          }}
        />
      )}
      {viewer && viewed && (
        <AnnotationViewer
          annotation={viewed}
          anchor={viewer.anchor}
          onClose={() => setViewer(null)}
          onTone={(tone) => void useAnnotationStore.getState().update(task.id, viewed.id, { tone })}
          onSeeComment={(commentId) => {
            setViewer(null);
            useWorkStore.getState().setMode('chat');
            revealComment(commentId);
          }}
          onEdit={() => {
            setComposerAnchor(viewer.anchor);
            setViewer(null);
            useAnnotationStore.getState().openComposer({
              mode: 'edit', ticketId: task.id, annotationId: viewed.id,
              draft: { at: viewed.at, title: viewed.title, body: viewed.body, tone: viewed.tone },
            });
          }}
          onDelete={() => {
            setViewer(null);
            void useAnnotationStore.getState().remove(task.id, viewed.id);
          }}
        />
      )}
      {stack && (
        <AnnotationStackList
          annotations={stack.ids.map((id) => list.find((a) => a.id === id)).filter((a): a is UiAnnotation => !!a)}
          anchor={stack.anchor}
          onClose={() => setStack(null)}
          onOpen={(id) => {
            setViewer({ id, anchor: stack.anchor });
            setStack(null);
          }}
        />
      )}
    </div>
  );
}
