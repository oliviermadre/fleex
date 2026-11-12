/**
 * The threads under the frieze, drawn as branches of the lifeline (as on a git
 * graph): each one leaves the spine where the assistant opened it, runs in its
 * lane with a mark per exchange — a diamond when the assistant speaks, a dot
 * when the target answers, a yellow dot when the human steps in — and joins
 * the spine again where it was concluded. A thread still open runs to "now"
 * (dashed once the target has answered and nothing runs); a failed one stops
 * on a cross, without joining back.
 *
 * Two layers, like the todo strip: the curves go UNDER the frieze (so they
 * never cross a picto or its label), the labels and marks over it.
 * Pure rendering: placement comes from layoutThreadStrip, clicks go up.
 */
import { cn } from '../../../lib/cn';
import {
  ELBOW,
  RAIL_OFFSET,
  THREAD_LANE,
  THREAD_PAD,
  branchCaption,
  type PlacedBranch,
  type PlacedTurn,
  type ThreadStrip,
  type ThreadTurnBy,
} from './threadBranches';

export function threadNodeId(branch: PlacedBranch): string {
  return `thread:${branch.id}`;
}

const railY = (top: number, lane: number) => top + THREAD_PAD + lane * THREAD_LANE + RAIL_OFFSET;
const solid = (hue: string) => `var(--tint-${hue}-solid)`;

const pad = (n: number) => String(n).padStart(2, '0');
const hm = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const STATE_LABEL: Record<PlacedBranch['status'], string> = {
  running: 'en cours',
  idle: 'ouvert',
  waiting: 'attend ta réponse',
  concluded: 'conclu',
  failed: 'en échec',
};

function branchLabel(b: PlacedBranch): string {
  return [`Thread avec ${b.label}`, branchCaption({ turns: b.turns, status: 'idle' }), STATE_LABEL[b.status]].filter(Boolean).join(', ');
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
        // Solid while work happens on it; dashed where it only waits (idle / waiting, after the last exchange).
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
                {/* Joining back: a ring on the lifeline — the fork is a full dot. */}
                <circle cx={b.x1} cy={lifelineY} r={4.5} fill="var(--theme-bg-surface)" stroke={stroke} strokeWidth={2} />
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
}

export function TimelineThreadStrip({ strip, top, selectedId, onOpen }: Props) {
  if (strip.height === 0) return null;
  return (
    <div className="contents" data-testid="thread-strip">
      {/* Sticky label, as the todo strip's: 0-tall and in flow, it pins to the left edge. */}
      <div className="pointer-events-none sticky left-0 z-[7] h-0 w-max" aria-hidden>
        <span
          className="absolute left-1.5 whitespace-nowrap rounded border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-1.5 text-[9.5px] font-semibold uppercase leading-[14px] tracking-[0.06em] text-[var(--theme-text-muted)]"
          style={{ top: top + THREAD_PAD + RAIL_OFFSET - 8 }}
        >
          Threads
        </span>
      </div>

      {strip.branches.map((b) => {
        const y = railY(top, b.lane);
        const caption = branchCaption(b);
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
              style={{ left: b.x0 + ELBOW - 2, top: y - RAIL_OFFSET + 2, maxWidth: b.labelWidth }}
            >
              <span className="font-semibold" style={{ color: `var(--tint-${b.hue}-text)` }}>{b.label}</span>
              {caption && <span className="truncate text-[var(--theme-text-muted)]">{caption}</span>}
            </button>
            {b.turns.map((t) => <TurnMark key={t.id} turn={t} y={y} hue={b.hue} />)}
            <BranchEnd branch={b} y={y} />
          </div>
        );
      })}
    </div>
  );
}

const TURN_WORD: Record<ThreadTurnBy, string> = { assistant: 'Assistant', target: 'Réponse', user: 'Toi' };

/** One exchange on the rail: ◆ the assistant speaks, ● the target answers, a yellow ● the human steps in. */
function TurnMark({ turn, y, hue }: { turn: PlacedTurn; y: number; hue: string }) {
  const title = `${hm(turn.at)} · ${turn.author || TURN_WORD[turn.by]}`;
  if (turn.by === 'assistant') {
    return (
      <span
        data-testid="thread-turn"
        data-by="assistant"
        title={title}
        className="absolute z-[3] rotate-45 border-[1.5px] bg-[var(--theme-bg-surface)]"
        style={{ left: turn.x - 3.5, top: y - 3.5, width: 7, height: 7, borderColor: solid(hue) }}
      />
    );
  }
  return (
    <span
      data-testid="thread-turn"
      data-by={turn.by}
      title={title}
      className="absolute z-[3] rounded-full border-[1.5px] border-[var(--theme-bg-surface)]"
      style={{ left: turn.x - 4.5, top: y - 4.5, width: 9, height: 9, background: solid(turn.by === 'user' ? 'yellow' : hue) }}
    />
  );
}

/** Where an unfinished branch stops: a live head at "now", or a cross where it failed. */
function BranchEnd({ branch: b, y }: { branch: PlacedBranch; y: number }) {
  if (b.status === 'concluded') return null;
  if (b.status === 'failed') {
    return (
      <span
        data-testid="thread-end"
        title="Le dernier run a échoué"
        className="absolute z-[3] flex items-center justify-center rounded-full bg-[var(--theme-bg-surface)] text-[11px] font-bold leading-none"
        style={{ left: b.x1 - 6, top: y - 6, width: 12, height: 12, color: 'var(--tint-red-solid)' }}
      >
        ×
      </span>
    );
  }
  const hue = b.status === 'waiting' ? 'yellow' : b.hue;
  return (
    <span
      data-testid="thread-end"
      className="absolute z-[3]"
      style={{ left: b.x1 - 5, top: y - 5, width: 10, height: 10 }}
    >
      {b.status === 'running' && (
        <span className="absolute inset-0 rounded-full opacity-60 motion-safe:animate-ping" style={{ background: solid(hue) }} />
      )}
      <span
        className="absolute inset-0 rounded-full border-2"
        style={{ borderColor: solid(hue), background: b.status === 'idle' ? 'var(--theme-bg-surface)' : solid(hue) }}
      />
    </span>
  );
}
