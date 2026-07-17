import type { TicketStatus } from '@fleex/shared';
import { TICKET_STATUSES, TICKET_STATUS_LABELS } from '@fleex/shared';
import { cn } from '../../lib/cn';
import { STATUS_COLORS } from '../../lib/statusColors';
import { tintSolid } from '../../lib/tints';

const ABBREVS: Record<string, string> = {
  backlog: 'BKLG',
  todo: 'TODO',
  doing: 'DOIN',
  reviewing: 'REVW',
  done: 'DONE',
  cancelled: 'CNCL',
};

/**
 * Inline kanban status picker. `size="sm"` scales down for tight header areas.
 * It renders at its NATURAL height so each column's colored band sits flush at
 * the top; callers give it a width by wrapping it (e.g. `w-[100px]` /
 * `w-[250px]`), never a height — forcing a tall box would center the columns and
 * leave a gap above the band.
 */
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
        const colors = STATUS_COLORS[s] ?? STATUS_COLORS.backlog!;
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
                    active ? colors.text : cn('text-[var(--theme-text-muted)]', colors.hoverText),
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
  todo: tintSolid('orange'),
  doing: tintSolid('blue'),
  reviewing: tintSolid('purple'),
  done: tintSolid('green'),
  cancelled: tintSolid('red'),
};
