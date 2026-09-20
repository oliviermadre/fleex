import { useEffect, useState } from 'react';
import {
  githubIssueSource,
  githubPrSource,
  type DashboardData,
  type DashboardGitHubIssue,
  type DashboardPullRequest,
  type PullRequest,
  type SourceMatch,
} from '@fleex/shared';
import { fetchDashboard, fetchPullRequests } from '../../../services/api';
import { useRepositoryStore } from '../../../stores/repositoryStore';
import { BusyLine } from '../../ui/Spinner';

const MAX_ROWS = 50;

interface Props {
  onImport: (match: SourceMatch) => void;
  onOpenTicket: (ticketId: string) => void;
}

/**
 * "Or browse" — for whoever doesn't have the link at hand. Three lazily-loaded
 * sections: my issues, PRs to review (both from the dashboard), and open PRs in a
 * chosen repo. A row already linked to a ticket opens that ticket instead of
 * re-importing.
 */
export function BrowseSources({ onImport, onOpenTicket }: Props) {
  return (
    <div className="mt-4 flex flex-col gap-1">
      <span className="px-1 text-[9.5px] font-semibold tracking-[0.08em] text-[var(--theme-text-muted)]">OR BROWSE</span>
      <DashboardSections onImport={onImport} onOpenTicket={onOpenTicket} />
      <OpenPullRequestsSection onImport={onImport} onOpenTicket={onOpenTicket} />
    </div>
  );
}

/** Shares one dashboard fetch across "My issues" and "Pull requests to review". */
function DashboardSections({ onImport, onOpenTicket }: Props) {
  const [open, setOpen] = useState<{ issues: boolean; review: boolean }>({ issues: false, review: false });
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needed = open.issues || open.review;
  useEffect(() => {
    // `error` gates the guard so a failed fetch stops here instead of looping:
    // `.finally` flips `loading` back to false, which re-runs this effect, and
    // without the `error` check the guard would pass again → refetch → error →
    // hammer the endpoint. `retry` clears `error` to fetch once more.
    if (!needed || data || loading || error) return;
    setLoading(true);
    setError(null);
    fetchDashboard()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [needed, data, loading, error]);

  const issues = data ? dedupeIssues([...data.myIssues, ...data.assignedIssues]).slice(0, MAX_ROWS) : [];
  const reviews = data ? data.reviewRequests.slice(0, MAX_ROWS) : [];

  const retry = () => {
    setData(null);
    setError(null);
  };

  return (
    <>
      <Section
        label="My issues"
        expanded={open.issues}
        onToggle={() => setOpen((s) => ({ ...s, issues: !s.issues }))}
      >
        {loading && <BusyLine label="Loading…" />}
        {error && <ErrorLine message={error} onRetry={retry} />}
        {!loading && !error && issues.length === 0 && <EmptyLine />}
        {!loading && !error &&
          issues.map((i) => (
            <BrowseRow
              key={`${i.org}/${i.name}#${i.number}`}
              main={`${i.org}/${i.name}#${i.number}`}
              secondary={i.title}
              linkedTicketId={i.linkedTicketId}
              onImport={() => onImport(githubIssueSource.fromParts(i.org, i.name, i.number))}
              onOpenTicket={onOpenTicket}
            />
          ))}
      </Section>

      <Section
        label="Pull requests to review"
        expanded={open.review}
        onToggle={() => setOpen((s) => ({ ...s, review: !s.review }))}
      >
        {loading && <BusyLine label="Loading…" />}
        {error && <ErrorLine message={error} onRetry={retry} />}
        {!loading && !error && reviews.length === 0 && <EmptyLine />}
        {!loading && !error &&
          reviews.map((p) => (
            <BrowseRow
              key={`${p.org}/${p.name}#${p.number}`}
              main={`${p.org}/${p.name}#${p.number}`}
              secondary={`${p.title} · @${p.author}`}
              linkedTicketId={p.linkedTicketId}
              onImport={() => onImport(githubPrSource.fromParts(p.org, p.name, p.number))}
              onOpenTicket={onOpenTicket}
            />
          ))}
      </Section>
    </>
  );
}

function OpenPullRequestsSection({ onImport, onOpenTicket }: Props) {
  const repositories = useRepositoryStore((s) => s.repositories);
  const fetchRepositories = useRepositoryStore((s) => s.fetchRepositories);
  const [expanded, setExpanded] = useState(false);
  const [repoKey, setRepoKey] = useState('');
  const [prs, setPrs] = useState<PullRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped by Retry: setting the same repoKey is a no-op React bails on, so a
  // dedicated counter is what actually re-runs the fetch.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (expanded) fetchRepositories();
  }, [expanded, fetchRepositories]);

  useEffect(() => {
    if (!repoKey) return;
    const [org, name] = repoKey.split('/');
    if (!org || !name) return;
    setLoading(true);
    setError(null);
    setPrs([]);
    fetchPullRequests(org, name)
      .then((list) => setPrs(list.filter((p) => p.state === 'open').slice(0, MAX_ROWS)))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [repoKey, attempt]);

  const [org, name] = repoKey.split('/');

  return (
    <Section label="Open pull requests in…" expanded={expanded} onToggle={() => setExpanded((v) => !v)}>
      <select
        value={repoKey}
        onChange={(e) => setRepoKey(e.target.value)}
        className="mb-1 w-full rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-base)] px-2 py-1 text-[11px] text-[var(--theme-text-primary)] focus:outline-none"
      >
        <option value="">Pick a repo…</option>
        {repositories.map((r) => (
          <option key={`${r.org}/${r.name}`} value={`${r.org}/${r.name}`}>
            {r.org}/{r.name}
          </option>
        ))}
      </select>
      {loading && <BusyLine label="Loading…" />}
      {error && <ErrorLine message={error} onRetry={() => setAttempt((a) => a + 1)} />}
      {!loading && !error && repoKey && prs.length === 0 && <EmptyLine />}
      {!loading && !error && org && name &&
        prs.map((p) => (
          <BrowseRow
            key={p.number}
            main={`#${p.number}`}
            secondary={`${p.title} · ${p.headRefName}`}
            onImport={() => onImport(githubPrSource.fromParts(org, name, p.number))}
            onOpenTicket={onOpenTicket}
          />
        ))}
    </Section>
  );
}

