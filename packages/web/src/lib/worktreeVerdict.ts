import type { TicketStatus } from '@fleex/shared';

import type { TintHue } from './tints';

export type WorktreeVerdict =
  'ready_to_push' | 'needs_rebase' | 'up_to_date' | 'merged_removable' | 'stale_removable';

export interface WorktreeVerdictInput {
  commitsAhead: number;
  commitsBehind: number;
  prState?: 'open' | 'merged' | 'closed';
  ticketStatus?: TicketStatus;
  ticketMissing?: boolean;
}

const CLOSED_TICKET_STATUSES: TicketStatus[] = ['done', 'cancelled'];

export function deriveWorktreeVerdict(input: WorktreeVerdictInput): WorktreeVerdict {
  if (input.prState === 'merged') return 'merged_removable';
  if (
    input.ticketMissing ||
    (input.ticketStatus && CLOSED_TICKET_STATUSES.includes(input.ticketStatus))
  ) {
    return 'stale_removable';
  }
  if (input.commitsBehind > 0) return 'needs_rebase';
  if (input.commitsAhead > 0) return 'ready_to_push';
  return 'up_to_date';
}

export function isRemovableVerdict(v: WorktreeVerdict): boolean {
  return v === 'merged_removable' || v === 'stale_removable';
}

export const VERDICT_META: Record<WorktreeVerdict, { label: string; hue: TintHue }> = {
  ready_to_push: { label: 'Ready to push', hue: 'purple' },
  needs_rebase: { label: 'Needs rebase', hue: 'yellow' },
  up_to_date: { label: 'Up to date', hue: 'gray' },
  merged_removable: { label: 'Merged · removable', hue: 'green' },
  stale_removable: { label: 'Stale · removable', hue: 'red' },
};
