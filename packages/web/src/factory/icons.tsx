import type { ReactNode } from 'react';

/** Line icons of the Factory console, 24×24, drawn with the current colour. */
const PATHS: Record<string, ReactNode> = {
  belt: <path d="M4 8l4 4-4 4M10.5 8l4 4-4 4M17 8l3.5 4-3.5 4" />,
  bridge: <path d="M3 9h18M3 15h18M9 3v4M15 3v4M9 17v4M15 17v4" />,
  arm: <><circle cx="7" cy="17" r="3" /><path d="M9.2 14.8L16 8" /><path d="M13.5 6.5H18V11" /></>,
  agent: <><rect x="5" y="8" width="14" height="10" rx="2.5" /><path d="M12 4v4M9.5 13h.01M14.5 13h.01" /></>,
  skill: <path d="M13 3L5 14h6l-1 7 8-11h-6z" />,
  panel: <><circle cx="12" cy="8" r="2.6" /><circle cx="5.5" cy="11" r="2" /><circle cx="18.5" cy="11" r="2" /><path d="M7.5 20c0-3.2 2-5.4 4.5-5.4s4.5 2.2 4.5 5.4M2.5 19c0-2.4 1.3-4 3-4M21.5 19c0-2.4-1.3-4-3-4" /></>,
  gate: <><path d="M12 3l8 3.5V12c0 4.7-3.3 7.8-8 9-4.7-1.2-8-4.3-8-9V6.5z" /><path d="M8.7 12l2.3 2.3 4.3-4.6" /></>,
  native: <><path d="M4 12V5h7l9 9-7 7z" /><circle cx="8.5" cy="9.5" r="1.1" /></>,
  zone: <><path d="M4 8l8-4 8 4v8l-8 4-8-4z" /><path d="M4 8l8 4 8-4M12 12v8" /></>,
  exit: <><path d="M4 12h11M11 7l5 5-5 5" /><path d="M20 4v16" /></>,
  label: <path d="M5 6h14M12 6v13" />,
  erase: <><path d="M4 16l9-9 6 6-7 7H8z" /><path d="M9.5 10.5l6 6" /></>,
  rotate: <><path d="M20 12a8 8 0 1 1-3-6.2" /><path d="M20 4v5h-5" /></>,
  back: <path d="M15 6l-6 6 6 6" />,
  build: <path d="M4 20h16M7 20V9l6-5v16M13 8h6v4" />,
  fit: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  open: <><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M4 9.5h16" /></>,
  trash: <path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13" />,
  play: <path d="M7 5l12 7-12 7z" />,
  check: <path d="M5 12l5 5 9-10" />,
  loop: <><path d="M4 12a8 8 0 1 0 3-6.2" /><path d="M4 4v5h5" /></>,
  give: <><path d="M20 12H8M12 7l-5 5 5 5" /><path d="M4 4v16" /></>,
  inbound: <><path d="M12 3v11M7 10l5 5 5-5" /><path d="M4 20h16" /></>,
  ticket: <rect x="5" y="5" width="14" height="14" rx="3.5" />,
  undo: <><path d="M9 14L4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></>,
  redo: <><path d="M15 14l5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
  cut: <><circle cx="6" cy="6.5" r="2.5" /><circle cx="6" cy="17.5" r="2.5" /><path d="M8.2 8l11.8 9M8.2 16L20 7" /></>,
  paste: <><rect x="5" y="5" width="14" height="16" rx="2" /><path d="M9 5V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1M9 11h6M9 15h4" /></>,
  star: <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />,
  coin: <><circle cx="12" cy="12" r="8" /><path d="M14.6 9.3c-.5-.8-1.4-1.3-2.6-1.3-1.6 0-2.7.8-2.7 2s1 1.7 2.7 2 2.8.8 2.8 2.1-1.2 2-2.8 2c-1.3 0-2.3-.5-2.8-1.4M12 6.3V8M12 16.1v1.6" /></>,
  clock: <><circle cx="12" cy="12" r="8" /><path d="M12 7.5V12l3 2" /></>,
  person: <><circle cx="12" cy="8" r="3.2" /><path d="M5.5 20c0-3.8 2.8-6.3 6.5-6.3s6.5 2.5 6.5 6.3" /></>,
  stack: <><rect x="4" y="13" width="6" height="6" rx="1.5" /><rect x="14" y="13" width="6" height="6" rx="1.5" /><rect x="9" y="5" width="6" height="6" rx="1.5" /></>,
  floor: <path d="M3 20V10l5 3.2V10l5 3.2V6h6v14zM3 20h18" />,
};
export type FactoryIconName = keyof typeof PATHS;

export function FIcon({ name, size = 18, className }: { name: string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {PATHS[name] ?? null}
    </svg>
  );
}
