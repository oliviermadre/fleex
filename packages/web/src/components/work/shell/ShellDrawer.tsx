/**
 * The bottom shell drawer (⌘J): a user-resizable band that hosts the ShellSurface.
 * Its height lives in workStore (persisted, clamped) and is dragged from the top
 * edge — the drawer's bottom sits just above the 26px status bar, so the height is
 * the distance from the pointer up from there. Hidden via the nav Shell button, so
 * there's no hide control inside.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useWorkStore } from '../../../stores/workStore';
import { ShellSurface } from './ShellSurface';

/** WorkStatusBar height (SPEC §10) — the drawer's bottom edge sits above it. */
const STATUS_BAR_H = 26;

export function ShellDrawer({ ticketId }: { ticketId: string }) {
  const height = useWorkStore((s) => s.shellHeight);
  const setShellHeight = useWorkStore((s) => s.setShellHeight);
  const dragging = useRef(false);

  const onMouseDown = useCallback(() => {
    dragging.current = true;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging.current) return;
      // Bottom edge is fixed just above the status bar; the top follows the pointer.
      setShellHeight(window.innerHeight - STATUS_BAR_H - e.clientY);
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
  }, [setShellHeight]);

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
