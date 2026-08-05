import type { AgentActivityState } from '@fleex/shared';
import { ActivityPill } from '../tickets/ActivityPill';
import { formatAge } from '../../lib/formatAge';
import { useNow } from '../../lib/useNow';
import { tint } from '../../lib/tints';

interface Props {
  activity: AgentActivityState;
  /** Tooltip detail for the waiting/running pill. */
  detail?: string;
  /** Last SDK activity; null/undefined = the ticket never had an SDK session. */
  lastActivityAt?: string | null;
  /** When the current waiting/running state began; null/undefined = unknown. */
  since?: string | null;
  /** Opens the live execution behind a running badge; omitted = inert pill. */
  onOpenExecution?: () => void;
}

/**
 * Cockpit activity column (#400, pass 4 remarks 3–5, passes 5–6). One badge
 * per row, and EVERY badge carries its live duration:
 * - waiting → yellow pill "Waiting for {{age}}",
 * - running → blue pill "Running for {{age}}",
 * - idle → gray pill "idle for {{age}}" from the last SDK execution, or just
 *   "idle" when there never was one (pass 6: a pill like the other two, not
 *   bare text).
 * Ages tick every second off the shared useNow clock — no refresh needed —
 * formatAge rolls units over (59s → 1m, never 61s), and a badge never wraps
 * onto two lines (pass 6: "interdit !").
 */
export function ActivityBadge({ activity, detail, lastActivityAt, since, onOpenExecution }: Props) {
  const now = useNow();
  if (activity !== 'idle') {
    return (
      <ActivityPill
        activity={activity}
        detail={detail}
        duration={since ? formatAge(since, now) : undefined}
        onClick={onOpenExecution}
        clickTitle={detail ? `${detail} — click to open the live execution` : undefined}
      />
    );
  }
  return (
    <span
      // Same pill recipe as ActivityPill (minus the status dot — idle has no
      // liveness to signal), gray-tinted per pass 6.
      className={`inline-flex items-center whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-medium ${tint('gray')}`}
      title={
        lastActivityAt
          ? `Last SDK activity ${formatAge(lastActivityAt, now)} ago`
          : 'No SDK session yet'
      }
    >
      {lastActivityAt ? `idle for ${formatAge(lastActivityAt, now)}` : 'idle'}
    </span>
  );
}
