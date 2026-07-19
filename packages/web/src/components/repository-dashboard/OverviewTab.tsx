import { useMemo } from 'react';
import type { RepositoryDashboardData, RepositoryStats, PullRequest, GitHubIssue } from '@fleex/shared';
import { useTicketStore } from '../../stores/ticketStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useRepositoryDashboardStore } from '../../stores/repositoryDashboardStore';
import { isRemovableVerdict } from '../../lib/worktreeVerdict';
import { cn } from '../../lib/cn';
import { tint, tintText, tintSolid, tintClasses, type TintHue } from '../../lib/tints';
import { Sparkline } from './Sparkline';
import { TicketsWorktreesPanel } from './TicketsWorktreesPanel';
import { buildWorktreeRows } from './overview-helpers';

interface Props {
  org: string;
  name: string;
  data: RepositoryDashboardData;
  stats: RepositoryStats | null;
  onNavigate: (tab: 'pulls' | 'issues') => void;
}

const CARD_SHELL = 'rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-5';

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days > 30) return `${Math.floor(days / 30)}mo`;
  if (days > 0) return `${days}d`;
  const hours = Math.floor(diff / 3600000);
  if (hours > 0) return `${hours}h`;
  const minutes = Math.floor(diff / 60000);
  return `${minutes}m`;
}

function TrendTriangle({ up }: { up: boolean }) {
  return (
    <svg width="8" height="8" viewBox="0 0 10 10" className="flex-shrink-0" style={up ? undefined : { transform: 'rotate(180deg)' }}>
      <polygon points="5,0 10,9 0,9" fill="currentColor" />
    </svg>
  );
}

function CardHeader({ hue, label }: { hue: TintHue; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-[var(--theme-text-secondary)]">
      <span className={cn('h-2 w-2 rounded-full', tintSolid(hue))} />
      {label}
    </div>
  );
}

