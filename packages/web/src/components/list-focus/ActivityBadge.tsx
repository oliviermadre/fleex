import type { AgentActivityState } from '@fleex/shared';
import { ActivityPill } from '../tickets/ActivityPill';
import { formatAge } from '../../lib/formatAge';
import { tintText } from '../../lib/tints';

interface Props {
  activity: AgentActivityState;
  /** Tooltip detail for the waiting/running pill. */
  detail?: string;
  /** Last SDK activity; null/undefined = the ticket never had an SDK session. */
  lastActivityAt?: string | null;
}

/**
 * Cockpit activity column (#400, pass 4, remarks 3–5). One badge per row:
 * - waiting → yellow pill (same ActivityPill as the kanban card),
 * - running → blue pill,
 * - idle → gray "idle since {{age}}" from the last SDK execution, or just
 *   "idle" when there never was one.
 */
export function ActivityBadge({ activity, detail, lastActivityAt }: Props) {
  if (activity !== 'idle') {
    return <ActivityPill activity={activity} detail={detail} />;
  }
  return (
    <span
      className={`whitespace-nowrap text-[10px] ${tintText('gray')}`}
      title={
        lastActivityAt
          ? `Last SDK activity ${formatAge(lastActivityAt)} ago`
          : 'No SDK session yet'
      }
    >
      {lastActivityAt ? `idle since ${formatAge(lastActivityAt)}` : 'idle'}
    </span>
  );
}
