import { useMemo } from 'react';
import type { Session, WorktreeSessionGroup } from '@fleex/shared';
import { useSessionStore } from '../../stores/sessionStore';
import { useUIStore } from '../../stores/uiStore';
import { useTicketStore } from '../../stores/ticketStore';

import { cn } from '../../lib/cn';
import { PrBadge } from '../ui/PrBadge';
import { tintText } from '../../lib/tints';
import { usePullRequestStore } from '../../stores/pullRequestStore';
import { aggregateBranchStatus } from '../../lib/deriveStatus';
import { StatusDot } from '../ui/StatusDot';
import { useNavigate } from 'react-router-dom';

const PRIORITY_ICON_COLOR: Record<string, string> = {
  none: 'text-[var(--theme-text-muted)]',
  low: tintText('blue'),
  medium: tintText('yellow'),
  high: tintText('red'),
};

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 0) return 'now';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w`;
}

import type { FlowType } from './RepositoryGroup';

interface Props {
  worktree: WorktreeSessionGroup;
  repoGroupId: string;
  repositoryOrg: string;
  repositoryName: string;
  flowType?: FlowType;
}

export function WorktreeGroup({ worktree, repoGroupId, repositoryOrg, repositoryName, flowType }: Props) {
  const navigate = useNavigate();
  const selectedSessionId = useSessionStore((s) => s.selectedSessionId);
  const repoKey = `${repositoryOrg}/${repositoryName}`;
  const worktreeKey = `${repoKey}:${worktree.branch}`;
  const lastActiveTab = useUIStore((s) => s.lastActiveTabByWorktree[worktreeKey]);
  const pullsByRepo = usePullRequestStore((s) => s.pullsByRepo);

  // Ticket is resolved by the backend grouping (ticketId on worktree group)
  const tickets = useTicketStore((s) => s.tickets);
  const ticket = useMemo(() =>
    worktree.ticketId ? (tickets.find((t) => t.id === worktree.ticketId) ?? null) : null,
    [tickets, worktree.ticketId]
  );

  // Aggregate status for branch
  const branchStatus = useMemo(() => aggregateBranchStatus(worktree.sessions), [worktree.sessions]);

  const setSelectedAgentWorktreeTicketId = useUIStore((s) => s.setSelectedAgentWorktreeTicketId);
  const selectedAgentWorktreeTicketId = useUIStore((s) => s.selectedAgentWorktreeTicketId);
  const agentInfo = worktree.agentWorktree;
  const isAgentSelected = agentInfo && selectedAgentWorktreeTicketId === agentInfo.ticketId;
  const ticketPRs = useMemo(() => {
    if (!ticket) return [];
    const prs: { org: string; name: string; number: number; state: 'open' | 'merged' | 'closed'; isDraft: boolean; title: string }[] = [];
    for (const link of ticket.links) {
      if (link.type !== 'github_pr') continue;
      // ref format: "org/repo#number"
      const hashIdx = link.ref.indexOf('#');
      if (hashIdx <= 0) continue;
      const repoRef = link.ref.substring(0, hashIdx);
      const num = parseInt(link.ref.substring(hashIdx + 1), 10);
      if (!num) continue;
      const slashIdx = repoRef.indexOf('/');
      if (slashIdx <= 0) continue;
      const org = repoRef.substring(0, slashIdx);
      const name = repoRef.substring(slashIdx + 1);
      // Find PR in store to get state (case-insensitive: link refs may carry a
      // non-canonical org casing, e.g. a pasted "ODYS-TRAVEL/..." URL, while the
      // store is keyed by the canonical lowercase repo)
      const storePRs = pullsByRepo[`${org.toLowerCase()}/${name.toLowerCase()}`];
      const storePR = storePRs ? Object.values(storePRs).find((p) => p.number === num) : undefined;
      prs.push({
        org,
        name,
        number: num,
        state: storePR?.state ?? 'open',
        isDraft: storePR?.isDraft ?? false,
        title: storePR?.title ?? link.label,
      });
    }
    return prs;
  }, [ticket, pullsByRepo]);

  const sessionTicketId = useSessionStore((s) => s.selectedTicketId);
  const isSelected = sessionTicketId === worktree.ticketId || worktree.sessions.some((s: Session) => s.id === selectedSessionId) || !!isAgentSelected;

  const handleBranchClick = () => {
    if (worktree.ticketId) {
      const tabSuffix = lastActiveTab ? `/${encodeURIComponent(lastActiveTab)}` : '';
      navigate(`/sessions/${worktree.ticketId}${tabSuffix}`, { replace: true });
    } else if (agentInfo?.ticketId) {
      navigate(`/sessions/agent/${agentInfo.ticketId}`, { replace: true });
    } else if (worktree.sessions.length > 0) {
      navigate(`/sessions/${worktree.sessions[0]!.id}`, { replace: true });
    }
  };

  const priority = ticket?.priority ?? 'none';
  const iconColor = PRIORITY_ICON_COLOR[priority] ?? PRIORITY_ICON_COLOR['none']!;
  const timeInColumn = ticket ? formatTimeAgo(ticket.statusChangedAt) : null;

  return (
    <div>
      <div className="group/wt relative">
        <button
          className={cn(
            'flex min-w-0 w-full flex-col gap-0.5 py-2.5 pl-6 pr-3 text-left transition-colors border-l-2',
            isSelected
              ? 'border-[var(--theme-accent)] bg-[var(--theme-bg-hover)]'
              : 'border-transparent hover:bg-[var(--theme-bg-hover)]'
          )}
          onClick={handleBranchClick}
        >
          {/* Row 1: [icon colored by priority] [ticket name] [time in column : right] — favorite star floats in the left gutter (absolute, no layout shift) */}
          <div className="relative flex items-center gap-1.5">
            {ticket?.favorite && (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" className={cn('absolute right-full top-1/2 mr-1.5 -translate-y-1/2', tintText('yellow'))} aria-label="Favorite">
                <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
              </svg>
            )}
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={cn('shrink-0', iconColor)}>
              <rect x="2" y="2" width="12" height="12" rx="2" />
              <path d="M5 6h6M5 9h4" />
            </svg>
            <span className="truncate text-sm font-medium text-[var(--theme-text-primary)]">
              {ticket?.title ?? worktree.branch}
            </span>
            {timeInColumn && (
              <span className="ml-auto shrink-0 text-[11px] text-[var(--theme-text-faint)]">{timeInColumn}</span>
            )}
          </div>

          {/* Row 2: [PRs : left] [diff : center] - [status : right] */}
          <div className="flex items-center gap-1.5 pl-5">
            {/* PRs left-aligned */}
            {ticketPRs.map((tpr) => (
              <PrBadge key={`${tpr.org}/${tpr.name}#${tpr.number}`} org={tpr.org} name={tpr.name} pr={tpr} />
            ))}

            {/* Diff centered via flex-1 spacer */}
            <span className="flex-1 text-center">
              {worktree.diffStats && (worktree.diffStats.additions > 0 || worktree.diffStats.deletions > 0) && (
                <span className="inline-flex gap-1 text-[11px] font-mono">
                  {worktree.diffStats.additions > 0 && <span className={tintText('green')}>+{worktree.diffStats.additions}</span>}
                  {worktree.diffStats.deletions > 0 && <span className={tintText('red')}>-{worktree.diffStats.deletions}</span>}
                </span>
              )}
            </span>

            {/* Status right-aligned */}
            <span className="shrink-0 flex items-center gap-1">
              <StatusDot status={branchStatus.status} />
              <span className={`text-xs ${branchStatus.textColor}`}>{branchStatus.label}</span>
              {branchStatus.warning && (
                <span className={cn('text-xs', tintText('yellow'))} title="Needs approval">&#9888;</span>
              )}
            </span>
          </div>

        </button>
      </div>
    </div>
  );
}
