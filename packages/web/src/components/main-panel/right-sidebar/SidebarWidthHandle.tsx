import { useCallback, useRef } from 'react';
import { useUIStore } from '../../../stores/uiStore';

/**
 * Vertical drag handle that resizes the right sidebar's WIDTH by adjusting
 * uiStore.rightSidebarWidth from the right edge of the viewport.
 * Width is computed as `window.innerWidth - clientX` so the sidebar grows
 * as the cursor moves left.
 */
export function SidebarWidthHandle() {
  const setRightSidebarWidth = useUIStore((s) => s.setRightSidebarWidth);
  const isDragging = useRef(false);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;

      const onMove = (ev: MouseEvent) => {
        if (!isDragging.current) return;
        const width = window.innerWidth - ev.clientX;
        setRightSidebarWidth(width);
      };

      const onUp = () => {
        isDragging.current = false;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [setRightSidebarWidth],
  );

  return (
    <div
      className="group/h w-[3px] cursor-col-resize bg-[var(--theme-border)] hover:bg-[var(--theme-accent)] active:bg-[var(--theme-accent)] flex-shrink-0 transition-colors relative"
      onMouseDown={handleMouseDown}
    >
      {/* Wider invisible hit-area for easier grabbing */}
      <span className="absolute inset-y-0 -left-1 -right-1" />
    </div>
  );
}
