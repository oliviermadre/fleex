/**
 * The "Todo" strip under the frieze (SPEC todo-timeline §3.1–3.2): a dashed
 * baseline, a dot per event at its exact instant, and the chips — a round pill
 * for a lone event, a counted chip (one segment per kind) for a burst. Hovering
 * a chip draws dotted lines from its marks up to the lifeline; at rest there
 * are none, they would cross the bottom lane's pictos.
 * Pure rendering: placement comes from layoutTodoStrip, clicks / hovers go up.
 */
import type { ComponentType, MouseEvent } from 'react';
import { cn } from '../../../lib/cn';
import { PlusIcon, type IconProps } from '../../ui/icons/AnnotationIcons';
import { CancelIcon, CheckIcon, ReopenIcon } from '../../ui/icons/TodoIcons';
import { CHIP_H, CHIP_TOP, TODO_STRIP, type TodoChip, type TodoStrip } from './layoutTodoStrip';
import { TODO_MARK_HUE, TODO_MARK_KINDS, TODO_MARK_LABEL, type TodoMarkKind } from './todoMarks';

export const TODO_MARK_ICON: Record<TodoMarkKind, ComponentType<IconProps>> = {
  created: PlusIcon,
  done: CheckIcon,
  cancelled: CancelIcon,
  reopened: ReopenIcon,
};

export function todoChipNodeId(chip: TodoChip): string {
  return `todo:${chip.key}`;
}

const pad = (n: number) => String(n).padStart(2, '0');
const hm = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** "5 faits, 1 annulé" */
export function todoChipSummary(chip: TodoChip): string {
  return TODO_MARK_KINDS.filter((k) => chip.counts[k])
    .map((k) => `${chip.counts[k]} ${chip.counts[k]! > 1 ? TODO_MARK_LABEL[k].many : TODO_MARK_LABEL[k].one}`)
    .join(', ');
}

function chipLabel(chip: TodoChip): string {
  const first = chip.marks[0]!.at;
  const last = chip.marks[chip.marks.length - 1]!.at;
  const span = hm(first) === hm(last) ? hm(first) : `de ${hm(first)} à ${hm(last)}`;
  return `Todo, ${span} : ${todoChipSummary(chip)}`;
}

interface Props {
  strip: TodoStrip;
  /** Content y of the strip's top (under the frieze). */
  top: number;
  /** Content y of the lifeline, where hover lines stop. */
  spineY: number;
  /** Baseline span: the frieze's start → now. */
  x0: number;
  x1: number;
  width: number;
  /** The chip whose reader is open (hovered or pinned): its lines are drawn. */
  activeKey: string | null;
  pinnedKey: string | null;
  onOpen: (chip: TodoChip, el: HTMLElement) => void;
  onHover?: (chip: TodoChip, el: HTMLElement | null) => void;
}

export function TimelineTodoStrip({ strip, top, spineY, x0, x1, width, activeKey, pinnedKey, onOpen, onHover }: Props) {
  if (strip.height === 0) return null;
  const baseY = top + CHIP_TOP + CHIP_H / 2;
  const active = strip.chips.find((c) => c.key === activeKey) ?? null;
  return (
    <div className="contents" data-testid="todo-strip">
      <svg className="pointer-events-none absolute left-0 top-0" width={width} height={top + TODO_STRIP} aria-hidden>
        <line x1={x0} y1={baseY} x2={x1} y2={baseY} stroke="var(--theme-border-input)" strokeOpacity={0.6} strokeDasharray="2 3" />
        {strip.chips.flatMap((c) =>
          c.marks.map((m) => <circle key={m.id} cx={m.x} cy={baseY} r={2} fill={`var(--tint-${TODO_MARK_HUE[m.kind]}-solid)`} />),
        )}
        {active && <HoverLines chip={active} baseY={baseY} spineY={spineY} />}
      </svg>

      {/* Sticky label, as the annotation band's: 0-tall and in flow, it pins to the left edge. */}
      <div className="pointer-events-none sticky left-0 z-[7] h-0 w-max" aria-hidden>
        <span
          data-testid="todo-strip-label"
          className="absolute left-1.5 whitespace-nowrap rounded border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-1.5 text-[9.5px] font-semibold uppercase leading-[14px] tracking-[0.06em] text-[var(--theme-text-muted)]"
          style={{ top: top + (TODO_STRIP - 16) / 2 }}
        >
          Todo
        </span>
      </div>

      {strip.chips.map((chip) => (
        <TodoChipButton
          key={chip.key}
          chip={chip}
          top={top + CHIP_TOP}
          hot={chip.key === activeKey}
          pinned={chip.key === pinnedKey}
          onOpen={onOpen}
          onHover={onHover}
        />
      ))}
    </div>
  );
}

