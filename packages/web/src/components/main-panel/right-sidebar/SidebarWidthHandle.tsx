import { useCallback, useRef } from 'react';

import { clampRightSidebarWidth, useUIStore } from '../../../stores/uiStore';

interface Props {
  /** Ref to the (main panel + right sidebar) container so we can cap width at 75% of it. */
  parentRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Vertical drag handle that resizes the right sidebar's WIDTH by adjusting
 * uiStore.rightSidebarWidth from the right edge of the viewport.
 * Width is computed as `window.innerWidth - clientX` so the sidebar grows
 * as the cursor moves left, then capped at 75% of the parent container.
 */
export function SidebarWidthHandle({ parentRef }: Props) {
  const setRightSidebarWidth = useUIStore((s) => s.setRightSidebarWidth);
  const isDragging = useRef(false);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;

      const onMove = (ev: MouseEvent) => {
        if (!isDragging.current) return;
        const rawWidth = window.innerWidth - ev.clientX;
        const parentWidth = parentRef.current?.getBoundingClientRect().width ?? window.innerWidth;
        setRightSidebarWidth(clampRightSidebarWidth(rawWidth, parentWidth));
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
    [parentRef, setRightSidebarWidth],
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
