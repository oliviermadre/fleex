import { useMemo } from 'react';
import type { Session, WorktreeSessionGroup } from '@fleex/shared';
import { useSessionStore } from '../../stores/sessionStore';
import { useUIStore } from '../../stores/uiStore';
import { useTicketStore } from '../../stores/ticketStore';

import { cn } from '../../lib/cn';
import { usePullRequestStore } from '../../stores/pullRequestStore';
import { aggregateBranchStatus } from '../../lib/deriveStatus';
import { StatusDot } from '../ui/StatusDot';
import { useNavigate } from 'react-router-dom';

const PRIORITY_ICON_COLOR: Record<string, string> = {
  none: 'text-[var(--theme-text-muted)]',
  low: 'text-blue-400',
  medium: 'text-yellow-400',
  high: 'text-red-400',
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
    const prs: { org: string; name: string; number: number; state: string; title: string }[] = [];
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
      // Find PR in store to get state
      const storePRs = pullsByRepo[`${org}/${name}`];
      const storePR = storePRs ? Object.values(storePRs).find((p) => p.number === num) : undefined;
      prs.push({ org, name, number: num, state: storePR?.state ?? 'open', title: storePR?.title ?? link.label });
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
          {/* Row 1: [icon colored by priority] [ticket name] [time in column : right] */}
          <div className="flex items-center gap-1.5">
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
              <a
                key={`${tpr.org}/${tpr.name}#${tpr.number}`}
                href={`https://github.com/${tpr.org}/${tpr.name}/pull/${tpr.number}`}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  'shrink-0 inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-medium',
                  tpr.state === 'merged'
                    ? 'bg-purple-500/15 text-purple-400 hover:bg-purple-500 hover:text-white'
                    : 'bg-[var(--theme-accent-muted)] text-[var(--theme-accent)] hover:bg-[var(--theme-accent)] hover:text-white'
                )}
                onClick={(e) => e.stopPropagation()}
                title={tpr.title}
              >
                <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" /></svg>
                #{tpr.number}
              </a>
            ))}

            {/* Diff centered via flex-1 spacer */}
            <span className="flex-1 text-center">
              {worktree.diffStats && (worktree.diffStats.additions > 0 || worktree.diffStats.deletions > 0) && (
                <span className="inline-flex gap-1 text-[11px] font-mono">
                  {worktree.diffStats.additions > 0 && <span className="text-emerald-400">+{worktree.diffStats.additions}</span>}
                  {worktree.diffStats.deletions > 0 && <span className="text-red-400">-{worktree.diffStats.deletions}</span>}
                </span>
              )}
            </span>

            {/* Status right-aligned */}
            <span className="shrink-0 flex items-center gap-1">
              <StatusDot status={branchStatus.status} />
              <span className={`text-xs ${branchStatus.textColor}`}>{branchStatus.label}</span>
              {branchStatus.warning && (
                <span className="text-xs text-amber-400" title="Needs approval">&#9888;</span>
              )}
            </span>
          </div>

        </button>
      </div>
    </div>
  );
}
