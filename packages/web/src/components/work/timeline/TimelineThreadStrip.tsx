/**
 * The threads under the frieze, drawn as branches of the lifeline (as on a git
 * graph): each one leaves the spine where the assistant opened it, runs in its
 * lane and joins the spine again where it was concluded.
 *
 * What stands on a branch:
 * - the frieze's own pictos, moved there — the turns (comments: the human's are
 *   the yellow ones), the runs they launched, the deliverables those produced.
 *   Same glyphs, same tooltips, same clicks as on the frieze;
 * - what only a thread has, with its own marks: a run stopped on purpose (⏸,
 *   yellow when the human did it), and where the thread stands — running (a
 *   pulsing head at "now"), waiting for the human (« ? »), in the assistant's
 *   hands (hollow head), failed (✕, no way back to the spine), concluded (a
 *   ring on the spine, yellow when the human concluded it).
 *
 * Two layers, like the todo strip: the curves go UNDER the frieze (so they
 * never cross a picto or its label), the labels and pictos over it.
 * Pure rendering: placement comes from layoutThreadStrip, clicks go up.
 */
import { memo } from 'react';
import { cn } from '../../../lib/cn';
import { tintText } from '../../../lib/tints';
import { Tooltip } from '../../ui/Tooltip';
import type { TimelineAction, TimelineEvent } from './buildTimeline';
import type { PlacedEvent } from './layoutTimeline';
import { LanePicto } from './TimelineNode';
import { GlyphIcon, glyphHue } from './TimelineGlyph';
import { TimelineTooltip } from './TimelineTooltip';
import { ELBOW, RAIL_OFFSET, THREAD_LANE, THREAD_PAD, branchCaption, type PlacedBranch, type ThreadStrip } from './threadBranches';

export function threadNodeId(branch: PlacedBranch): string {
  return `thread:${branch.id}`;
}

const railY = (top: number, lane: number) => top + THREAD_PAD + lane * THREAD_LANE + RAIL_OFFSET;
const solid = (hue: string) => `var(--tint-${hue}-solid)`;

/** Sizes of the pictos standing on a rail. */
const RUN = 24;
const PICTO = 20;
const MARK = 16;

const STATE_LABEL: Record<PlacedBranch['status'], string> = {
  running: 'en cours',
  idle: 'ouvert',
  waiting: 'attend ta réponse',
  concluded: 'conclu',
  failed: 'en échec',
};

function branchLabel(b: PlacedBranch): string {
  return [`Thread avec ${b.label}`, branchCaption({ turns: b.turns, status: 'concluded' }), STATE_LABEL[b.status]].filter(Boolean).join(', ');
}

/** The branches' lines, from the lifeline down to their lane and back. Rendered before the frieze. */
export function ThreadBranchCurves({ strip, top, lifelineY, width }: {
  strip: ThreadStrip;
  /** Content y of the strip's top (under the frieze). */
  top: number;
  lifelineY: number;
  width: number;
}) {
  if (strip.height === 0) return null;
  return (
    <svg className="pointer-events-none absolute left-0 top-0" width={width} height={top + strip.height} aria-hidden>
      {strip.branches.map((b) => {
        const y = railY(top, b.lane);
        const stroke = solid(b.hue);
        const joins = b.status === 'concluded';
        // Solid while work happens on it; dashed where it only waits (idle / waiting, after the last picto).
        const resting = b.status === 'idle' || b.status === 'waiting';
        const solidEnd = joins ? b.x1 - ELBOW : resting ? Math.min(Math.max(b.lastX, b.x0 + ELBOW), b.x1) : b.x1;
        return (
          <g key={b.id} data-testid="thread-branch" data-status={b.status}>
            {/* Down from the lifeline: thin across the frieze, so the labels it passes stay readable. */}
            <line x1={b.x0} y1={lifelineY} x2={b.x0} y2={y - ELBOW} stroke={stroke} strokeWidth={1.5} strokeOpacity={0.55} />
            <path
              d={`M${b.x0} ${y - ELBOW} Q${b.x0} ${y} ${b.x0 + ELBOW} ${y} L${solidEnd} ${y}`}
              fill="none" stroke={stroke} strokeWidth={2.5} strokeLinecap="round"
            />
            {resting && solidEnd < b.x1 && (
              <line x1={solidEnd} y1={y} x2={b.x1} y2={y} stroke={stroke} strokeWidth={2} strokeDasharray="1 5" strokeLinecap="round" strokeOpacity={0.8} />
            )}
            {joins && (
              <>
                <path
                  data-testid="thread-merge"
                  d={`M${b.x1 - ELBOW} ${y} Q${b.x1} ${y} ${b.x1} ${y - ELBOW}`}
                  fill="none" stroke={stroke} strokeWidth={2.5} strokeLinecap="round"
                />
                <line x1={b.x1} y1={y - ELBOW} x2={b.x1} y2={lifelineY} stroke={stroke} strokeWidth={1.5} strokeOpacity={0.55} />
                {/* Joining back: a ring on the lifeline — the fork is a full dot. Yellow when the human concluded. */}
                <circle
                  cx={b.x1} cy={lifelineY} r={4.5} fill="var(--theme-bg-surface)" strokeWidth={2}
                  stroke={b.concludedBy === 'user' ? solid('yellow') : stroke}
                />
              </>
            )}
            <circle cx={b.x0} cy={lifelineY} r={4.5} fill={stroke} stroke="var(--theme-bg-surface)" strokeWidth={1.5} />
          </g>
        );
      })}
    </svg>
  );
}

