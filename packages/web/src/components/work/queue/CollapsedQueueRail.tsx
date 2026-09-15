/**
 * The queue collapsed to a thin rail: an expand button and a vertical "QUEUE N"
 * label. Clicking anywhere on the rail expands it back.
 */
import { useWorkStore } from '../../../stores/workStore';

export function CollapsedQueueRail({ counts }: { counts: { total: number } }) {
  const toggleQueueCollapsed = useWorkStore((s) => s.toggleQueueCollapsed);

  return (
    <button
      type="button"
      onClick={toggleQueueCollapsed}
      title="Expand queue"
      className="flex w-9 shrink-0 cursor-pointer flex-col items-center gap-2 border-r border-[var(--theme-border)] bg-[var(--theme-bg-surface)] py-2.5 text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)]"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 6l6 6-6 6" />
      </svg>
      <span
        className="text-[10.5px] font-semibold tracking-[0.08em]"
        style={{ writingMode: 'vertical-rl' }}
      >
        QUEUE {counts.total}
      </span>
    </button>
  );
}
