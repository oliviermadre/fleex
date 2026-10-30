/**
 * The queue collapsed to a thin rail: an expand button and a vertical "TASKS N"
 * label. Clicking anywhere on the rail expands it back — except the pin chip on
 * top, shown when a pinned task sits outside the filters, which selects it.
 */
import { cn } from '../../../lib/cn';
import { tintClasses } from '../../../lib/tints';
import { useWorkStore } from '../../../stores/workStore';
import { SidePanelIcon } from '../../sidebar/icons';
import type { WorkTask } from '../types';

const PIN = tintClasses('purple');

export function CollapsedQueueRail({
  counts,
  pinned = null,
  selectedId = null,
}: {
  counts: { total: number };
  /** The pinned task when the filters exclude it. */
  pinned?: WorkTask | null;
  selectedId?: string | null;
}) {
  const toggleQueueCollapsed = useWorkStore((s) => s.toggleQueueCollapsed);
  const selectTicket = useWorkStore((s) => s.selectTicket);

  return (
    <div className="flex w-9 shrink-0 flex-col items-center border-r border-[var(--theme-border)] bg-[var(--theme-bg-surface)]">
      {pinned && (
        <>
          <button
            type="button"
            onClick={() => selectTicket(pinned.id)}
            title={`📌 ${pinned.title} — opened outside filters`}
            data-testid="rail-pinned"
            className={cn(
              'mt-2 flex h-7 w-7 items-center justify-center rounded-md border text-[12px]',
              PIN.bg,
              pinned.id === selectedId ? 'border-[var(--theme-accent)]' : cn('border-dashed', PIN.borderColor),
            )}
          >
            📌
          </button>
          <span className="mt-2 h-px w-5 bg-[var(--theme-border)]" />
        </>
      )}
      <button
        type="button"
        onClick={toggleQueueCollapsed}
        title="Expand queue"
        className="flex w-full flex-1 cursor-pointer flex-col items-center gap-2 py-2.5 text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)]"
      >
        <SidePanelIcon size={16} mirrored />
        <span
          className="text-[10.5px] font-semibold tracking-[0.08em]"
          style={{ writingMode: 'vertical-rl' }}
        >
          TASKS {counts.total}
        </span>
      </button>
    </div>
  );
}
