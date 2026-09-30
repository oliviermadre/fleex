/**
 * Small activity glyphs shared by the execution log rows and the ticket
 * Timeline: a speech bubble (comment) and a ruled page (deliverable). Filled /
 * stroked with `currentColor`, so the caller tints them.
 */

export function CommentIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M2 3.5A1.5 1.5 0 013.5 2h9A1.5 1.5 0 0114 3.5v7a1.5 1.5 0 01-1.5 1.5H5l-3 2.5V3.5z" />
    </svg>
  );
}

export function DeliverableIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="3" y="1.5" width="10" height="13" rx="1.5" />
      <path d="M5.5 5h5M5.5 8h5M5.5 11h3" />
    </svg>
  );
}
