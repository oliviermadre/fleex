import { useState, useRef, useEffect, useCallback } from 'react';

export type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

/** Clamp position so the panel stays fully within the viewport */
export function clampPosition(
  x: number,
  y: number,
  w: number,
  h: number,
): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(x, window.innerWidth - w)),
    y: Math.max(0, Math.min(y, window.innerHeight - h)),
  };
}

const CURSOR_MAP: Record<ResizeDirection, string> = {
  n: 'n-resize',
  s: 's-resize',
  e: 'e-resize',
  w: 'w-resize',
  nw: 'nw-resize',
  ne: 'ne-resize',
  sw: 'sw-resize',
  se: 'se-resize',
};

// Which directions affect which axis
const MOVES_LEFT = new Set<ResizeDirection>(['w', 'nw', 'sw']);
const MOVES_RIGHT = new Set<ResizeDirection>(['e', 'ne', 'se']);
const MOVES_TOP = new Set<ResizeDirection>(['n', 'nw', 'ne']);
const MOVES_BOTTOM = new Set<ResizeDirection>(['s', 'sw', 'se']);

export function useFloatingResize(options: {
  minWidth: number;
  minHeight: number;
  defaultWidth: number;
  defaultHeight: number;
  initialOffset?: number;
  onResizeMove?: () => void;
  onResizeEnd?: () => void;
}) {
  const {
    minWidth,
    minHeight,
    defaultWidth,
    defaultHeight,
    initialOffset = 0,
    onResizeMove,
    onResizeEnd,
  } = options;

  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState({ width: defaultWidth, height: defaultHeight });
  const resizeRef = useRef({
    resizing: false,
    direction: 'se' as ResizeDirection,
    startX: 0,
    startY: 0,
    startW: 0,
    startH: 0,
    startPosX: 0,
    startPosY: 0,
  });

  // Center on first render (with cascade offset)
  useEffect(() => {
    if (position !== null) return;
    const rawX = (window.innerWidth - defaultWidth) / 2 + initialOffset;
    const rawY = (window.innerHeight - defaultHeight) / 2 - 40 + initialOffset;
    setPosition(clampPosition(rawX, rawY, defaultWidth, defaultHeight));
  }, [position, initialOffset, defaultWidth, defaultHeight]);

  const effectivePos = position ?? { x: 0, y: 0 };

  // Re-clamp when window resizes
  useEffect(() => {
    function handleWindowResize() {
      setPosition((prev) => (prev ? clampPosition(prev.x, prev.y, size.width, size.height) : prev));
    }
    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, [size.width, size.height]);

  const handleResizeMouseDown = useCallback(
    (direction: ResizeDirection) => (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      resizeRef.current = {
        resizing: true,
        direction,
        startX: e.clientX,
        startY: e.clientY,
        startW: size.width,
        startH: size.height,
        startPosX: effectivePos.x,
        startPosY: effectivePos.y,
      };
      const prevCursor = document.body.style.cursor;
      document.body.style.cursor = CURSOR_MAP[direction];

      const handleMove = (me: MouseEvent) => {
        const ref = resizeRef.current;
        if (!ref.resizing) return;
        const dx = me.clientX - ref.startX;
        const dy = me.clientY - ref.startY;
        const d = ref.direction;

        // Width
        let newW = ref.startW;
        if (MOVES_LEFT.has(d)) newW = Math.max(minWidth, ref.startW - dx);
        else if (MOVES_RIGHT.has(d)) newW = Math.max(minWidth, ref.startW + dx);

        // Height
        let newH = ref.startH;
        if (MOVES_TOP.has(d)) newH = Math.max(minHeight, ref.startH - dy);
        else if (MOVES_BOTTOM.has(d)) newH = Math.max(minHeight, ref.startH + dy);

        // Cap to viewport
        newW = Math.min(newW, window.innerWidth);
        newH = Math.min(newH, window.innerHeight);

        // Position shifts for left/top directions
        let newX = ref.startPosX;
        let newY = ref.startPosY;
        if (MOVES_LEFT.has(d)) newX = ref.startPosX + (ref.startW - newW);
        if (MOVES_TOP.has(d)) newY = ref.startPosY + (ref.startH - newH);

        setSize({ width: newW, height: newH });
        setPosition(clampPosition(newX, newY, newW, newH));
        onResizeMove?.();
      };

      const handleUp = () => {
        resizeRef.current.resizing = false;
        document.body.style.cursor = prevCursor;
        window.removeEventListener('mousemove', handleMove);
        window.removeEventListener('mouseup', handleUp);
        onResizeEnd?.();
      };

      window.addEventListener('mousemove', handleMove);
      window.addEventListener('mouseup', handleUp);
    },
    [size, effectivePos, minWidth, minHeight, onResizeMove, onResizeEnd],
  );

  return { size, setSize, position, setPosition, effectivePos, handleResizeMouseDown };
}
