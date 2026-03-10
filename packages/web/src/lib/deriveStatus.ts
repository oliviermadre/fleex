import type { ClaudeActivityStatus } from '@fleex/shared';
import type { Session } from '@fleex/shared';

export type DisplayStatus = 'executing' | 'working' | 'needs-approval' | 'idle' | 'unknown';

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

export function deriveDisplayStatus(session: Session): DerivedStatus {
  // Dead / unknown session
  if (session.status !== 'running') {
    return { label: 'Unknown', status: 'unknown', dotColor: 'bg-[var(--theme-text-muted)]', textColor: 'text-[var(--theme-text-muted)]', warning: false };
  }

  // Claude session with activity info
  if (session.type !== 'shell' && session.claudeActivity) {
    const activity = session.claudeActivity;

    if (activity === 'executing') {
      return { label: 'Executing', status: 'executing', dotColor: 'bg-blue-500', textColor: 'text-blue-500', warning: false };
    }
    if (activity === 'working') {
      return { label: 'Working', status: 'working', dotColor: 'bg-blue-500', textColor: 'text-blue-500', warning: false };
    }
    if (WAITING_STATUSES.includes(activity)) {
      return { label: 'Approval', status: 'needs-approval', dotColor: 'bg-amber-400', textColor: 'text-amber-400', warning: true };
    }
    if (activity === 'idle') {
      return { label: 'Idle', status: 'idle', dotColor: 'bg-[var(--theme-text-muted)]', textColor: 'text-[var(--theme-text-muted)]', warning: false };
    }
    return { label: 'Unknown', status: 'unknown', dotColor: 'bg-[var(--theme-text-muted)]', textColor: 'text-[var(--theme-text-muted)]', warning: false };
  }

  // Shell session with foreground process → Working
  if (session.type === 'shell' && session.foregroundProcess) {
    const proc = session.foregroundProcess.split(' ')[0] ?? '';
    const shellNames = ['zsh', 'bash', 'fish', 'sh'];
    if (!shellNames.includes(proc)) {
      return { label: 'Working', status: 'working', dotColor: 'bg-blue-500', textColor: 'text-blue-500', warning: false };
    }
  }

  // Default: Idle
  return { label: 'Idle', status: 'idle', dotColor: 'bg-[var(--theme-text-muted)]', textColor: 'text-[var(--theme-text-muted)]', warning: false };
}

const STATUS_PRIORITY: Record<DisplayStatus, number> = {
  'needs-approval': 4,
  'executing': 3,
  'working': 2,
  'idle': 1,
  'unknown': 0,
};

export function aggregateBranchStatus(sessions: Session[]): DerivedStatus {
  if (sessions.length === 0) {
    return { label: 'Unknown', status: 'unknown', dotColor: 'bg-[var(--theme-text-muted)]', textColor: 'text-[var(--theme-text-muted)]', warning: false };
  }

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
