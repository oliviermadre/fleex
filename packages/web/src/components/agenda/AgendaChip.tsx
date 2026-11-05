import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import type { AgendaItem } from '@fleex/shared';
import type { AgendaItemType } from '@fleex/shared';
import { cn } from '../../lib/cn';
import { HandIcon, PauseIcon, QuestionIcon } from '../ui/icons/AgendaIcons';
import { LABEL_BY_TYPE, chipStyle, colorToken, dotStyle, hatchStyle, itemHue, labelHue, statusHue, type AgendaColors, type SearchMatch } from './agendaLabels';
import { useAgendaStore } from '../../stores/agendaStore';
import { formatDuration, openWait, workflowShortName } from './agendaLayout';

export type OpenTarget = { item: AgendaItem } | { group: AgendaItem[] };
export type OnOpen = (target: OpenTarget, el: HTMLElement) => void;

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/**
 * The label's SVG icon, tinted with the label hue (red when overdue). The
 * routines' own emoji are never drawn: one iconography for the whole page.
 */
/** The user's colour picks (labels and routines), from the saved prefs. */
export const useAgendaColors = (): AgendaColors => useAgendaStore((s) => s.prefs.colors);

export function LabelIcon({ type, size = 12, overdue, className, item, routineId }: {
  type: AgendaItemType;
  size?: number;
  overdue?: boolean;
  className?: string;
  /** Tint with this item's hue (its routine's colour, an event's own colour). */
  item?: AgendaItem;
  /** Tint with this routine's colour (sidebar routine list). */
  routineId?: string;
}) {
  const colors = useAgendaColors();
  const Glyph = LABEL_BY_TYPE[type].icon;
  const hue = overdue ? 'red' as const
    : item ? itemHue(item, colors)
    : routineId ? itemHue({ type, routine: { id: routineId } } as AgendaItem, colors)
    : labelHue(type, colors);
  return (
    <span className="contents" style={{ color: colorToken(hue, 'text') }}>
      <Glyph size={size} className={cn('shrink-0', className)} />
    </span>
  );
}

/** The icon of a human wait: pause at a gate, question mark for an agent question. */
export function WaitIcon({ kind, size = 10, className }: { kind: 'gate' | 'question'; size?: number; className?: string }) {
  return kind === 'gate'
    ? <PauseIcon size={size} className={cn('inline shrink-0', className)} />
    : <QuestionIcon size={size} className={cn('inline shrink-0', className)} />;
}

/** "Sync backlog ×3": the body of a same-routine group chip. */
export function GroupChipLabel({ items }: { items: AgendaItem[] }) {
  const it0 = items[0]!;
  return (
    <>
      <LabelIcon type={it0.type} item={it0} />
      <span className="truncate">{it0.routine?.name ?? LABEL_BY_TYPE[it0.type].label}</span>
      <span className="shrink-0 font-bold text-[var(--theme-text-secondary)]">&times;{items.length}</span>
    </>
  );
}

/** Status dot for runs, a hand for a manual routine launch. */
function Badges({ item }: { item: AgendaItem }) {
  return (
    <>
      {(item.type === 'routine.run' || item.type === 'workflow.run') && (
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', item.status === 'running' && 'animate-pulse')} style={dotStyle(statusHue(item.status))} />
      )}
      {item.type === 'routine.run' && item.triggeredFrom && item.triggeredFrom !== 'schedule' && <span title="Launched manually" className="flex shrink-0 text-[var(--theme-text-muted)]"><HandIcon size={11} /></span>}
    </>
  );
}

/** The one-line name: workflow runs lead with the ticket number. */
export function ChipName({ item }: { item: AgendaItem }) {
  if (item.type === 'workflow.run' && item.ticket) {
    return (
      <>
        <span className="shrink-0 font-bold tabular-nums">#{item.ticket.displayId}</span>
        <span className="truncate font-semibold">{item.ticket.title}</span>
      </>
    );
  }
  return (
    <>
      <LabelIcon type={item.type} overdue={item.overdue} item={item} />
      <span className={cn('truncate', (item.type === 'routine.skipped' || item.type === 'routine.missed') && 'line-through')}>{item.title}</span>
    </>
  );
}

/** Second line of a workflow run: "Spec Dev PR · (pause) Check Spec · 4 h 32". */
export function WorkflowSubline({ item, now }: { item: AgendaItem; now: Date }) {
  const wait = openWait(item);
  return (
    <div className="truncate text-[10.5px] text-[var(--theme-text-secondary)]">
      <span className="text-[var(--theme-text-muted)]">{workflowShortName(item.workflowName)}</span>
      {' · '}
      {wait ? (
        <span className={wait.kind === 'gate' ? 'text-[var(--tint-yellow-text)]' : 'text-[var(--theme-text-secondary)]'}>
          <WaitIcon kind={wait.kind} className="mr-0.5 align-[-1px]" />{wait.stepName} · {formatDuration(now.getTime() - new Date(wait.start).getTime())}
        </span>
      ) : item.status === 'running' ? (item.currentStep ?? 'running') : item.status}
    </div>
  );
}

/**
 * Hatched overlays for the human waits of a workflow run, clipped to the piece
 * [from, to] this chip draws. `vertical` for the time grid, horizontal for bars.
 */
export function WaitHatches({ item, from, to, now, vertical }: { item: AgendaItem; from: Date; to: Date; now: Date; vertical: boolean }) {
  const span = to.getTime() - from.getTime();
  if (!item.segments?.length || span <= 0) return null;
  return (
    <>
      {item.segments.map((s, i) => {
        const a = Math.max(0, (new Date(s.start).getTime() - from.getTime()) / span);
        const b = Math.min(1, ((s.end ? new Date(s.end) : now).getTime() - from.getTime()) / span);
        if (b <= 0 || a >= 1) return null;
        const pos: CSSProperties = vertical
          ? { top: `${a * 100}%`, height: `${(b - a) * 100}%`, left: 0, right: 0 }
          : { left: `${a * 100}%`, width: `${(b - a) * 100}%`, top: 0, bottom: 0 };
        return <span key={i} className="pointer-events-none absolute" style={{ ...hatchStyle(s.kind), ...pos }} />;
      })}
    </>
  );
}

/** A compact chip (month cells, all-day band, schedule rows, popover lists). */
export function AgendaChip({ item, onOpen, match, time = true, children }: {
  item: AgendaItem;
  onOpen: OnOpen;
  match?: SearchMatch;
  time?: boolean;
  children?: ReactNode;
}) {
  const colors = useAgendaColors();
  return (
    <button
      type="button"
      data-agenda-item={item.id}
      onClick={(e: MouseEvent<HTMLButtonElement>) => { e.stopPropagation(); onOpen({ item }, e.currentTarget); }}
      className={cn('relative flex w-full min-w-0 items-center gap-1 overflow-hidden rounded px-1.5 text-left text-[11px] leading-4 hover:brightness-125')}
      data-agenda-match={match}
      style={chipStyle(item, colors, match)}
      title={item.title}
    >
      {time && item.shape !== 'allDay' && <span className="shrink-0 text-[10px] text-[var(--theme-text-muted)]">{fmtTime(item.start)}</span>}
      <ChipName item={item} />
      <Badges item={item} />
      {children}
    </button>
  );
}

export { Badges as ChipBadges };
