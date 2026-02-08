import type { ClaudeActivityStatus } from '@asm/shared';
import { cn } from '../../lib/cn';

interface Props {
  status: ClaudeActivityStatus;
}

const LABELS: Record<ClaudeActivityStatus, string> = {
  working: 'Working',
  executing: 'Executing tool',
  waiting_tool_approval: 'Waiting for approval',
  waiting_user_choice: 'Waiting for your choice',
  waiting_plan_approval: 'Waiting for plan approval',
  idle: 'Idle',
  unknown: 'Unknown',
};

export function ActivityDot({ status }: Props) {
  const isActive = status === 'working' || status === 'executing';
  const isWaiting =
    status === 'waiting_tool_approval' ||
    status === 'waiting_user_choice' ||
    status === 'waiting_plan_approval';

  return (
    <span
      className={cn(
        'absolute -bottom-0.5 -right-0.5 block h-2 w-2 rounded-full border border-[var(--theme-bg-surface)]',
        isActive && 'bg-emerald-400 animate-pulse',
        isWaiting && 'bg-amber-400 animate-blink',
        !isActive && !isWaiting && 'bg-[var(--theme-text-muted)]',
      )}
      title={LABELS[status]}
    />
  );
}
