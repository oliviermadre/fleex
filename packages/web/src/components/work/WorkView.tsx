/**
 * WorkView — the « Work » single-screen surface, rendered by MainPanel when
 * activePanel === 'work'. It owns everything right of the nav rail: the task
 * queue (left), the conversation / new-task center with its own top bar, the
 * one-at-a-time right tool window with its tool strip, and the status bar.
 *
 * Layout (SPEC §1), a 3×3 grid:
 *
 *   QUEUE | TOP BAR ───────────────────────────────
 *   QUEUE | CENTER · RIGHT PANEL (toggle) | TOOL STRIP
 *   BOTTOM DRAWER ────────────────────────| TOOL STRIP
 *
 * The bottom drawer — shell (⌘J) or Timeline (⌥T), one at a time — runs under
 * the queue too, so it spans everything between the nav rail and the tool
 * strip. The status bar spans the whole width, underneath.
 */
import { useEffect, useLayoutEffect, useState } from 'react';
import { useWorkQueue } from './useWorkQueue';
import { useWorkKeyboard } from './keyboard';
import { useWorkStore, useEffectiveRightPanel, useBrowserTakesCenter } from '../../stores/workStore';
import { useTicketStore } from '../../stores/ticketStore';
import { useWorkflowRunStore } from '../../stores/workflowRunStore';
import { TicketWorkflowTab } from '../workflows/TicketWorkflowTab';
import { WorkTopBar } from './WorkTopBar';
import { WorkStatusBar } from './WorkStatusBar';
import { WorkQueue } from './queue/WorkQueue';
import { CollapsedQueueRail } from './queue/CollapsedQueueRail';
import { TaskPane } from './task/TaskPane';
import { NewTask } from './new/NewTask';
import { ToolStrip } from './panel/ToolStrip';
import { RightPanel } from './panel/RightPanel';
import { ShellSurface } from './shell/ShellSurface';
import { ShellDrawer } from './shell/ShellDrawer';
import { TimelineDrawer } from './timeline/TimelineDrawer';
import { CodeEditor } from './panel/CodeEditor';
import { useTicketDeliverables } from './panel/useTicketDeliverables';
import { useTicketMentions } from './panel/useTicketMentions';
import { FloatingExecutionPanel } from '../tickets/ExecutionModal';