interface Props {
  strip: ThreadStrip;
  top: number;
  /** The thread shown in the Threads panel, if any: its label is marked. */
  selectedId: string | null;
  onOpen: (branch: PlacedBranch) => void;
  onAction: (action: TimelineAction, event: TimelineEvent) => void;
}

export function TimelineThreadStrip({ strip, top, selectedId, onOpen, onAction }: Props) {
  if (strip.height === 0) return null;
  return (
    <div className="contents" data-testid="thread-strip">
      {/* Sticky label, as the todo strip's: 0-tall and in flow, it pins to the left edge. */}
      <div className="pointer-events-none sticky left-0 z-[7] h-0 w-max" aria-hidden>
        <span
          className="absolute left-1.5 whitespace-nowrap rounded border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-1.5 text-[9.5px] font-semibold uppercase leading-[14px] tracking-[0.06em] text-[var(--theme-text-muted)]"
          style={{ top: top + THREAD_PAD }}
        >
          Threads
        </span>
      </div>

      {strip.branches.map((b) => {
        const y = railY(top, b.lane);
        const caption = branchCaption(b);
        // A thread's comments are read in the Threads panel, not in the main conversation.
        const act = (action: TimelineAction, event: TimelineEvent) => (action.type === 'comment' ? onOpen(b) : onAction(action, event));
        return (
          <div key={b.id} className="contents">
            <button
              type="button"
              data-timeline-node={threadNodeId(b)}
              data-testid="thread-branch-label"
              aria-label={branchLabel(b)}
              aria-current={b.id === selectedId || undefined}
              title={b.title}
              onClick={() => onOpen(b)}
              className={cn(
                'absolute z-[4] flex items-baseline gap-1.5 truncate rounded px-1 text-left text-[10.5px] leading-[14px] hover:bg-[var(--theme-bg-hover)]',
                b.id === selectedId && 'bg-[var(--theme-bg-hover)]',
              )}
              style={{ left: b.x0 + ELBOW - 2, top: y - RAIL_OFFSET + 1, maxWidth: b.labelWidth }}
            >
              <span className="font-semibold" style={{ color: `var(--tint-${b.hue}-text)` }}>{b.label}</span>
              {caption && <span className="truncate text-[var(--theme-text-muted)]">{caption}</span>}
            </button>
            {b.items.map((it) =>
              it.event.kind === 'run' ? (
                <BranchRun key={it.event.id} item={it} y={y} onAction={act} />
              ) : (
                <LanePicto key={it.event.id} item={it} onAction={act} at={{ y: y - PICTO / 2, size: PICTO }} />
              ),
            )}
            {b.stopX != null && b.stop && <StopMark x={b.stopX} y={y} by={b.stop.by} hue={b.hue} />}
            <BranchEnd branch={b} y={y} />
          </div>
        );
      })}
    </div>
  );
}

