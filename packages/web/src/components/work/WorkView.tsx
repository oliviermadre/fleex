/**
 * WorkView — the « Work » single-screen surface, rendered by MainPanel when
 * activePanel === 'work'. It owns everything right of the nav rail: its own top
 * bar and status bar, the task queue (left), the conversation / new-task center,
 * and the one-at-a-time right tool window with its tool strip.
 *
 * Layout (SPEC §1): a top bar and status bar sandwich a middle row of
 *   QUEUE 300px · CENTER minmax(0,1fr) · RIGHT PANEL (toggle) · TOOL STRIP 60px.
 * The shell drawer (⌘J) and shell mode land in Phase 2.
 */
import { useWorkQueue } from './useWorkQueue';
import { useWorkKeyboard } from './keyboard';
import { useWorkStore } from '../../stores/workStore';
import { WorkTopBar } from './WorkTopBar';
import { WorkStatusBar } from './WorkStatusBar';
import { WorkQueue } from './queue/WorkQueue';
import { CollapsedQueueRail } from './queue/CollapsedQueueRail';
import { TaskPane } from './task/TaskPane';
import { NewTask } from './new/NewTask';
import { ToolStrip } from './panel/ToolStrip';
import { RightPanel } from './panel/RightPanel';
import { useTicketDeliverables } from './panel/useTicketDeliverables';

export function WorkView() {
  const queue = useWorkQueue();
  const view = useWorkStore((s) => s.view);
  const rightPanel = useWorkStore((s) => s.rightPanel);
  const queueCollapsed = useWorkStore((s) => s.queueCollapsed);

  // The queue's displayed order drives ⌘⇧↑/↓ navigation.
  useWorkKeyboard(queue.orderedIds);

  const selectedTask = queue.selectedTask;
  // One deliverables subscription for the whole view: feeds the tool-strip badge
  // count and the Delivs panel, both live via WS.
  const { deliverables } = useTicketDeliverables(selectedTask?.id ?? null);

  return (
    <div
      className="flex h-full min-h-0 w-full flex-col overflow-auto bg-[var(--theme-bg-base)] text-[var(--theme-text-primary)]"
      style={{ minWidth: 1180, minHeight: 560 }}
    >
      <WorkTopBar queue={queue} />

      <div className="flex min-h-0 flex-1">
        {queueCollapsed ? <CollapsedQueueRail counts={queue.counts} /> : <WorkQueue queue={queue} />}

        <main className="flex min-w-0 flex-1 flex-col bg-[var(--theme-bg-base)]">
          {view === 'new' ? <NewTask /> : <TaskPane task={selectedTask} deliverables={deliverables} />}
        </main>

        {view === 'task' && rightPanel && selectedTask && (
          <RightPanel task={selectedTask} deliverables={deliverables} />
        )}

        {view === 'task' && <ToolStrip task={selectedTask} delivCount={deliverables.length} />}
      </div>

      {view === 'task' && <WorkStatusBar task={selectedTask} />}
    </div>
  );
}