function HoverLines({ chip, baseY, spineY }: { chip: TodoChip; baseY: number; spineY: number }) {
  const stroke = `var(--tint-${TODO_MARK_HUE[chip.dominant]}-solid)`;
  const xs = chip.maxX - chip.minX > 1 ? [chip.minX, chip.maxX] : [chip.minX];
  return (
    <g data-testid="todo-hover-lines">
      {xs.length === 2 && <rect x={chip.minX} y={spineY} width={chip.maxX - chip.minX} height={baseY - spineY} fill={stroke} opacity={0.08} />}
      {xs.map((x) => (
        <g key={x}>
          <line x1={x} y1={baseY} x2={x} y2={spineY} stroke={stroke} strokeWidth={1.2} strokeDasharray="2 3" />
          <circle cx={x} cy={spineY} r={2.5} fill={stroke} />
        </g>
      ))}
    </g>
  );
}

function TodoChipButton({
  chip,
  top,
  hot,
  pinned,
  onOpen,
  onHover,
}: {
  chip: TodoChip;
  top: number;
  hot: boolean;
  pinned: boolean;
  onOpen: (chip: TodoChip, el: HTMLElement) => void;
  onHover?: (chip: TodoChip, el: HTMLElement | null) => void;
}) {
  const hover = onHover
    ? {
        onMouseEnter: (e: MouseEvent<HTMLElement>) => onHover(chip, e.currentTarget),
        onMouseLeave: () => onHover(chip, null),
      }
    : {};
  const common = {
    type: 'button' as const,
    'data-timeline-node': todoChipNodeId(chip),
    'data-testid': 'todo-chip',
    'aria-label': chipLabel(chip),
    'aria-expanded': pinned,
    onClick: (e: MouseEvent<HTMLElement>) => onOpen(chip, e.currentTarget),
    ...hover,
  };
  const ring = hot && 'shadow-[0_0_0_3px_var(--theme-bg-hover)]';

  if (chip.marks.length === 1) {
    const kind = chip.marks[0]!.kind;
    const hue = TODO_MARK_HUE[kind];
    const Glyph = TODO_MARK_ICON[kind];
    return (
      <button
        {...common}
        className={cn('absolute z-[4] flex items-center justify-center rounded-full border transition-transform hover:scale-110', ring)}
        style={{
          left: chip.left,
          top,
          width: CHIP_H,
          height: CHIP_H,
          // The tint bg is translucent: lay it over the opaque surface so the dashed
          // baseline does not show through, and use the tint's text tone (readable in light
          // and dark) for the glyph — the same tone the grouped chips use.
          color: `var(--tint-${hue}-text)`,
          background: `linear-gradient(var(--tint-${hue}-bg), var(--tint-${hue}-bg)), var(--theme-bg-surface)`,
          borderColor: `var(--tint-${hue}-border)`,
        }}
      >
        <Glyph size={11} />
      </button>
    );
  }

  return (
    <button
      {...common}
      className={cn(
        'absolute z-[4] flex items-center justify-center gap-[3px] rounded-full border bg-[var(--theme-bg-surface)] px-[5px] text-[10px] tabular-nums transition-colors',
        ring,
      )}
      style={{
        left: chip.left,
        top,
        width: chip.width,
        height: CHIP_H,
        borderColor: hot ? `var(--tint-${TODO_MARK_HUE[chip.dominant]}-border)` : 'var(--theme-border-input)',
      }}
    >
      {TODO_MARK_KINDS.filter((k) => chip.counts[k]).map((k) => {
        const Glyph = TODO_MARK_ICON[k];
        return (
          <span key={k} className="flex items-center gap-[2px]" style={{ color: `var(--tint-${TODO_MARK_HUE[k]}-text)` }}>
            <Glyph size={11} />
            <span>{chip.counts[k]}</span>
          </span>
        );
      })}
    </button>
  );
}
