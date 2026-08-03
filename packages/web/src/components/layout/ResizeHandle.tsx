import { useCallback, useRef } from 'react';

import { useUIStore } from '../../stores/uiStore';

const NAV_COLLAPSED_WIDTH = 55;
const NAV_EXPANDED_WIDTH = 180;

export function ResizeHandle() {
  const setContentPanelWidth = useUIStore((s) => s.setContentPanelWidth);
  const isDragging = useRef(false);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;

      const navCollapsed = useUIStore.getState().navCollapsed;
      const navWidth = navCollapsed ? NAV_COLLAPSED_WIDTH : NAV_EXPANDED_WIDTH;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!isDragging.current) return;
        const width = Math.min(Math.max(moveEvent.clientX - navWidth, 240), 520);
        setContentPanelWidth(width);
      };

      const handleMouseUp = () => {
        isDragging.current = false;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [setContentPanelWidth],
  );

  return (
    <div
      className="absolute left-0 top-0 z-10 h-full w-1 cursor-col-resize hover:bg-[var(--theme-accent-muted)] active:bg-[var(--theme-accent-muted)]"
      onMouseDown={handleMouseDown}
    />
  );
}