/** A run of the thread: the frieze's round node, smaller and without its label (the branch names the target). */
const BranchRun = memo(function BranchRun({ item, y, onAction }: {
  item: PlacedEvent;
  y: number;
  onAction: (action: TimelineAction, event: TimelineEvent) => void;
}) {
  const e = item.event;
  const hue = e.state === 'ko' ? 'red' : glyphHue(e.glyph);
  const live = e.state === 'running' || e.state === 'pending';
  return (
    <Tooltip label={<TimelineTooltip event={e} />} placement="top" interactive>
      <button
        type="button"
        data-timeline-node={e.id}
        data-testid="thread-run"
        aria-label={e.ariaLabel}
        onClick={e.action ? () => onAction(e.action!, e) : undefined}
        className={cn(
          'absolute z-[3] flex items-center justify-center rounded-full border-2 bg-[var(--theme-bg-surface)] outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)]',
          tintText(hue),
          e.state === 'cancelled' && 'opacity-45',
          e.state === 'pending' && 'border-dashed',
          !e.action && 'cursor-default',
        )}
        style={{ left: item.x - RUN / 2, top: y - RUN / 2, width: RUN, height: RUN, borderColor: solid(hue) }}
      >
        {live && (
          <span
            aria-hidden
            className={cn('absolute -inset-1 rounded-full opacity-50 motion-reduce:animate-none', e.state === 'running' ? 'animate-ping' : 'animate-pulse')}
            style={{ backgroundColor: `var(--tint-${hue}-bg)`, boxShadow: `0 0 0 2px var(--tint-${hue}-border)` }}
          />
        )}
        <span className="relative flex items-center justify-center"><GlyphIcon glyph={e.glyph} size={13} /></span>
      </button>
    </Tooltip>
  );
});

/** Thread-only mark: the run was stopped on purpose (⏸). Yellow when the human did it. */
function StopMark({ x, y, by, hue }: { x: number; y: number; by: 'user' | 'assistant'; hue: string }) {
  const c = by === 'user' ? 'yellow' : hue;
  return (
    <span
      data-testid="thread-stop"
      data-by={by}
      title={by === 'user' ? 'Run arrêté par toi' : "Run arrêté par l'assistant"}
      className="absolute z-[3] flex items-center justify-center gap-[2px] rounded-[4px] border bg-[var(--theme-bg-surface)]"
      style={{ left: x - MARK / 2, top: y - MARK / 2, width: MARK, height: MARK, borderColor: solid(c) }}
    >
      <span className="h-[7px] w-[2px] rounded-sm" style={{ background: solid(c) }} />
      <span className="h-[7px] w-[2px] rounded-sm" style={{ background: solid(c) }} />
    </span>
  );
}

/** Thread-only mark: where an unfinished branch stands — a live head at "now", « ? » when it waits for the human, ✕ where it failed. */
function BranchEnd({ branch: b, y }: { branch: PlacedBranch; y: number }) {
  if (b.status === 'concluded') return null;
  if (b.status === 'failed' || b.status === 'waiting') {
    const failed = b.status === 'failed';
    const c = failed ? 'red' : 'yellow';
    return (
      <span
        data-testid="thread-end"
        data-state={b.status}
        title={failed ? 'Le dernier run a échoué' : 'Attend ta réponse'}
        className="absolute z-[3] flex items-center justify-center rounded-full border-2 bg-[var(--theme-bg-surface)] text-[11px] font-bold leading-none"
        style={{ left: b.x1 - MARK / 2, top: y - MARK / 2, width: MARK, height: MARK, color: `var(--tint-${c}-text)`, borderColor: solid(c) }}
      >
        {failed ? '✕' : '?'}
      </span>
    );
  }
  return (
    <span
      data-testid="thread-end"
      data-state={b.status}
      title={b.status === 'running' ? 'En cours' : "L'assistant a la main"}
      className="absolute z-[3]"
      style={{ left: b.x1 - 5, top: y - 5, width: 10, height: 10 }}
    >
      {b.status === 'running' && (
        <span className="absolute inset-0 rounded-full opacity-60 motion-safe:animate-ping" style={{ background: solid(b.hue) }} />
      )}
      <span
        className="absolute inset-0 rounded-full border-2"
        style={{ borderColor: solid(b.hue), background: b.status === 'idle' ? 'var(--theme-bg-surface)' : solid(b.hue) }}
      />
    </span>
  );
}
