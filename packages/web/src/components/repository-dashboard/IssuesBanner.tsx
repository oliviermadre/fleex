import type { GitHubIssue } from '@asm/shared';

interface Props {
  org: string;
  name: string;
  issues: GitHubIssue[];
  loading: boolean;
}

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

export function IssuesBanner({ org, name, issues, loading }: Props) {
  if (loading) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3">
        <div className="h-4 w-48 animate-pulse rounded bg-zinc-800" />
      </div>
    );
  }

  if (issues.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3">
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-emerald-400/60">
            <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
            <path d="M5 8l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-xs text-zinc-500">No issues assigned to you</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50">
      <div className="flex items-center gap-2 px-4 py-2.5">
        <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">
          Issues
        </span>
        <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
          {issues.length}
        </span>
      </div>
      <div className="px-4 pb-3">
        {issues.map((issue) => (
          <button
            key={issue.number}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-zinc-800/50"
            onClick={() => window.open(`https://github.com/${org}/${name}/issues/${issue.number}`, '_blank')}
          >
            <span className="text-zinc-500">#{issue.number}</span>
            <span className="min-w-0 flex-1 truncate text-zinc-300">{issue.title}</span>
            <span className="shrink-0 text-zinc-600">{formatRelativeTime(issue.createdAt)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
