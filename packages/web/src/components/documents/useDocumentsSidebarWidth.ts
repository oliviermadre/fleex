import { useCallback, useEffect, useState } from 'react';

/**
 * Width of the Documents filter sidebar, drag-resizable and persisted.
 *
 * The facet labels (workflow and panel names) are long enough that a fixed
 * 220px column truncates most of them, so the width is the reader's call —
 * and it survives reloads like the right sidebar's does.
 */
export const DOCUMENTS_SIDEBAR_MIN_WIDTH = 180;
export const DOCUMENTS_SIDEBAR_MAX_WIDTH = 480;
export const DOCUMENTS_SIDEBAR_DEFAULT_WIDTH = 220;

const STORAGE_KEY = 'fleex_documents_sidebar_width';

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return DOCUMENTS_SIDEBAR_DEFAULT_WIDTH;
  return Math.min(DOCUMENTS_SIDEBAR_MAX_WIDTH, Math.max(DOCUMENTS_SIDEBAR_MIN_WIDTH, Math.round(width)));
}

function loadWidth(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? clampSidebarWidth(Number(raw)) : DOCUMENTS_SIDEBAR_DEFAULT_WIDTH;
  } catch {
    return DOCUMENTS_SIDEBAR_DEFAULT_WIDTH;
  }
}

export function useDocumentsSidebarWidth() {
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

    const onMove = (ev: MouseEvent) => setWidth(clampSidebarWidth(startWidth + ev.clientX - startX));
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
  const nudge = useCallback((delta: number) => setWidth((w) => clampSidebarWidth(w + delta)), []);

  return { width, resizing, startResize, nudge };
}
