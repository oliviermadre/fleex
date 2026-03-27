import { useMemo } from 'react';
import type { Session, WorktreeSessionGroup, TicketLink } from '@fleex/shared';
import { useSessionStore } from '../../stores/sessionStore';
import { useUIStore } from '../../stores/uiStore';
import { useTicketStore } from '../../stores/ticketStore';
import { GitForkIcon } from './icons';
import { cn } from '../../lib/cn';
import { usePullRequestStore } from '../../stores/pullRequestStore';
import { aggregateBranchStatus } from '../../lib/deriveStatus';
import { StatusDot } from '../ui/StatusDot';
import { useNavigate } from 'react-router-dom';

const AGENT_STATUS_STYLE: Record<string, { dot: string; text: string; label: string }> = {
  running: { dot: 'bg-blue-400 animate-pulse', text: 'text-blue-400', label: 'Running' },
  completed: { dot: 'bg-green-400', text: 'text-green-400', label: 'Completed' },
  failed: { dot: 'bg-red-400', text: 'text-red-400', label: 'Failed' },
  idle: { dot: 'bg-[var(--theme-text-faint)]', text: 'text-[var(--theme-text-faint)]', label: 'Idle' },
};

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
  const pr = usePullRequestStore((s) => s.pullsByRepo[repoKey]?.[worktree.branch]);

  // Find linked ticket for this worktree
  const tickets = useTicketStore((s) => s.tickets);
  const worktreeRef = worktreeKey;
  const linkedTicket = useMemo(() =>
    tickets.find((t) => t.links.some((l: TicketLink) => l.type === 'worktree' && l.ref === worktreeRef)),
    [tickets, worktreeRef]
  );

  // Aggregate status for branch
  const branchStatus = useMemo(() => aggregateBranchStatus(worktree.sessions), [worktree.sessions]);

  const setSelectedAgentWorktreeTicketId = useUIStore((s) => s.setSelectedAgentWorktreeTicketId);
  const selectedAgentWorktreeTicketId = useUIStore((s) => s.selectedAgentWorktreeTicketId);
  const agentInfo = worktree.agentWorktree;
  const isAgentSelected = agentInfo && selectedAgentWorktreeTicketId === agentInfo.ticketId;

  // Is this branch selected (any session in it is selected, or agent worktree is selected)?
  const isSelected = worktree.sessions.some((s: Session) => s.id === selectedSessionId) || !!isAgentSelected;

  const handleBranchClick = () => {
    // Agent worktree → always open agent panel (handles sessions + executions)
    if (agentInfo) {
      setSelectedAgentWorktreeTicketId(agentInfo.ticketId);
      navigate(`/sessions/agent/${agentInfo.ticketId}`, { replace: true });
      return;
    }
    if (worktree.sessions.length === 0) return;
    // Navigate to last active tab if it still exists, otherwise first session
    const lastSessionId = lastActiveTab?.startsWith('s:') ? lastActiveTab.slice(2) : lastActiveTab;
    const targetId = lastSessionId && worktree.sessions.some((s: Session) => s.id === lastSessionId)
      ? lastSessionId
      : worktree.sessions[0]!.id;
    navigate(`/sessions/${targetId}`, { replace: true });
  };

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
          {/* Row 1: Title — ticket title if linked, otherwise branch name */}
          <div className="flex items-center gap-1.5">
            {(agentInfo?.ticketTitle ?? linkedTicket?.title) ? (
              <>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[var(--theme-text-secondary)]">
                  <rect x="2" y="2" width="12" height="12" rx="2" />
                  <path d="M5 6h6M5 9h4" />
                </svg>
                <span className="truncate text-sm font-medium text-[var(--theme-text-primary)]">
                  {agentInfo?.ticketTitle ?? linkedTicket?.title}
                </span>
              </>
            ) : (
              <>
                <GitForkIcon size={14} className="shrink-0 text-[var(--theme-text-secondary)]" />
                <span className="truncate text-sm font-semibold font-mono text-[var(--theme-text-primary)]">{worktree.branch}</span>
              </>
            )}
            {pr && (
              <a
                href={`https://github.com/${repositoryOrg}/${repositoryName}/pull/${pr.number}`}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  'ml-1 shrink-0 inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-medium',
                  pr.state === 'merged'
                    ? 'bg-purple-500/15 text-purple-400 hover:bg-purple-500 hover:text-white'
                    : 'bg-[var(--theme-accent-muted)] text-[var(--theme-accent)] hover:bg-[var(--theme-accent)] hover:text-white'
                )}
                onClick={(e) => e.stopPropagation()}
                title={pr.title}
              >
                <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" /></svg>
                #{pr.number}
              </a>
            )}
          </div>

          {/* Row 2: Status dot + label + warning + session count */}
          <div className="flex items-center gap-1.5 pl-5">
            <StatusDot status={branchStatus.status} />
            <span className={`text-xs ${branchStatus.textColor}`}>{branchStatus.label}</span>
            {branchStatus.warning && (
              <span className="text-xs text-amber-400" title="Needs approval">&#9888;</span>
            )}
            <span className="ml-auto shrink-0 text-xs text-[var(--theme-text-faint)]">{worktree.sessions.length}</span>
          </div>

          {/* Row 3: Agent indicator (if agent worktree) */}
          {agentInfo && (
            <div className="flex items-center gap-1.5 pl-5">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-violet-400">
                <path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" />
              </svg>
              <span className="text-xs text-violet-400 truncate">{agentInfo.agentDisplayName}</span>
              {(() => {
                const style = AGENT_STATUS_STYLE[agentInfo.executionStatus] ?? AGENT_STATUS_STYLE['idle']!;
                return (
                  <span className={cn('ml-auto flex items-center gap-1 shrink-0')}>
                    <span className={cn('h-1.5 w-1.5 rounded-full', style.dot)} />
                    <span className={cn('text-[10px]', style.text)}>{style.label}</span>
                  </span>
                );
              })()}
            </div>
          )}
        </button>
      </div>
    </div>
  );
}
