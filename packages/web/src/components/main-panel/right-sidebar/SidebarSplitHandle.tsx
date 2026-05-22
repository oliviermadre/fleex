import { useCallback, useRef } from 'react';
import { useUIStore } from '../../../stores/uiStore';

interface Props {
  /** Ref to the sidebar container so we can compute ratio relative to its height. */
  containerRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Horizontal drag handle that resizes the sidebar's top/bottom split by
 * adjusting uiStore.rightSidebarSplitRatio (fraction of height for the TOP).
 */
export function SidebarSplitHandle({ containerRef }: Props) {
  const setRightSidebarSplitRatio = useUIStore((s) => s.setRightSidebarSplitRatio);
  const isDragging = useRef(false);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;

      const onMove = (ev: MouseEvent) => {
        if (!isDragging.current) return;
        const el = containerRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        if (rect.height <= 0) return;
        const ratio = (ev.clientY - rect.top) / rect.height;
        setRightSidebarSplitRatio(ratio);
      };

      const onUp = () => {
        isDragging.current = false;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [containerRef, setRightSidebarSplitRatio],
  );

  return (
    <div
      className="h-[3px] cursor-row-resize bg-[var(--theme-border)] hover:bg-[var(--theme-accent)] active:bg-[var(--theme-accent)] flex-shrink-0 transition-colors relative"
      onMouseDown={handleMouseDown}
    >
      {/* Wider invisible hit-area for easier grabbing */}
      <span className="absolute inset-x-0 -top-1 -bottom-1" />
    </div>
  );
}
