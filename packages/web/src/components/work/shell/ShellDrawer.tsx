/**
 * The bottom shell drawer (⌘J): a user-resizable band that hosts the ShellSurface.
 * Its height lives in workStore (persisted, clamped) and is dragged from the top
 * edge (see useBottomDrawerResize). It shares the bottom slot with the Timeline
 * drawer — the store keeps only one of them open. Hidden via the nav Shell
 * button, so there's no hide control inside.
 */
import { useWorkStore } from '../../../stores/workStore';
import { useBottomDrawerResize } from '../useBottomDrawerResize';
import { ShellSurface } from './ShellSurface';

export function ShellDrawer({ ticketId }: { ticketId: string }) {
  const height = useWorkStore((s) => s.shellHeight);
  const setShellHeight = useWorkStore((s) => s.setShellHeight);
  const onMouseDown = useBottomDrawerResize(setShellHeight);

  return (
    <div
      className="relative flex shrink-0 flex-col border-t border-[var(--theme-border)] bg-[var(--theme-bg-surface)]"
      style={{ height }}
    >
      {/* Drag handle on the top edge */}
      <div
        onMouseDown={onMouseDown}
        className="absolute -top-1 left-0 z-10 h-2 w-full cursor-row-resize hover:bg-[var(--theme-accent-muted)]"
        title="Drag to resize"
      />
      <ShellSurface ticketId={ticketId} />
    </div>
  );
}
