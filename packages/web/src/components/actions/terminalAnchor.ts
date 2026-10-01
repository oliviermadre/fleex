/**
 * The action button a terminal panel opens under — like any popover of the top
 * bar. Set on click; the panel falls back to the bottom-right corner when the
 * button is gone (Settings "Try", a ticket header that unmounted…).
 */
let anchor: WeakRef<HTMLElement> | null = null;

export function setTerminalAnchor(el: HTMLElement | null): void {
  anchor = el ? new WeakRef(el) : null;
}

export function terminalAnchorRect(): DOMRect | null {
  const el = anchor?.deref();
  if (!el || !el.isConnected) return null;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? rect : null;
}

/** Bottom of the desktop app's title bar (Electron draws it over the page), or 0 in a browser. */
export function titleBarBottom(): number {
  return document.getElementById('fleex-desktop-titlebar')?.getBoundingClientRect().bottom ?? 0;
}

export const PANEL_WIDTH = 640;
export const PANEL_HEIGHT = 360;
const MARGIN = 8;
/** Below this height left under the button, the panel goes back to the corner. */
const MIN_ANCHORED_HEIGHT = 220;

export type PanelBox = { top: number; left: number; width: number; height: number } | null;

/** Where the panel goes under `rect`, kept inside the viewport; null when it does not fit. */
export function anchoredBox(rect: DOMRect, viewport: { width: number; height: number }): PanelBox {
  const width = Math.min(PANEL_WIDTH, viewport.width - 2 * MARGIN);
  const top = rect.bottom + MARGIN;
  const height = Math.min(PANEL_HEIGHT, viewport.height - top - MARGIN);
  if (height < MIN_ANCHORED_HEIGHT) return null;
  const centred = rect.left + rect.width / 2 - width / 2;
  const left = Math.max(MARGIN, Math.min(centred, viewport.width - width - MARGIN));
  return { top, left, width, height };
}
