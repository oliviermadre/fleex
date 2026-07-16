import { TINT_CLASSES, type TintHue } from './tints';

export type StatusColorToken = {
  text: string;
  bg: string;
  bar: string;
  hoverBg: string;
  hoverText: string;
  border: string;
};

/** Ticket status → tint hue. Colors themselves live in lib/tints.ts. */
export const STATUS_HUES: Record<string, TintHue> = {
  backlog: 'gray',
  todo: 'orange',
  doing: 'blue',
  reviewing: 'purple',
  done: 'green',
  cancelled: 'red',
};

function tokenFor(hue: TintHue): StatusColorToken {
  const c = TINT_CLASSES[hue];
  return {
    text: c.text,
    bg: c.bg,
    bar: c.solid,
    hoverBg: c.hoverBg,
    hoverText: c.groupHoverText,
    border: c.borderColor,
  };
}

export const STATUS_COLORS: Record<string, StatusColorToken> = Object.fromEntries(
  Object.entries(STATUS_HUES).map(([status, hue]) => [status, tokenFor(hue)]),
);

/**
 * Returns combined "text bg border" class string for badge usage — the border
 * is the outline ("détourage") that keeps the badge legible in every theme.
 * Empty string for unknown status.
 */
export function getStatusBadgeClass(status: string): string {
  const token = STATUS_COLORS[status];
  if (!token) return '';
  return `${token.text} ${token.bg} border ${token.border}`;
}
