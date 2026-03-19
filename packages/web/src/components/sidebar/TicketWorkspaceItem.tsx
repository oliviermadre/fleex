import { useMemo } from 'react';
import type { Ticket, Session } from '@fleex/shared';
import { useNavigate } from 'react-router-dom';
import { useUIStore } from '../../stores/uiStore';
import { usePullRequestStore } from '../../stores/pullRequestStore';
import { findSessionsForTicket } from '../dashboard/dashboard-helpers';
import { aggregateBranchStatus } from '../../lib/deriveStatus';
import { StatusDot } from '../ui/StatusDot';
import { cn } from '../../lib/cn';

const PRIORITY_COLORS: Record<string, string> = {
  high: 'bg-red-400',
  medium: 'bg-amber-400',
  low: 'bg-blue-400',
  none: 'bg-[var(--theme-text-faint)]',
};

interface Props {
  ticket: Ticket;
  sessions: Session[];
}

export function TicketWorkspaceItem({ ticket, sessions }: Props) {
  const navigate = useNavigate();
  const selectedWorkspaceTicketId = useUIStore((s) => s.selectedWorkspaceTicketId);
  const setSelectedWorkspaceTicketId = useUIStore((s) => s.setSelectedWorkspaceTicketId);
  const pullsByRepo = usePullRequestStore((s) => s.pullsByRepo);

  const isSelected = selectedWorkspaceTicketId === ticket.id;

  const linkedSessions = useMemo(() => findSessionsForTicket(ticket, sessions), [ticket, sessions]);
  const status = useMemo(() => aggregateBranchStatus(linkedSessions), [linkedSessions]);

  const worktreeLinks = useMemo(
    () => ticket.links.filter((l) => l.type === 'worktree'),
    [ticket.links],
  );

  const handleClick = () => {
    setSelectedWorkspaceTicketId(ticket.id);
    navigate(`/workspace/ticket/${ticket.id}`, { replace: true });
  };

  return (
    <button
      className={cn(
        'flex min-w-0 w-full flex-col gap-0.5 py-2.5 pl-6 pr-3 text-left transition-colors border-l-2',
        isSelected
          ? 'border-[var(--theme-accent)] bg-[var(--theme-bg-hover)]'
          : 'border-transparent hover:bg-[var(--theme-bg-hover)]',
      )}
      onClick={handleClick}
    >
      {/* Row 1: priority dot + #id title + session badge */}
      <div className="flex items-center gap-1.5">
        <span
          className={cn('h-2 w-2 shrink-0 rounded-full', PRIORITY_COLORS[ticket.priority] ?? PRIORITY_COLORS['none'])}
        />
        <span className="text-xs text-[var(--theme-text-faint)] shrink-0">#{ticket.displayId}</span>
        <span className="truncate text-sm font-medium text-[var(--theme-text-primary)]">{ticket.title}</span>
        {linkedSessions.length > 0 && (
          <span className="ml-auto shrink-0 rounded-full bg-[var(--theme-accent-muted)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--theme-accent)]">
            {linkedSessions.length}
          </span>
        )}
      </div>

      {/* Row 2: repo chips with PR badges */}
      {worktreeLinks.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 pl-3.5">
          {worktreeLinks.map((link) => {
            const colonIdx = link.ref.indexOf(':');
            const repoKey = colonIdx > 0 ? link.ref.substring(0, colonIdx) : link.ref;
            const branch = colonIdx > 0 ? link.ref.substring(colonIdx + 1) : '';
            const repoName = repoKey.includes('/') ? repoKey.split('/')[1] : repoKey;
            const pr = branch ? pullsByRepo[repoKey]?.[branch] : undefined;

            return (
              <span
                key={link.id}
                className="inline-flex items-center gap-0.5 rounded bg-[var(--theme-bg-overlay)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--theme-text-secondary)]"
              >
                {repoName}
                {pr && (
                  <a
                    href={`https://github.com/${repoKey}/pull/${pr.number}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      'ml-0.5 inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-medium',
                      pr.state === 'merged'
                        ? 'bg-purple-500/15 text-purple-400 hover:bg-purple-500 hover:text-white'
                        : 'bg-[var(--theme-accent-muted)] text-[var(--theme-accent)] hover:bg-[var(--theme-accent)] hover:text-white',
                    )}
                    onClick={(e) => e.stopPropagation()}
                    title={pr.title}
                  >
                    <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
                    </svg>
                    #{pr.number}
                  </a>
                )}
              </span>
            );
          })}
        </div>
      )}

      {/* Row 3: status */}
      <div className="flex items-center gap-1.5 pl-3.5">
        <StatusDot status={linkedSessions.length > 0 ? status.status : 'unknown'} />
        <span className={`text-xs ${linkedSessions.length > 0 ? status.textColor : 'text-[var(--theme-text-faint)]'}`}>
          {linkedSessions.length > 0 ? status.label : 'No session'}
        </span>
        {status.warning && linkedSessions.length > 0 && (
          <span className="text-xs text-amber-400" title="Needs approval">&#9888;</span>
        )}
      </div>
    </button>
  );
}
