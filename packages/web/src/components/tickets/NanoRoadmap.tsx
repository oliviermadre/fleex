import type { TicketGroupStatus, TicketGroupTimeframe } from '@fleex/shared';
import { cn } from '../../lib/cn';
import { tintClasses } from '../../lib/tints';

/**
 * The 5 visual columns of the roadmap, each mapping to a combination of
 * groupStatus + timeframe.
 */
type RoadmapColumn = 'now' | 'next' | 'later' | 'done' | 'cancelled';

const COLUMNS: RoadmapColumn[] = ['now', 'next', 'later', 'done', 'cancelled'];

const LABELS: Record<RoadmapColumn, string> = {
  now: 'Now',
  next: 'Next',
  later: 'Later',
  done: 'Done',
  cancelled: 'Cancelled',
};

const ABBREVS: Record<RoadmapColumn, string> = {
  now: 'NOW',
  next: 'NEXT',
  later: 'LATR',
  done: 'DONE',
  cancelled: 'CNCL',
};

const COLORS: Record<RoadmapColumn, { text: string; bg: string; bar: string; hoverBg: string; hoverText: string }> = {
  now:       { text: tintClasses('green').text,  bg: tintClasses('green').bg,  bar: tintClasses('green').solid,  hoverBg: tintClasses('green').hoverBg,  hoverText: tintClasses('green').groupHoverText },
  next:      { text: tintClasses('orange').text, bg: tintClasses('orange').bg, bar: tintClasses('orange').solid, hoverBg: tintClasses('orange').hoverBg, hoverText: tintClasses('orange').groupHoverText },
  later:     { text: 'text-[var(--theme-text-muted)]', bg: 'bg-[var(--theme-bg-overlay)]', bar: 'bg-[var(--theme-text-muted)]', hoverBg: 'hover:bg-[var(--theme-bg-hover)]', hoverText: 'group-hover:text-[var(--theme-text-secondary)]' },
  done:      { text: tintClasses('blue').text,   bg: tintClasses('blue').bg,   bar: tintClasses('blue').solid,   hoverBg: tintClasses('blue').hoverBg,   hoverText: tintClasses('blue').groupHoverText },
  cancelled: { text: tintClasses('red').text,    bg: tintClasses('red').bg,    bar: tintClasses('red').solid,    hoverBg: tintClasses('red').hoverBg,    hoverText: tintClasses('red').groupHoverText },
};

function toColumn(groupStatus: TicketGroupStatus, timeframe: TicketGroupTimeframe): RoadmapColumn {
  if (groupStatus === 'done') return 'done';
  if (groupStatus === 'cancelled') return 'cancelled';
  return timeframe; // 'now' | 'next' | 'later'
}

/** Inline roadmap status picker for epics, following the NanoKanban style. */
export function NanoRoadmap({ groupStatus, timeframe, onChange, size = 'md' }: {
  groupStatus: TicketGroupStatus;
  timeframe: TicketGroupTimeframe;
  onChange: (groupStatus: TicketGroupStatus, timeframe: TicketGroupTimeframe) => void;
  size?: 'sm' | 'md';
}) {
  const current = toColumn(groupStatus, timeframe);
  const sm = size === 'sm';

  const handleClick = (col: RoadmapColumn) => {
    if (col === 'done') {
      onChange('done', timeframe);
    } else if (col === 'cancelled') {
      onChange('cancelled', timeframe);
    } else {
      onChange('active', col as TicketGroupTimeframe);
    }
  };

  return (
    <div className="flex overflow-hidden rounded-md border border-[var(--theme-border)]">
      {COLUMNS.map((col) => {
        const active = current === col;
        const colors = COLORS[col];
        return (
          <button
            key={col}
            title={LABELS[col]}
            className={cn(
              'group relative flex flex-1 flex-col items-center pt-0 transition-colors',
              sm ? 'gap-px pb-0.5' : 'gap-1 pb-1.5',
              active ? colors.bg : colors.hoverBg,
            )}
            onClick={(e) => { e.stopPropagation(); handleClick(col); }}
          >
            <div
              className={cn(
                'w-full transition-all',
                active ? cn(sm ? 'h-[2px]' : 'h-[3px]', colors.bar) : cn(sm ? 'h-[1px]' : 'h-[2px]', 'opacity-60', colors.bar),
              )}
            />
            <div className="flex flex-col items-center gap-px">
              {ABBREVS[col].split('').map((ch, i) => (
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
