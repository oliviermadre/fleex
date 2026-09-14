/**
 * Work top bar (36px, full width): brand, a ⌘K search field that opens the
 * existing command palette, a live summary of the queue, then the overlay-sync
 * button and pinned / workspace actions scoped to the selected task (SPEC §2).
 */
import { useUIStore } from '../../stores/uiStore';
import { useWorkStore } from '../../stores/workStore';
import type { WorkQueueModel } from './useWorkQueue';
import { WorkTopBarActions } from './WorkTopBarActions';
import { ModeSwitcher } from './ModeSwitcher';

interface Props {
  queue: WorkQueueModel;
}

export function WorkTopBar({ queue }: Props) {
  const openCommandPalette = useUIStore((s) => s.openCommandPalette);
  const view = useWorkStore((s) => s.view);
  const { total, running, needs } = queue.counts;
  const selectedTaskId = queue.selectedTask?.id ?? null;

  return (
    <header className="flex h-9 shrink-0 items-center gap-3 border-b border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-3">
      <div className="flex items-center gap-1.5">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-[var(--theme-accent)]">
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill="currentColor" />
        </svg>
        <span className="text-[13px] font-bold tracking-tight text-[var(--theme-text-primary)]">Work</span>
      </div>

      <button
        type="button"
        onClick={openCommandPalette}
        className="flex h-6 min-w-[200px] max-w-xs flex-1 items-center gap-2 rounded-md border border-[var(--theme-border-input)] px-2 text-left text-[12px] text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)]"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="7" cy="7" r="4.5" />
          <line x1="14" y1="14" x2="10.5" y2="10.5" strokeLinecap="round" />
        </svg>
        <span className="flex-1">Search, jump, run…</span>
        <kbd className="text-[10px] text-[var(--theme-text-faint)]">⌘K</kbd>
      </button>

      <div className="ml-auto flex items-center gap-1 text-[11px] text-[var(--theme-text-muted)]">
        <span>{total} tasks</span>
        <span className="text-[var(--theme-text-faint)]">·</span>
        <span className="text-[var(--theme-accent)]">{running} running</span>
        <span className="text-[var(--theme-text-faint)]">·</span>
        <span className="text-[var(--tint-yellow-text)]">{needs} need you</span>
      </div>

      {view === 'task' && selectedTaskId && <ModeSwitcher ticketId={selectedTaskId} />}

      <WorkTopBarActions ticketId={selectedTaskId} />
    </header>
  );
}
