import { cn } from '../../lib/cn';
import { getPrBadgeClasses } from '../../lib/prBadgeStyle';

/**
 * The single, shared GitHub Pull Request badge used across the app (worktree
 * header, worktrees panel/tab, sidebar worktree groups, cockpit, PR lists).
 * A clickable pill coloured by PR state (open=green, merged=purple,
 * closed=red, draft=gray) with a hover-solid affordance, opening the PR on
 * GitHub in a new tab. `pr` is typed structurally so PullRequest,
 * DashboardPullRequest and inline `{org,name,...}` link objects all fit.
 */
interface Props {
  org: string;
  name: string;
  pr: { number: number; state: 'open' | 'merged' | 'closed'; isDraft?: boolean; title?: string };
  className?: string;
}

export function PrBadge({ org, name, pr, className }: Props) {
  return (
    <a
      href={`https://github.com/${org}/${name}/pull/${pr.number}`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      title={pr.title}
      className={cn(
        'inline-flex flex-shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10.5px] transition-colors',
        getPrBadgeClasses(pr),
        className,
      )}
    >
      <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" className="flex-shrink-0">
        <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
      </svg>
      {name}#{pr.number}
    </a>
  );
}
