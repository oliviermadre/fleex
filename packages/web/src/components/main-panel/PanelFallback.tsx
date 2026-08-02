/**
 * Suspense fallback for lazy main-panel views.
 *
 * Deliberately empty: no spinner, no text. The surface keeps its background
 * colour and its box, so swapping in the real panel causes no reflow and no
 * flash. Panel chunks are small and usually cache hits — a spinner would be
 * visible for less time than it takes to read it.
 */
export function PanelFallback() {
  return <div className="flex flex-1 bg-[var(--theme-bg-primary)]" />;
}
