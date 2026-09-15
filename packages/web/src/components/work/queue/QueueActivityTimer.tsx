/**
 * Queue row activity timer. Compact by default — just the coloured age ("4h"
 * grey idle, "5m" blue running, "12m" yellow waiting), live off the shared
 * `useNow` clock. Hovering the timer itself (`group/timer`) grows it to the left,
 * revealing the full "State for {age}" with a status dot. Not on row hover: that
 * would shift the icons left of it (PR, favorite, blocked) out from under the
 * pointer, e.g. while it travels into the PR popover. A running/waiting state with an
 * SDK execution is a button that opens the execution log; otherwise it's inert.
 *
 * State is SDK-based (idle/running/waiting from ticketActivityStore); the age of
 * an active state comes from `since`, an idle one from `lastActivityAt` (the last
 * SDK activity). No age at all ⇒ the ticket never had an SDK session → plain "idle".
 */
import type { AgentActivityState } from '@fleex/shared';
import { formatAge } from '../../../lib/formatAge';
import { useNow } from '../../../lib/useNow';
import { cn } from '../../../lib/cn';
import { tintClasses, type TintHue } from '../../../lib/tints';

const HUE: Record<AgentActivityState, TintHue> = { idle: 'gray', running: 'blue', waiting: 'yellow' };
const LABEL: Record<AgentActivityState, string> = { idle: 'idle for', running: 'Running for', waiting: 'Waiting for' };

interface Props {
  activity: AgentActivityState;
  /** ISO start of the current running/waiting state. */
  since: string | null;
  /** ISO of the last SDK activity — the age shown while idle. */
  lastActivityAt: string | null;
  /** Provided when there is an execution to open (running/waiting) → clickable. */
  onOpen?: () => void;
}

export function QueueActivityTimer({ activity, since, lastActivityAt, onOpen }: Props) {
  const now = useNow();
  const t = tintClasses(HUE[activity]);
  const ageSrc = activity === 'idle' ? lastActivityAt : since;
  const age = ageSrc ? formatAge(ageSrc, now) : null;

  const pill = cn(
    'group/timer inline-flex items-center overflow-hidden whitespace-nowrap rounded-full px-2 py-[3px] text-[10px] font-medium tabular-nums',
    t.bg,
    t.text,
  );

  const body = (
    <>
      {age && (
        <span className="flex max-w-0 items-center gap-1 overflow-hidden opacity-0 transition-all duration-200 group-hover/timer:mr-1 group-hover/timer:max-w-[110px] group-hover/timer:opacity-100 motion-reduce:transition-none">
          <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', t.solid)} />
          <span className="whitespace-nowrap">{LABEL[activity]}</span>
        </span>
      )}
      <span>{age ?? (activity === 'idle' ? 'idle' : activity)}</span>
    </>
  );

  if (onOpen) {
    return (
      <button
        type="button"
        title="Open the execution log"
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
        className={cn(pill, 'cursor-pointer ring-inset transition-shadow hover:ring-1', t.ring)}
      >
        {body}
      </button>
    );
  }
  return <span className={pill}>{body}</span>;
}
