/**
 * The one piece of future the Timeline draws: when a human gate (or an
 * ambiguous route) is waiting, its possible outcomes fan out after "now" —
 * Bézier curves from the waiting node to dashed ghost nodes labelled with the
 * target step and the outcome / edge label. Nothing else of the future.
 */
import { cn } from '../../../lib/cn';
import { tintText } from '../../../lib/tints';
import { EXECUTOR_PALETTE } from '../../workflows/executor-palette';
import type { PendingFork } from './buildTimeline';
import { FORK_WIDTH, GEOMETRY } from './layoutTimeline';

const HUE = 'yellow';
const SPREAD = 56;

function optionY(i: number, n: number): number {
  if (n <= 1) return GEOMETRY.spineY;
  const span = Math.min(SPREAD * (n - 1), GEOMETRY.height - 40);
  return GEOMETRY.spineY - span / 2 + (span / (n - 1)) * i;
}

export function TimelineForkCurves({ fork, fromX, nowX }: { fork: PendingFork; fromX: number; nowX: number }) {
  const endX = nowX + 60;
  return (
    <g aria-hidden>
      <line x1={fromX} y1={GEOMETRY.spineY} x2={nowX} y2={GEOMETRY.spineY} stroke={`var(--tint-${HUE}-solid)`} strokeWidth={4} strokeLinecap="round" />
      {fork.options.map((_, i) => {
        const y = optionY(i, fork.options.length);
        return (
          <path
            key={i}
            d={`M ${nowX} ${GEOMETRY.spineY} C ${nowX + 30} ${GEOMETRY.spineY}, ${endX - 30} ${y}, ${endX} ${y}`}
            fill="none"
            stroke={`var(--tint-${HUE}-solid)`}
            strokeOpacity={0.75}
            strokeWidth={3}
            strokeLinecap="round"
          />
        );
      })}
    </g>
  );
}

export function TimelineForkOptions({ fork, nowX }: { fork: PendingFork; nowX: number }) {
  const x = nowX + 60;
  return (
    <>
      {fork.options.map((o, i) => {
        const y = optionY(i, fork.options.length);
        const entry = o.executor ? EXECUTOR_PALETTE.find((e) => e.type === o.executor) : null;
        const Icon = entry?.Icon;
        return (
          <div
            key={`${o.label}-${i}`}
            className="pointer-events-none absolute flex items-center gap-2 whitespace-nowrap"
            style={{ left: x, top: y - 13, maxWidth: FORK_WIDTH - 70 }}
          >
            <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border-2 border-dashed border-[var(--theme-text-muted)] bg-[var(--theme-bg-surface)] text-[var(--theme-text-muted)]">
              {o.done || !Icon ? <span className="text-[12px]">✓</span> : <Icon className="h-3.5 w-3.5" />}
            </span>
            <span className={cn('text-[12px] font-semibold', tintText(HUE))}>{o.label}</span>
            {o.hint && <span className="truncate text-[11px] text-[var(--theme-text-muted)]">{o.hint}</span>}
          </div>
        );
      })}
    </>
  );
}
