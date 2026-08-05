import type { AgentActivityState } from '@fleex/shared';
import { StatusDot } from '../ui/StatusDot';
import { cn } from '../../lib/cn';
import { tint } from '../../lib/tints';

interface Props {
  activity: AgentActivityState;
  /** Tooltip detail (falls back to a per-state default). */
  detail?: string;
  /**
   * Compact state duration ("5m", "2h") — renders "Waiting for 5m" (#400,
   * pass 5). Omitted on kanban cards, which keep the plain label.
   */
  duration?: string;
  /**
   * Makes the pill a button opening the running agent execution. Omitted when
   * there is nothing to open — the pill then stays inert, so the affordance
   * only ever appears where a click actually leads somewhere.
   */
  onClick?: () => void;
  /** Tooltip for the clickable variant (defaults to a generic "open" copy). */
  clickTitle?: string;
}

const CONFIG = {
  waiting: {
    hue: 'yellow' as const,
    dot: 'needs-approval' as const,
    label: 'Waiting',
    defaultTitle: 'Waiting for a human response',
    // Literal class: Tailwind's scanner cannot see a runtime-built hue token.
    // The opaque tint (not the translucent border one) so the hover halo reads
    // clearly against the pill's own tinted background.
    hoverRing: 'hover:ring-[var(--tint-yellow-solid)]',
  },
  running: {
    hue: 'blue' as const,
    dot: 'working' as const,
    label: 'Running',
    defaultTitle: 'An agent is working on this ticket',
    hoverRing: 'hover:ring-[var(--tint-blue-solid)]',
  },
};

// whitespace-nowrap: a badge on two lines is forbidden (#400, pass 6) — the
// duration ("Waiting for 11h") must never wrap inside the pill.
const SHAPE = 'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-medium';

/**
 * Persistent, real-time agentic activity indicator on a Kanban card (#381) and
 * in the cockpit's activity column (#400).
 *
 * Renders nothing when idle. Never color-only: pairs a tinted status dot with a
 * text label so the state is legible to color-blind users and screen readers
 * (spec AC9). The dot's pulse respects `prefers-reduced-motion` via StatusDot.
 *
 * With `onClick` the pill becomes a button that opens the live execution: a
 * tinted ring on hover says "clickable", and a press nudges it down so the
 * click reads as registered.
 */
export function ActivityPill({ activity, detail, duration, onClick, clickTitle }: Props) {
  if (activity === 'idle') return null;
  const cfg = CONFIG[activity];
  const body = (
    <>
      <StatusDot status={cfg.dot} size="sm" />
      {duration ? `${cfg.label} for ${duration}` : cfg.label}
    </>
  );

  if (!onClick) {
    return (
      <span role="status" title={detail || cfg.defaultTitle} className={cn(SHAPE, tint(cfg.hue))}>
        {body}
      </span>
    );
  }

  return (
    <button
      type="button"
      title={clickTitle ?? 'Open the live agent execution'}
      onClick={(e) => {
        // Every host of this pill is itself clickable (kanban card, cockpit row):
        // opening the panel must not also open the ticket behind it.
        e.stopPropagation();
        onClick();
      }}
      // The pill already sits on its own tint, so a background swap would be
      // invisible — the hover ring and the press nudge carry the affordance.
      className={cn(
        SHAPE,
        tint(cfg.hue),
        'cursor-pointer transition-[box-shadow,transform] duration-100',
        'hover:ring-2',
        cfg.hoverRing,
        'active:translate-y-px active:ring-1',
      )}
    >
      <span role="status" className="contents">
        {body}
      </span>
    </button>
  );
}
