import type { AgentActivityState } from '@fleex/shared';
import { StatusDot } from '../ui/StatusDot';
import { cn } from '../../lib/cn';
import { tint } from '../../lib/tints';

interface Props {
  activity: AgentActivityState;
  /** Tooltip detail (falls back to a per-state default). */
  detail?: string;
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
export function ActivityPill({ activity, detail }: Props) {
  if (activity === 'idle') return null;
  const cfg = CONFIG[activity];
  return (
    <span
      role="status"
      title={detail || cfg.defaultTitle}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
        cfg.className,
      )}
    >
      <StatusDot status={cfg.dot} size="sm" />
      {cfg.label}
    </span>
  );
}