export function OverviewTab({ org, name, data, stats, onNavigate }: Props) {
  const key = `${org}/${name}`;
  const tickets = useTicketStore((s) => s.tickets);
  const sessionGroups = useSessionStore((s) => s.sessionGroups);
  const fetchDashboard = useRepositoryDashboardStore((s) => s.fetchDashboard);

  const sessionGroup = sessionGroups.find((g) => g.repositoryOrg === org && g.repositoryName === name);
  const linkedTickets = useMemo(
    () => tickets.filter((t) => t.links.some((l) => l.type === 'repository' && l.ref.toLowerCase() === key.toLowerCase())),
    [tickets, key],
  );
  const pulls = useMemo(() => [...data.openPullRequests, ...data.recentlyMergedPullRequests], [data]);
  const rows = useMemo(
    () => buildWorktreeRows(data.worktrees, data.worktreeTickets, data.diffStats, sessionGroup, tickets, pulls),
    [data, sessionGroup, tickets, pulls],
  );

  const staleCount = useMemo(
    () => [...rows.active, ...rows.orphaned].filter((r) => isRemovableVerdict(r.verdict)).length,
    [rows],
  );

  const inProgressCount = linkedTickets.filter((t) => t.status === 'doing' || t.status === 'reviewing').length;
  const doneCount = linkedTickets.filter((t) => t.status === 'done').length;
  const activeSessions = sessionGroup?.worktrees.reduce((n, w) => n + w.sessions.length, 0) ?? 0;

  const totalCost = stats?.totalCostUsd ?? 0;
  const costPerTicket = stats?.costPerTicketUsd ?? 0;
  const trendPct = stats && stats.previousTotalCostUsd > 0
    ? Math.round(((stats.totalCostUsd - stats.previousTotalCostUsd) / stats.previousTotalCostUsd) * 100)
    : null;

  const previewPulls = useMemo(
    () => [...pulls].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5),
    [pulls],
  );
  const allIssues = useMemo(() => [...data.openIssues, ...data.recentlyClosedIssues], [data]);
  const previewIssues = useMemo(
    () => [...allIssues].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5),
    [allIssues],
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-4">
        {/* Fleex cost · 30 d */}
        <div className={CARD_SHELL}>
          <CardHeader hue="yellow" label="Fleex cost · 30 d" />
          <div className="mt-1 flex items-center gap-3">
            <span className="text-[28px] font-bold leading-tight text-[var(--theme-text-primary)]">${totalCost.toFixed(0)}</span>
            <Sparkline values={stats?.dailyCosts.map((d) => d.costUsd) ?? []} />
          </div>
          <div className="text-[11px] text-[var(--theme-text-muted)]">
            ${costPerTicket.toFixed(2)} / ticket
            {trendPct !== null && (
              <span className={cn('ml-2 inline-flex items-center gap-1', tintText(trendPct >= 0 ? 'red' : 'green'))}>
                <TrendTriangle up={trendPct >= 0} />
                {Math.abs(trendPct)}%
              </span>
            )}
          </div>
        </div>

        {/* Tickets */}
        <div className={CARD_SHELL}>
          <CardHeader hue="indigo" label="Tickets" />
          <div className="mt-1 text-[28px] font-bold leading-tight text-[var(--theme-text-primary)]">
            {inProgressCount} <span className="text-sm font-normal text-[var(--theme-text-secondary)]">in progress</span>
          </div>
          <div className="text-[11px] text-[var(--theme-text-muted)]">
            {doneCount} done · {activeSessions} active sessions
          </div>
        </div>

        {/* GitHub */}
        <div className={CARD_SHELL}>
          <CardHeader hue="orange" label="GitHub" />
          <div className="mt-1 text-[28px] font-bold leading-tight text-[var(--theme-text-primary)]">
            {data.openPullRequests.length} <span className="text-sm font-normal text-[var(--theme-text-secondary)]">open PRs</span>
          </div>
          <div className="text-[11px] text-[var(--theme-text-muted)]">
            {data.openIssues.length} issues · {data.recentlyMergedPullRequests.length} merged (7 d)
          </div>
        </div>

        {/* Worktrees */}
        <div className={cn('rounded-xl border bg-[var(--theme-bg-surface)] p-5', staleCount > 0 ? tintClasses('red').borderColor : 'border-[var(--theme-border)]')}>
          <CardHeader hue="teal" label="Worktrees" />
          <div className="mt-1 text-[28px] font-bold leading-tight text-[var(--theme-text-primary)]">
            {rows.active.length + rows.orphaned.length}
          </div>
          {staleCount > 0 ? (
            <div className="flex items-center gap-2 text-[11px]">
              <span className={tintText('red')}>{staleCount} stale</span>
              <button
                type="button"
                className={cn('hover:underline', tintText('red'))}
                onClick={() => (document.getElementById('orphaned-worktrees') ?? document.getElementById('tickets-worktrees-panel'))?.scrollIntoView({ behavior: 'smooth' })}
              >
                Clean up now →
              </button>
            </div>
          ) : (
            <div className="text-[11px] text-[var(--theme-text-muted)]">all tracked</div>
          )}
        </div>
      </div>

      <TicketsWorktreesPanel org={org} name={name} rows={rows} onDeleted={() => fetchDashboard(org, name)} />

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg-surface)]">
          <div className="flex items-center justify-between border-b border-[var(--theme-border)] px-5 py-3">
            <span className="text-sm font-semibold">Pull requests</span>
            <button
              type="button"
              onClick={() => onNavigate('pulls')}
              className="text-xs text-[var(--theme-accent)] hover:underline"
            >
              {data.openPullRequests.length} →
            </button>
          </div>
          {previewPulls.length === 0 ? (
            <div className="py-8 text-center text-sm text-[var(--theme-text-muted)]">None open</div>
          ) : (
            previewPulls.map((pr: PullRequest) => (
              <div
                key={`${pr.state}-${pr.number}`}
                className="cursor-pointer border-b border-[var(--theme-border-subtle)] px-5 py-3 last:border-0 hover:bg-[var(--theme-bg-hover)]"
                onClick={() => window.open(`https://github.com/${org}/${name}/pull/${pr.number}`, '_blank')}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="font-mono text-xs text-[var(--theme-text-muted)]">#{pr.number}</span>
                  <span className="truncate text-[13.5px] font-semibold text-[var(--theme-text-primary)]">{pr.title}</span>
                </div>
                <div className="font-mono text-[11px] text-[var(--theme-text-muted)]">
                  {pr.headRefName} · {formatRelativeTime(pr.updatedAt)}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg-surface)]">
          <div className="flex items-center justify-between border-b border-[var(--theme-border)] px-5 py-3">
            <span className="text-sm font-semibold">Recent issues</span>
            <button
              type="button"
              onClick={() => onNavigate('issues')}
              className="text-xs text-[var(--theme-accent)] hover:underline"
            >
              {data.openIssues.length} →
            </button>
          </div>
          {previewIssues.length === 0 ? (
            <div className="py-8 text-center text-sm text-[var(--theme-text-muted)]">None open</div>
          ) : (
            previewIssues.map((issue: GitHubIssue) => (
              <div
                key={`${issue.state}-${issue.number}`}
                className="cursor-pointer border-b border-[var(--theme-border-subtle)] px-5 py-3 last:border-0 hover:bg-[var(--theme-bg-hover)]"
                onClick={() => window.open(`https://github.com/${org}/${name}/issues/${issue.number}`, '_blank')}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="font-mono text-xs text-[var(--theme-text-muted)]">#{issue.number}</span>
                  <span className="truncate text-[13.5px] font-semibold text-[var(--theme-text-primary)]">{issue.title}</span>
                </div>
                <div className="font-mono text-[11px] text-[var(--theme-text-muted)]">
                  {issue.author} · {formatRelativeTime(issue.updatedAt)}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
