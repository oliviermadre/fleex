import { useCallback, useRef } from 'react';
import { useUIStore } from '../../stores/uiStore';

export function ResizeHandle() {
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth);
  const isDragging = useRef(false);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!isDragging.current) return;
        const width = Math.min(Math.max(moveEvent.clientX, 200), 480);
        setSidebarWidth(width);
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
    [setSidebarWidth]
  );

  return (
    <div
      className="absolute left-0 top-0 z-10 h-full w-1 cursor-col-resize hover:bg-violet-500/40 active:bg-violet-500/60"
      onMouseDown={handleMouseDown}
    />
  );
}