function Section({
  label,
  expanded,
  onToggle,
  children,
}: {
  label: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left text-[12px] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]"
      >
        <span className="text-[var(--theme-text-faint)]">{expanded ? '▾' : '▸'}</span>
        {label}
      </button>
      {expanded && <div className="flex flex-col gap-0.5 pb-1 pl-4 pr-1">{children}</div>}
    </div>
  );
}

function BrowseRow({
  main,
  secondary,
  linkedTicketId,
  onImport,
  onOpenTicket,
}: {
  main: string;
  secondary: string;
  linkedTicketId?: string;
  onImport: () => void;
  onOpenTicket: (ticketId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => (linkedTicketId ? onOpenTicket(linkedTicketId) : onImport())}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12px] hover:bg-[var(--theme-bg-hover)]"
    >
      <span className="shrink-0 font-mono text-[11px] text-[var(--theme-text-secondary)]">{main}</span>
      <span className="truncate text-[var(--theme-text-primary)]">{secondary}</span>
      {linkedTicketId && <span className="ml-auto shrink-0 text-[11px] text-[var(--theme-text-faint)]">↗ open</span>}
    </button>
  );
}

function ErrorLine({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex items-center gap-2 px-2 py-1 text-[11px] text-[var(--theme-text-muted)]">
      <span className="truncate">{message}</span>
      <button type="button" onClick={onRetry} className="shrink-0 rounded px-1.5 py-0.5 hover:bg-[var(--theme-bg-hover)]">
        Retry
      </button>
    </div>
  );
}

function EmptyLine() {
  return <div className="px-2 py-1 text-[11px] text-[var(--theme-text-faint)]">Nothing here</div>;
}

function dedupeIssues(issues: DashboardGitHubIssue[]): DashboardGitHubIssue[] {
  const seen = new Map<string, DashboardGitHubIssue>();
  for (const i of issues) {
    const key = `${i.org}/${i.name}#${i.number}`;
    if (!seen.has(key)) seen.set(key, i);
  }
  return [...seen.values()];
}

export type { DashboardPullRequest };
