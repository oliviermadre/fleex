import type { CSSProperties } from 'react';
import type { AgendaItem, AgendaItemType } from '@fleex/shared';
import { TINT_HUES, type TintHue } from '../../lib/tints';
import {
  CalendarEventIcon, CircleCheckIcon, ExternalCalendarIcon, FlagIcon, GitMergeIcon, MissedIcon, RoutineRunIcon,
  TicketPlusIcon, UpcomingIcon, WorkflowRunIcon, CancelIcon, type AgendaIconComponent,
} from '../ui/icons/AgendaIcons';

export interface AgendaLabel {
  type: AgendaItemType;
  label: string;
  /** An SVG line icon; the label hue tints it through `currentColor`. */
  icon: AgendaIconComponent;
  hue: TintHue;
  family: 'tickets' | 'routines' | 'workflows' | 'production' | 'calendar';
}

export const AGENDA_LABELS: AgendaLabel[] = [
  { type: 'ticket.created', label: 'Created', icon: TicketPlusIcon, hue: 'blue', family: 'tickets' },
  { type: 'ticket.done', label: 'Done', icon: CircleCheckIcon, hue: 'green', family: 'tickets' },
  { type: 'ticket.due', label: 'Due dates', icon: FlagIcon, hue: 'orange', family: 'tickets' },
  { type: 'routine.run', label: 'Runs', icon: RoutineRunIcon, hue: 'pink', family: 'routines' },
  { type: 'routine.upcoming', label: 'Upcoming', icon: UpcomingIcon, hue: 'pink', family: 'routines' },
  { type: 'routine.skipped', label: 'Skipped', icon: CancelIcon, hue: 'gray', family: 'routines' },
  { type: 'routine.missed', label: 'Missed', icon: MissedIcon, hue: 'gray', family: 'routines' },
  { type: 'workflow.run', label: 'Workflow runs', icon: WorkflowRunIcon, hue: 'indigo', family: 'workflows' },
  // GitHub's merged colour (purple), as on the Tasks PR glyph.
  { type: 'pr.merged', label: 'PRs merged', icon: GitMergeIcon, hue: 'purple', family: 'production' },
  { type: 'event', label: 'Events', icon: CalendarEventIcon, hue: 'teal', family: 'calendar' },
  { type: 'external', label: 'Google Calendar', icon: ExternalCalendarIcon, hue: 'blue', family: 'calendar' },
];

export const LABEL_BY_TYPE = Object.fromEntries(AGENDA_LABELS.map((l) => [l.type, l])) as Record<AgendaItemType, AgendaLabel>;

export const FAMILIES: { key: AgendaLabel['family']; label: string }[] = [
  { key: 'tickets', label: 'Tickets' },
  { key: 'routines', label: 'Routines' },
  { key: 'workflows', label: 'Workflows' },
  { key: 'production', label: 'Production' },
  { key: 'calendar', label: 'Calendar' },
];

/** Run status → hue, same mapping as the routine history. */
export function statusHue(status: string | null | undefined): TintHue {
  switch (status) {
    case 'completed': return 'green';
    case 'failed': return 'red';
    case 'running': return 'blue';
    case 'needs_review':
    case 'blocked': return 'yellow';
    default: return 'gray';
  }
}

const v = (c: AgendaColor, token: 'bg' | 'border' | 'solid' | 'text') => colorToken(c, token);

/** E1: the colour picked for a free event, when it is a known tint hue. */
export function eventHue(item: AgendaItem): TintHue | null {
  const c = item.type === 'event' ? item.event?.color : null;
  return c && (TINT_HUES as string[]).includes(c) ? (c as TintHue) : null;
}

/** The user's colour picks: key = item type, or `routine:<id>` for one routine. */
export type AgendaColors = Record<string, string>;

/** A colour the agenda can draw: a theme-aware tint, or a custom `#rrggbb`. */
export type AgendaColor = TintHue | `#${string}`;

export const routineColorKey = (routineId: string) => `routine:${routineId}`;

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * Five base colours on top of the 10 tints (15 swatches, 3 rows of 5). They are
 * mid-tone (Tailwind 500), readable on both light and dark surfaces.
 */
export const EXTRA_SWATCHES: AgendaColor[] = ['#06b6d4', '#84cc16', '#f59e0b', '#f43f5e', '#a0522d'];
export const BASE_SWATCHES: AgendaColor[] = [...TINT_HUES, ...EXTRA_SWATCHES];

/** A stored value the agenda can draw (a tint name or `#rrggbb`), else null. */
export const asAgendaColor = (c: string | null | undefined): AgendaColor | null =>
  !c ? null : (TINT_HUES as string[]).includes(c) ? (c as TintHue) : HEX.test(c) ? (c.toLowerCase() as AgendaColor) : null;

/**
 * One token of a colour as a CSS value. Tints use their theme variables; a
 * custom hex derives the same four tokens with `color-mix`, so it stays
 * readable when the theme flips.
 */
export function colorToken(c: AgendaColor, token: 'bg' | 'border' | 'solid' | 'text'): string {
  if (!c.startsWith('#')) return `var(--tint-${c}-${token})`;
  switch (token) {
    case 'solid': return c;
    case 'bg': return `color-mix(in srgb, ${c} 15%, transparent)`;
    case 'border': return `color-mix(in srgb, ${c} 35%, transparent)`;
    case 'text': return `color-mix(in srgb, ${c} 70%, var(--theme-text-primary))`;
  }
}

/** A label's colour: the user's pick, else the label default. */
export function labelHue(type: AgendaItemType, colors?: AgendaColors): AgendaColor {
  return asAgendaColor(colors?.[type]) ?? LABEL_BY_TYPE[type].hue;
}

/**
 * An item's colour, most specific first: the free event's own colour, the
 * routine's pick, the label's pick, the label default.
 */
export function itemHue(item: AgendaItem, colors?: AgendaColors): AgendaColor {
  return eventHue(item)
    ?? (item.routine ? asAgendaColor(colors?.[routineColorKey(item.routine.id)]) : null)
    ?? labelHue(item.type, colors);
}

/** Chip colours from the item's hue (inline: the hue is data-driven). */
export function chipStyle(item: AgendaItem, colors?: AgendaColors): CSSProperties {
  const hue = itemHue(item, colors);
  const upcoming = item.type === 'routine.upcoming';
  const skipped = item.type === 'routine.skipped' || item.type === 'routine.missed';
  const red = item.overdue;
  const h: AgendaColor = red ? 'red' : hue;
  return {
    background: upcoming || skipped ? 'transparent' : v(h, 'bg'),
    border: `1px ${upcoming || skipped ? 'dashed' : 'solid'} ${v(h, 'border')}`,
    borderLeft: `3px ${upcoming || skipped ? 'dashed' : 'solid'} ${v(h, 'solid')}`,
    color: 'var(--theme-text-primary)',
    opacity: upcoming ? 0.8 : 1,
  };
}

/** Diagonal hatching for a wait: yellow at a gate, grey for an agent question. */
export function hatchStyle(kind: 'gate' | 'question'): CSSProperties {
  const hue: TintHue = kind === 'gate' ? 'yellow' : 'gray';
  return {
    background: `repeating-linear-gradient(135deg, ${v(hue, 'border')} 0 3px, transparent 3px 8px)`,
    borderTop: `1px dashed ${v(hue, 'solid')}`,
    borderBottom: `1px dashed ${v(hue, 'solid')}`,
  };
}

export const dotStyle = (hue: AgendaColor): CSSProperties => ({ background: v(hue, 'solid') });
