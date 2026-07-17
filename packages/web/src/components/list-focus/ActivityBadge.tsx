import type { AgentActivityState } from '@fleex/shared';
import { ActivityPill } from '../tickets/ActivityPill';
import { formatAge } from '../../lib/formatAge';
import { useNow } from '../../lib/useNow';
import { tintText } from '../../lib/tints';

interface Props {
  activity: AgentActivityState;
  /** Tooltip detail for the waiting/running pill. */
  detail?: string;
  /** Last SDK activity; null/undefined = the ticket never had an SDK session. */
  lastActivityAt?: string | null;
  /** When the current waiting/running state began; null/undefined = unknown. */
  since?: string | null;
}

/**
 * Cockpit activity column (#400, pass 4 remarks 3–5, pass 5). One badge per
 * row, and EVERY badge carries its live duration:
 * - waiting → yellow pill "Waiting for {{age}}",
 * - running → blue pill "Running for {{age}}",
 * - idle → gray "idle for {{age}}" from the last SDK execution, or just
 *   "idle" when there never was one.
 * Ages tick every second off the shared useNow clock — no refresh needed —
 * and formatAge rolls units over (59s → 1m, never 61s).
 */
export function ActivityBadge({ activity, detail, lastActivityAt, since }: Props) {
  const now = useNow();
  if (activity !== 'idle') {
    return (
      <ActivityPill
        activity={activity}
        detail={detail}
        duration={since ? formatAge(since, now) : undefined}
      />
    );
  }
  return (
    <span
      className={`whitespace-nowrap text-[10px] ${tintText('gray')}`}
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
