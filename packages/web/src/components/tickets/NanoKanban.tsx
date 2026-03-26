import type { TicketStatus } from '@fleex/shared';
import { TICKET_STATUSES, TICKET_STATUS_LABELS } from '@fleex/shared';
import { cn } from '../../lib/cn';

const COLORS: Record<string, { text: string; bg: string; bar: string; hoverBg: string; hoverText: string }> = {
  backlog:   { text: 'text-[var(--theme-text-muted)]', bg: 'bg-[var(--theme-bg-overlay)]',  bar: 'bg-[var(--theme-text-muted)]', hoverBg: 'hover:bg-[var(--theme-bg-hover)]',   hoverText: 'group-hover:text-gray-300' },
  todo:      { text: 'text-orange-400',                bg: 'bg-orange-400/15',               bar: 'bg-orange-400',                hoverBg: 'hover:bg-orange-400/15',              hoverText: 'group-hover:text-orange-400' },
  doing:     { text: 'text-blue-400',                  bg: 'bg-blue-400/15',                 bar: 'bg-blue-400',                  hoverBg: 'hover:bg-blue-400/15',                hoverText: 'group-hover:text-blue-400' },
  reviewing: { text: 'text-purple-400',                bg: 'bg-purple-400/15',               bar: 'bg-purple-400',                hoverBg: 'hover:bg-purple-400/15',              hoverText: 'group-hover:text-purple-400' },
  done:      { text: 'text-green-400',                 bg: 'bg-green-400/15',                bar: 'bg-green-400',                 hoverBg: 'hover:bg-green-400/15',               hoverText: 'group-hover:text-green-400' },
  cancelled: { text: 'text-red-400/70',                bg: 'bg-red-400/10',                  bar: 'bg-red-400/70',                hoverBg: 'hover:bg-red-400/10',                 hoverText: 'group-hover:text-red-400/70' },
};

const ABBREVS: Record<string, string> = {
  backlog: 'BKLG',
  todo: 'TODO',
  doing: 'DOIN',
  reviewing: 'REVW',
  done: 'DONE',
  cancelled: 'CNCL',
};

/** Inline kanban status picker. `size="sm"` scales down for tight header areas. */
export function NanoKanban({ status, onStatusChange, size = 'md' }: {
  status: TicketStatus;
  onStatusChange: (status: TicketStatus) => void;
  size?: 'sm' | 'md';
}) {
  const sm = size === 'sm';
  return (
    <div className="flex overflow-hidden rounded-md border border-[var(--theme-border)]">
      {(TICKET_STATUSES as readonly TicketStatus[]).map((s) => {
        const active = status === s;
        const colors = COLORS[s] ?? COLORS.backlog!;
        return (
          <button
            key={s}
            title={TICKET_STATUS_LABELS[s]}
            className={cn(
              'group relative flex flex-1 flex-col items-center pt-0 transition-colors',
              sm ? 'gap-px pb-0.5' : 'gap-1 pb-1.5',
              active ? colors.bg : colors.hoverBg,
            )}
            onClick={(e) => { e.stopPropagation(); onStatusChange(s); }}
          >
            <div
              className={cn(
                'w-full transition-all',
                active ? cn(sm ? 'h-[2px]' : 'h-[3px]', colors.bar) : cn(sm ? 'h-[1px]' : 'h-[2px]', 'opacity-60', colors.bar),
              )}
            />
            <div className="flex flex-col items-center gap-px">
              {(ABBREVS[s] ?? s.slice(0, 4).toUpperCase()).split('').map((ch, i) => (
                <span
                  key={i}
                  className={cn(
                    'font-bold leading-none transition-colors',
                    sm ? 'text-[6px]' : 'text-[8px]',
                    active ? colors.text : cn('text-gray-400', colors.hoverText),
                  )}
                >
                  {ch}
                </span>
              ))}
            </div>
          </button>
        );
      })}
    </div>
  );
}

/** Status dot color for use in sidebar/compact views */
export const TICKET_STATUS_DOT_COLOR: Record<string, string> = {
  backlog: 'bg-[var(--theme-text-faint)]',
  todo: 'bg-orange-400',
  doing: 'bg-blue-400',
  reviewing: 'bg-purple-400',
  done: 'bg-green-400',
  cancelled: 'bg-red-400/70',
};
