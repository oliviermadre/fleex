import { useCallback, useEffect, useState } from 'react';

/**
 * Width of the Code editor's file tree rail, drag-resizable and persisted.
 * Deep paths truncate quickly in a fixed column, so the width is the reader's
 * call — shared across tickets and kept across reloads.
 */
export const CODE_TREE_MIN_WIDTH = 180;
export const CODE_TREE_MAX_WIDTH = 600;
export const CODE_TREE_DEFAULT_WIDTH = 260;

const STORAGE_KEY = 'fleex_code_tree_width';

export function clampCodeTreeWidth(width: number): number {
  if (!Number.isFinite(width)) return CODE_TREE_DEFAULT_WIDTH;
  return Math.min(CODE_TREE_MAX_WIDTH, Math.max(CODE_TREE_MIN_WIDTH, Math.round(width)));
}

function loadWidth(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? clampCodeTreeWidth(Number(raw)) : CODE_TREE_DEFAULT_WIDTH;
  } catch {
    return CODE_TREE_DEFAULT_WIDTH;
  }
}

export function useCodeTreeWidth() {
  const [width, setWidth] = useState<number>(loadWidth);
  const [resizing, setResizing] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(width));
    } catch {
      // Private mode / quota — the width simply won't persist.
    }
  }, [width]);

  const startResize = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    setResizing(true);
    const startX = event.clientX;
    const startWidth = width;
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => setWidth(clampCodeTreeWidth(startWidth + ev.clientX - startX));
    const onUp = () => {
      setResizing(false);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [width]);

  /** Keyboard resize — the handle is a focusable separator. */
  const nudge = useCallback((delta: number) => setWidth((w) => clampCodeTreeWidth(w + delta)), []);

  return { width, resizing, startResize, nudge };
}
