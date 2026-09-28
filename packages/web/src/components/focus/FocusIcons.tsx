import type { FocusItemKind } from '@fleex/shared';

const PATHS: Record<FocusItemKind, React.ReactNode> = {
  gate: (
    <>
      <path d="M4 21V4h16v17" />
      <path d="M9 21v-6h6v6" />
    </>
  ),
  question: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  error: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v6M12 16.5v.5" />
    </>
  ),
  idle: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
};

/** Glyph of a Focus item kind: gate (door), question (bubble), error (!), idle (clock). */
export function KindIcon({ kind, size = 12 }: { kind: FocusItemKind; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {PATHS[kind]}
    </svg>
  );
}
