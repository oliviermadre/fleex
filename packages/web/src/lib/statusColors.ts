export type StatusColorToken = {
  text: string;
  bg: string;
  bar: string;
  hoverBg: string;
  hoverText: string;
};

export const STATUS_COLORS: Record<string, StatusColorToken> = {
  backlog:   { text: 'text-[var(--theme-text-muted)]', bg: 'bg-[var(--theme-bg-overlay)]',  bar: 'bg-[var(--theme-text-muted)]', hoverBg: 'hover:bg-[var(--theme-bg-hover)]',   hoverText: 'group-hover:text-gray-300' },
  todo:      { text: 'text-orange-400',                bg: 'bg-orange-400/15',               bar: 'bg-orange-400',                hoverBg: 'hover:bg-orange-400/15',              hoverText: 'group-hover:text-orange-400' },
  doing:     { text: 'text-blue-400',                  bg: 'bg-blue-400/15',                 bar: 'bg-blue-400',                  hoverBg: 'hover:bg-blue-400/15',                hoverText: 'group-hover:text-blue-400' },
  reviewing: { text: 'text-purple-400',                bg: 'bg-purple-400/15',               bar: 'bg-purple-400',                hoverBg: 'hover:bg-purple-400/15',              hoverText: 'group-hover:text-purple-400' },
  done:      { text: 'text-green-400',                 bg: 'bg-green-400/15',                bar: 'bg-green-400',                 hoverBg: 'hover:bg-green-400/15',               hoverText: 'group-hover:text-green-400' },
  cancelled: { text: 'text-red-400/70',                bg: 'bg-red-400/10',                  bar: 'bg-red-400/70',                hoverBg: 'hover:bg-red-400/10',                 hoverText: 'group-hover:text-red-400/70' },
};

/** Returns combined "text bg" class string for badge usage. Empty string for unknown status. */
export function getStatusBadgeClass(status: string): string {
  const token = STATUS_COLORS[status];
  if (!token) return '';
  return `${token.text} ${token.bg}`;
}
