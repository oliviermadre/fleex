import type { StatusColor } from '@fleex/shared';
import { findStatusColumn } from '@fleex/shared';

export type StatusColorToken = {
  text: string;
  bg: string;
  bar: string;
  hoverBg: string;
  hoverText: string;
};

/**
 * Palette keyed by semantic color name (StatusColumn.color). The status→color
 * mapping lives in the active status model, so columns can be recoloured
 * dynamically; this table only turns a color name into theme tokens.
 */
export const PALETTE: Record<StatusColor, StatusColorToken> = {
  gray:   { text: 'text-[var(--theme-text-muted)]', bg: 'bg-[var(--theme-bg-overlay)]', bar: 'bg-[var(--theme-text-muted)]', hoverBg: 'hover:bg-[var(--theme-bg-hover)]', hoverText: 'group-hover:text-gray-300' },
  orange: { text: 'text-orange-400', bg: 'bg-orange-400/15', bar: 'bg-orange-400', hoverBg: 'hover:bg-orange-400/15', hoverText: 'group-hover:text-orange-400' },
  blue:   { text: 'text-blue-400',   bg: 'bg-blue-400/15',   bar: 'bg-blue-400',   hoverBg: 'hover:bg-blue-400/15',   hoverText: 'group-hover:text-blue-400' },
  purple: { text: 'text-purple-400', bg: 'bg-purple-400/15', bar: 'bg-purple-400', hoverBg: 'hover:bg-purple-400/15', hoverText: 'group-hover:text-purple-400' },
  green:  { text: 'text-green-400',  bg: 'bg-green-400/15',  bar: 'bg-green-400',  hoverBg: 'hover:bg-green-400/15',  hoverText: 'group-hover:text-green-400' },
  red:    { text: 'text-red-400/70', bg: 'bg-red-400/10',    bar: 'bg-red-400/70', hoverBg: 'hover:bg-red-400/10',    hoverText: 'group-hover:text-red-400/70' },
  teal:   { text: 'text-teal-400',   bg: 'bg-teal-400/15',   bar: 'bg-teal-400',   hoverBg: 'hover:bg-teal-400/15',   hoverText: 'group-hover:text-teal-400' },
  pink:   { text: 'text-pink-400',   bg: 'bg-pink-400/15',   bar: 'bg-pink-400',   hoverBg: 'hover:bg-pink-400/15',   hoverText: 'group-hover:text-pink-400' },
  yellow: { text: 'text-yellow-400', bg: 'bg-yellow-400/15', bar: 'bg-yellow-400', hoverBg: 'hover:bg-yellow-400/15', hoverText: 'group-hover:text-yellow-400' },
};

const FALLBACK = PALETTE.gray;

/** Resolve a status key to its color tokens via the active model's column color. */
export function statusColorToken(status: string): StatusColorToken {
  const color = findStatusColumn(status)?.color;
  return (color && PALETTE[color]) || FALLBACK;
}

/** Combined "text bg" class string for badge usage. */
export function getStatusBadgeClass(status: string): string {
  const token = statusColorToken(status);
  return `${token.text} ${token.bg}`;
}

/** Title/text color class for a status (column headers, labels). */
export function statusTitleClass(status: string): string {
  return statusColorToken(status).text;
}