export function WorkView() {
  const queue = useWorkQueue();
  const view = useWorkStore((s) => s.view);
  const rightPanel = useEffectiveRightPanel();
  const browserTakesCenter = useBrowserTakesCenter();
  const queueCollapsed = useWorkStore((s) => s.queueCollapsed);
  const shellOpen = useWorkStore((s) => s.shellOpen);
  const shellMode = useWorkStore((s) => s.shellMode);
  const timelineOpen = useWorkStore((s) => s.timelineOpen);
  const codeMode = useWorkStore((s) => s.codeMode);
  const workflowMode = useWorkStore((s) => s.workflowMode);

  // The queue's displayed order drives ⌘⇧↑/↓ navigation.
  useWorkKeyboard(queue.orderedIds);

  const selectedTask = queue.selectedTask;

  // Load the selected ticket's workflow runs regardless of the active center
  // mode, so the "Workflow" toggle appears reliably (and its view is warm) even
  // when the user is on Code/Shell. Self-cleaning + seq-guarded in the store.
  const selectedTaskId = selectedTask?.id ?? null;
  useEffect(() => {
    if (selectedTaskId) void useWorkflowRunStore.getState().loadForTicket(selectedTaskId);
  }, [selectedTaskId]);

  // When the remembered task falls out of the queue (filtered out, deleted), the
  // view shows the first row instead: adopt it as the selection so the store —
  // and the /work/:ticketId URL built from it — names what is on screen. Never
  // the pinned task: it is shown whatever the filters (useWorkQueue keeps it
  // selected, and shows nothing rather than a fallback while it loads).
  const selectedTicketId = useWorkStore((s) => s.selectedTicketId);
  const pinnedTicketId = useWorkStore((s) => s.pinnedTicketId);
  useEffect(() => {
    if (view !== 'task' || !selectedTaskId || selectedTaskId === selectedTicketId) return;
    if (selectedTicketId && selectedTicketId === pinnedTicketId) return;
    useWorkStore.getState().selectTicket(selectedTaskId);
  }, [view, pinnedTicketId, selectedTaskId, selectedTicketId]);

  // Each ticket keeps its own center mode (chat / code / shell / workflow): apply
  // the selected one's before paint, so switching never flashes the previous mode.
  const restoreTicketMode = useWorkStore((s) => s.restoreTicketMode);
  useLayoutEffect(() => {
    if (selectedTaskId) restoreTicketMode(selectedTaskId);
  }, [selectedTaskId, restoreTicketMode]);

  // Deleting from the Context panel lands on the queue neighbour, not the first row.
  const deleteTicket = useTicketStore((s) => s.deleteTicket);
  const selectTicket = useWorkStore((s) => s.selectTicket);
  const forgetTicket = useWorkStore((s) => s.forgetTicket);
  const deleteTask = async (id: string) => {
    if (!confirm('Delete this ticket?')) return;
    const ids = queue.orderedIds;
    const idx = ids.indexOf(id);
    const neighbour = idx >= 0 ? (ids[idx + 1] ?? ids[idx - 1] ?? null) : null;
    await deleteTicket(id);
    forgetTicket(id);
    selectTicket(neighbour);
  };
  const hasWorkflowRuns = useWorkflowRunStore((s) =>
    selectedTaskId ? (s.runsByTicket[selectedTaskId]?.length ?? 0) > 0 : false,
  );
  // One deliverables subscription for the whole view: feeds the tool-strip badge
  // count and the Delivs panel, both live via WS.
  const { deliverables, removeDeliverable } = useTicketDeliverables(selectedTask?.id ?? null);
  // Same for mentions: one subscription feeds the tool-strip badge.
  const { openCount: mentionCount } = useTicketMentions(selectedTask?.id ?? null);

  // A single execution-log panel for the whole view — opened from a queue row's
  // running badge or a timeline run card.
  const [execLog, setExecLog] = useState<{ id: string; title: string } | null>(null);
  const openExecution = (id: string, title: string) => setExecLog({ id, title });

  return (
    // No size floor: the app shell clips (overflow-hidden), so a min width/height
    // here cut the tool strip and the bottom of every column off on small
    // windows. The center shrinks instead; the side columns scroll on their own.
    <div className="flex h-full min-h-0 w-full flex-col bg-[var(--theme-bg-base)] text-[var(--theme-text-primary)]">
      <div className="grid min-h-0 flex-1 grid-cols-[auto_minmax(0,1fr)_auto] grid-rows-[auto_minmax(0,1fr)_auto]">
        {/* The queue runs down to the bottom drawer, so the top bar starts to its right. */}
        <div className="col-start-1 row-span-2 row-start-1 flex min-h-0">
          {queueCollapsed ? (
            <CollapsedQueueRail counts={queue.counts} pinned={queue.pinned?.task ?? null} selectedId={view === 'task' ? selectedTaskId : null} />
          ) : (
            <WorkQueue queue={queue} onOpenExecution={openExecution} />
          )}
        </div>

        <div className="col-span-2 col-start-2 row-start-1 min-w-0">
          <WorkTopBar queue={queue} />
        </div>

        <div className="col-start-2 row-start-2 flex min-h-0 min-w-0">
          {/* An expanded browser takes the whole center (wide pages need it) — only
              where the panel itself renders, so the center never goes blank. */}
          {!(browserTakesCenter && view === 'task' && selectedTask) && (
            <main className="flex min-w-0 flex-1 flex-col bg-[var(--theme-bg-base)]">
              {view === 'new' ? (
                <NewTask />
              ) : codeMode && selectedTask ? (
                <CodeEditor ticketId={selectedTask.id} />
              ) : shellMode && selectedTask ? (
                <ShellSurface key={selectedTask.id} ticketId={selectedTask.id} />
              ) : workflowMode && selectedTask && hasWorkflowRuns ? (
                <TicketWorkflowTab ticketId={selectedTask.id} />
              ) : (
                <TaskPane
                  task={selectedTask}
                  deliverables={deliverables}
                  onDeliverableDeleted={removeDeliverable}
                  onOpenExecution={openExecution}
                />
              )}
            </main>
          )}

          {view === 'task' && rightPanel && selectedTask && (
            <RightPanel
              task={selectedTask}
              deliverables={deliverables}
              onDeliverableDeleted={removeDeliverable}
              onDeleteTask={(id) => void deleteTask(id)}
            />
          )}
        </div>

        {/* The tool strip runs down beside the bottom drawer: its Shell / Timeline
            buttons stay next to the band they toggle. */}
        {view === 'task' && (
          <div className="col-start-3 row-span-2 row-start-2 flex min-h-0">
            <ToolStrip task={selectedTask} delivCount={deliverables.length} mentionCount={mentionCount} />
          </div>
        )}

        {/* Bottom drawer — Shell (⌘J) or Timeline (⌥T), the store never lets both
            open. Full width between the nav rail and the tool strip, under the queue. */}
        {view === 'task' && selectedTask && ((shellOpen && !shellMode) || timelineOpen) && (
          <div className="col-span-2 col-start-1 row-start-3 flex min-w-0 flex-col" data-testid="work-bottom-drawer">
            {shellOpen && !shellMode && <ShellDrawer key={selectedTask.id} ticketId={selectedTask.id} />}
            {timelineOpen && (
              <TimelineDrawer key={selectedTask.id} task={selectedTask} deliverables={deliverables} onOpenExecution={openExecution} />
            )}
          </div>
        )}
      </div>

      {view === 'task' && <WorkStatusBar task={selectedTask} />}

      {execLog && (
        <FloatingExecutionPanel executionId={execLog.id} title={execLog.title} onClose={() => setExecLog(null)} />
      )}
    </div>
  );
}
