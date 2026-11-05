import type { CSSProperties } from 'react';
import type { AgendaItem, AgendaItemType } from '@fleex/shared';
import type { TintHue } from '../../lib/tints';

export interface AgendaLabel {
  type: AgendaItemType;
  label: string;
  icon: string;
  hue: TintHue;
  family: 'tickets' | 'routines' | 'workflows' | 'production';
}

export const AGENDA_LABELS: AgendaLabel[] = [
  { type: 'ticket.created', label: 'Created', icon: '🎫', hue: 'blue', family: 'tickets' },
  { type: 'ticket.done', label: 'Done', icon: '✅', hue: 'green', family: 'tickets' },
  { type: 'ticket.due', label: 'Due dates', icon: '🚩', hue: 'orange', family: 'tickets' },
  { type: 'routine.run', label: 'Runs', icon: '⟳', hue: 'purple', family: 'routines' },
  { type: 'routine.upcoming', label: 'Upcoming', icon: '◌', hue: 'purple', family: 'routines' },
  { type: 'routine.skipped', label: 'Skipped', icon: '⊘', hue: 'gray', family: 'routines' },
  { type: 'workflow.run', label: 'Workflow runs', icon: '⑂', hue: 'indigo', family: 'workflows' },
  { type: 'pr.merged', label: 'PRs merged', icon: '🔀', hue: 'pink', family: 'production' },
];

export const LABEL_BY_TYPE = Object.fromEntries(AGENDA_LABELS.map((l) => [l.type, l])) as Record<AgendaItemType, AgendaLabel>;

export const FAMILIES: { key: AgendaLabel['family']; label: string }[] = [
  { key: 'tickets', label: 'Tickets' },
  { key: 'routines', label: 'Routines' },
  { key: 'workflows', label: 'Workflows' },
  { key: 'production', label: 'Production' },
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

const v = (hue: TintHue, token: 'bg' | 'border' | 'solid' | 'text') => `var(--tint-${hue}-${token})`;

/** Chip colours from the label's tint (inline: the hue is data-driven). */
export function chipStyle(item: AgendaItem): CSSProperties {
  const hue = LABEL_BY_TYPE[item.type].hue;
  const upcoming = item.type === 'routine.upcoming';
  const skipped = item.type === 'routine.skipped';
  const red = item.overdue;
  const h = red ? 'red' : hue;
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

export const dotStyle = (hue: TintHue): CSSProperties => ({ background: v(hue, 'solid') });
