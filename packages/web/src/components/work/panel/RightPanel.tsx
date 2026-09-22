/**
 * The one-at-a-time right tool window (Context / Delivs). User-resizable from its
 * left edge — the width lives in workStore (persisted, clamped) so it survives
 * reloads, mirroring the app's right-sidebar handle. The tool strip sits to its
 * right, so the panel grows leftward.
 */
import { useCallback, useEffect, useRef } from 'react';
import type { TicketDeliverable } from '@fleex/shared';
import { useWorkStore, RIGHT_PANEL_MIN, RIGHT_PANEL_MAX } from '../../../stores/workStore';
import type { WorkTask } from '../types';
import { ContextPanel } from './ContextPanel';
import { DelivsPanel } from './DelivsPanel';
import { DiffPanel } from './DiffPanel';
import { ScratchpadTabsPanel } from './ScratchpadTabsPanel';
import { ThreadsPanel } from './ThreadsPanel';

const TITLES: Record<string, string> = {
  context: 'CONTEXT',
  deliv: 'DELIVERABLES',
  thread: 'THREADS',
  diff: 'DIFF',
  code: 'CODE',
  scratch: 'NOTES',
};

/** The tool strip is 60px; the panel's right edge sits at that offset. */
const TOOL_STRIP_WIDTH = 60;

export function RightPanel({
  task,
  deliverables,
  onDeleteTask,
  onOpenExecution,
}: {
  task: WorkTask;
  deliverables: TicketDeliverable[];
  onDeleteTask: (id: string) => void;
  onOpenExecution: (executionId: string, title: string) => void;
}) {
  const rightPanel = useWorkStore((s) => s.rightPanel);
  const width = useWorkStore((s) => s.rightPanelWidth);
  const setRightPanelWidth = useWorkStore((s) => s.setRightPanelWidth);
  const dragging = useRef(false);

  const onMouseDown = useCallback(() => {
    dragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging.current) return;
      // Panel grows leftward from its right edge (which sits left of the strip).
      const raw = window.innerWidth - TOOL_STRIP_WIDTH - e.clientX;
      setRightPanelWidth(raw);
    }
    function onUp() {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [setRightPanelWidth]);

  if (!rightPanel) return null;

  // Keep at least ~360px for the queue + center even at the widest drag.
  const viewportCap =
    typeof window !== 'undefined' ? Math.max(RIGHT_PANEL_MIN, window.innerWidth - 360) : RIGHT_PANEL_MAX;
  const effectiveWidth = Math.min(RIGHT_PANEL_MAX, viewportCap, Math.max(RIGHT_PANEL_MIN, width));

  return (
    <section
      className="relative flex shrink-0 flex-col border-l border-[var(--theme-border)] bg-[var(--theme-bg-surface)]"
      style={{ width: effectiveWidth }}
    >
      {/* Drag handle on the left edge */}
      <div
        onMouseDown={onMouseDown}
        className="absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-[var(--theme-accent-muted)]"
        title="Drag to resize"
      />
      <div className="flex h-9 shrink-0 items-center border-b border-[var(--theme-border)] px-3 text-[11px] font-semibold tracking-[0.06em] text-[var(--theme-text-secondary)]">
        {TITLES[rightPanel] ?? ''}
      </div>
      {rightPanel === 'context' && <ContextPanel task={task} onDelete={() => onDeleteTask(task.id)} />}
      {rightPanel === 'diff' && <DiffPanel ticketId={task.id} />}
      {rightPanel === 'deliv' && <DelivsPanel ticketId={task.id} deliverables={deliverables} />}
      {rightPanel === 'scratch' && <ScratchpadTabsPanel task={task} />}
      {rightPanel === 'thread' && <ThreadsPanel task={task} onOpenExecution={onOpenExecution} />}
    </section>
  );
}
