/**
 * Work top bar. It sits to the RIGHT of the task sidebar, which spans the full
 * height, so the bar only tops the working area — and shares that sidebar's
 * header height so both borders line up. MODE on the left, then the pinned
 * actions and the selected task's ticket actions on the right (SPEC §2).
 * No brand or search field here: the nav rail already names the app, the queue
 * names itself, and ⌘K opens the command palette from anywhere (AppLayout).
 */
import { useWorkStore } from '../../stores/workStore';
import type { WorkQueueModel } from './useWorkQueue';
import { WorkTopBarActions } from './WorkTopBarActions';
import { ModeSwitcher } from './ModeSwitcher';

interface Props {
  queue: WorkQueueModel;
}

export function WorkTopBar({ queue }: Props) {
  const view = useWorkStore((s) => s.view);
  const selectedTaskId = queue.selectedTask?.id ?? null;

  return (
    <header
      className="flex shrink-0 items-center gap-3 border-b border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-3"
      style={{ height: 'var(--header-height)' }}
    >
      {view === 'task' && selectedTaskId && <ModeSwitcher ticketId={selectedTaskId} />}

      <div className="ml-auto" />

      <WorkTopBarActions ticketId={selectedTaskId} />
    </header>
  );
}
