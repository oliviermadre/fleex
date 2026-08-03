import type { AgentActivityState } from '@fleex/shared';

import { cn } from '../../lib/cn';
import { tint } from '../../lib/tints';
import { StatusDot } from '../ui/StatusDot';

interface Props {
  activity: AgentActivityState;
  /** Tooltip detail (falls back to a per-state default). */
  detail?: string;
  /**
   * Compact state duration ("5m", "2h") — renders "Waiting for 5m" (#400,
   * pass 5). Omitted on kanban cards, which keep the plain label.
   */
  duration?: string;
}

const CONFIG = {
  waiting: {
    className: tint('yellow'),
    dot: 'needs-approval' as const,
    label: 'Waiting',
    defaultTitle: 'Waiting for a human response',
  },
  running: {
    className: tint('blue'),
    dot: 'working' as const,
    label: 'Running',
    defaultTitle: 'An agent is working on this ticket',
  },
};

/**
 * Persistent, real-time agentic activity indicator on a Kanban card (#381).
 *
 * Renders nothing when idle. Never color-only: pairs a tinted status dot with a
 * text label so the state is legible to color-blind users and screen readers
 * (spec AC9). The dot's pulse respects `prefers-reduced-motion` via StatusDot.
 */
export function ActivityPill({ activity, detail, duration }: Props) {
  if (activity === 'idle') return null;
  const cfg = CONFIG[activity];
  return (
    <span
      role="status"
      title={detail || cfg.defaultTitle}
      className={cn(
        // whitespace-nowrap: a badge on two lines is forbidden (#400, pass 6) —
        // the duration ("Waiting for 11h") must never wrap inside the pill.
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-medium',
        cfg.className,
      )}
    >
      <StatusDot status={cfg.dot} size="sm" />
      {duration ? `${cfg.label} for ${duration}` : cfg.label}
    </span>
  );
}
