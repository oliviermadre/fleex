import type { ClaudeActivityStatus, SessionHookStatus, WaitingReason } from '@fleex/shared';
import type { Session } from '@fleex/shared';
import { tintSolid, tintText } from './tints';

export type DisplayStatus = 'executing' | 'working' | 'needs-approval' | 'idle' | 'unknown' | 'error';

export interface DerivedStatus {
  label: string;
  status: DisplayStatus;
  dotColor: string;
  textColor: string;
  warning: boolean;
}

const WAITING_STATUSES: ClaudeActivityStatus[] = [
  'waiting_tool_approval',
  'waiting_user_choice',
  'waiting_plan_approval',
];

const STATUS_UNKNOWN: DerivedStatus = {
  label: 'Unknown',
  status: 'unknown',
  dotColor: 'bg-[var(--theme-text-muted)]',
  textColor: 'text-[var(--theme-text-muted)]',
  warning: false,
};

const STATUS_IDLE: DerivedStatus = {
  label: 'Idle',
  status: 'idle',
  dotColor: 'bg-[var(--theme-text-muted)]',
  textColor: 'text-[var(--theme-text-muted)]',
  warning: false,
};

const STATUS_WORKING: DerivedStatus = {
  label: 'Working',
  status: 'working',
  dotColor: tintSolid('blue'),
  textColor: tintText('blue'),
  warning: false,
};

const STATUS_NEEDS_APPROVAL: DerivedStatus = {
  label: 'Approval',
  status: 'needs-approval',
  dotColor: tintSolid('yellow'),
  textColor: tintText('yellow'),
  warning: true,
};

const STATUS_QUESTION: DerivedStatus = {
  label: 'Question',
  status: 'needs-approval',
  dotColor: tintSolid('yellow'),
  textColor: tintText('yellow'),
  warning: true,
};

/**
 * Soft idle — agent has emitted `notification/idle_prompt` (Claude is at rest, awaiting
 * the next user input). Visually neutral: no warning, no amber alarm — distinguished
 * from a pure `idle` (PTY exit) only by the slightly more positive label.
 */
const STATUS_AWAITING: DerivedStatus = {
  label: 'Awaiting',
  status: 'idle',
  dotColor: 'bg-[var(--theme-text-muted)]',
  textColor: 'text-[var(--theme-text-muted)]',
  warning: false,
};

const STATUS_COMPLETE: DerivedStatus = {
  label: 'Done',
  status: 'idle',
  dotColor: tintSolid('green'),
  textColor: tintText('green'),
  warning: false,
};

const STATUS_ERROR: DerivedStatus = {
  label: 'Error',
  status: 'error',
  dotColor: tintSolid('red'),
  textColor: tintText('red'),
  warning: true,
};

/**
 * Map a hook-driven status to its display representation.
 * Returns null when `hookStatus` is absent or `unknown` so the caller can fall
 * back to the legacy `claudeActivity` (JSONL) signal.
 *
 * For `waiting`, the sub-reason matters:
 *   - `permission` → ⚠ "Approval" (amber, alarming — Claude wants to use a tool)
 *   - `question`   → ⚠ "Question" (amber, alarming — Claude awaits a structured answer)
 *   - `idle`       → "Awaiting" (gray, neutral — Claude is at rest, no urgency)
 */
function fromHookStatus(
  status: SessionHookStatus | undefined,
  reason: WaitingReason | undefined,
): DerivedStatus | null {
  if (!status || status === 'unknown') return null;
  switch (status) {
    case 'working':
      return STATUS_WORKING;
    case 'waiting':
      if (reason === 'idle') return STATUS_AWAITING;
      if (reason === 'question') return STATUS_QUESTION;
      return STATUS_NEEDS_APPROVAL; // permission_prompt or unknown reason → keep alarming
    case 'complete':
      return STATUS_COMPLETE;
    case 'error':
      return STATUS_ERROR;
    case 'idle':
      return STATUS_IDLE;
    default:
      return null;
  }
}

export function deriveDisplayStatus(session: Session): DerivedStatus {
  // Dead / unknown session
  if (session.status !== 'running') {
    return STATUS_UNKNOWN;
  }

  // Priority 1: hook-driven semantic status (UserPromptSubmit/Notification/Stop…)
  const fromHooks = fromHookStatus(session.hookStatus, session.hookWaitingReason);
  if (fromHooks) return fromHooks;

  // Priority 2: legacy claudeActivity (JSONL-derived) — kept as fallback during
  // the migration. Will be removed once hookStatus is universal.
  if (session.claudeActivity) {
    const activity = session.claudeActivity;
    if (activity === 'executing') {
      return { label: 'Executing', status: 'executing', dotColor: tintSolid('blue'), textColor: tintText('blue'), warning: false };
    }
    if (activity === 'working') return STATUS_WORKING;
    if (WAITING_STATUSES.includes(activity)) return STATUS_NEEDS_APPROVAL;
    if (activity === 'idle') return STATUS_IDLE;
    return STATUS_UNKNOWN;
  }

  // Priority 3: shell session with foreground process → Working
  if (session.type === 'shell' && session.foregroundProcess) {
    const proc = session.foregroundProcess.split(' ')[0] ?? '';
    const shellNames = ['zsh', 'bash', 'fish', 'sh'];
    if (!shellNames.includes(proc)) return STATUS_WORKING;
  }

  return STATUS_IDLE;
}

const STATUS_PRIORITY: Record<DisplayStatus, number> = {
  'needs-approval': 5,
  'error': 4,
  'executing': 3,
  'working': 2,
  'idle': 1,
  'unknown': 0,
};

export function aggregateBranchStatus(sessions: Session[]): DerivedStatus {
  if (sessions.length === 0) return STATUS_UNKNOWN;

  let best: DerivedStatus | null = null;
  let bestPriority = -1;

  for (const session of sessions) {
    const derived = deriveDisplayStatus(session);
    const priority = STATUS_PRIORITY[derived.status];
    if (priority > bestPriority) {
      bestPriority = priority;
      best = derived;
    }
  }

  return best!;
}
