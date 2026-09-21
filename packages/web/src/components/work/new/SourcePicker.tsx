import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  githubIssueSource,
  githubPrSource,
  type BrowseIssue,
  type BrowsePullRequest,
  type SourceMatch,
} from '@fleex/shared';
import { fetchImportBrowseInbox, fetchImportBrowseRepo } from '../../../services/api';
import { useRepositoryStore } from '../../../stores/repositoryStore';
import { useTicketStore } from '../../../stores/ticketStore';
import { useWorkStore } from '../../../stores/workStore';
import { topReposForBoard } from '../../../lib/repoStatus';
import { formatAge } from '../../../lib/formatAge';
import { cn } from '../../../lib/cn';
import { repoOptions } from './draftOptions';
import { useBrowseResource } from './useBrowseResource';
import { BrowseRow, RowChip, Keys, IssueGlyph, PullRequestGlyph } from './BrowseRow';
import { RepoPicker } from './RepoPicker';
import { NewTaskCard } from './NewTaskCard';

export type GitHubBrowseKind = 'issues' | 'prs';
type Tab = 'review' | 'mine' | 'repo';
type Row = (BrowseIssue | BrowsePullRequest) & { kind: GitHubBrowseKind };

export const INBOX_KEY = 'inbox';

/**
 * Pick a GitHub issue or pull request without having its link: what is mine
 * first, then any repo. The filter field keeps the focus the whole time, so it
 * is one continuous gesture — type to narrow, ↑↓ to move, ↵ to import, Esc back.
 *
 * A row already imported opens its ticket instead of importing it twice.
 */
export function SourcePicker({
  kind,
  onBack,
  onImport,
  onOpenTicket,
  disabled = false,
}: {
  kind: GitHubBrowseKind;
  onBack: () => void;
  onImport: (match: SourceMatch) => void;
  onOpenTicket: (ticketId: string) => void;
  /** Frozen backdrop while the chosen row resolves on top. */
  disabled?: boolean;
}) {
  const isPr = kind === 'prs';
  const [tab, setTab] = useState<Tab>(isPr ? 'review' : 'mine');
  const [filter, setFilter] = useState('');
  const [active, setActive] = useState(0);
  const [showBots, setShowBots] = useState(false);
  const [repoKey, setRepoKey] = useState('');
  const [repoListOpen, setRepoListOpen] = useState(false);
  const filterRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Repos, the board's most used first — the same ranking as the composer.
  const repositories = useRepositoryStore((s) => s.repositories);
  const fetchRepositories = useRepositoryStore((s) => s.fetchRepositories);
  const tickets = useTicketStore((s) => s.tickets);
  const boardId = useWorkStore((s) => s.draft.boardId);
  useEffect(() => {
    fetchRepositories();
  }, [fetchRepositories]);
  const repoChoices = useMemo(
    () =>
      repoOptions(
        repositories.map((r) => `${r.org}/${r.name}`),
        boardId ? topReposForBoard(tickets, boardId, { limit: Infinity }) : [],
      ),
    [repositories, tickets, boardId],
  );
  // Land on a useful list rather than an empty tab: the board's first repo.
  const effectiveRepoKey = repoKey || repoChoices[0]?.value || '';

  const inbox = useBrowseResource(INBOX_KEY, fetchImportBrowseInbox);
  const [org, name] = effectiveRepoKey.split('/');
  const repo = useBrowseResource(tab === 'repo' && org && name ? `repo:${effectiveRepoKey}` : null, () =>
    fetchImportBrowseRepo(org!, name!),
  );
  const source = tab === 'repo' ? repo : inbox;

  const rows: Row[] = useMemo(() => {
    const tag = (list: readonly (BrowseIssue | BrowsePullRequest)[] | undefined): Row[] =>
      (list ?? []).map((r) => ({ ...r, kind }));
    if (tab === 'repo') return tag(isPr ? repo.data?.pullRequests : repo.data?.issues);
    if (!isPr) return tag(inbox.data?.issues);
    return tag(tab === 'review' ? inbox.data?.reviewRequests : inbox.data?.myPullRequests);
  }, [tab, isPr, kind, inbox.data, repo.data]);

  const hiddenBots = isPr && tab === 'repo' ? rows.filter((r) => 'isBot' in r && r.isBot).length : 0;
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return rows.filter((r) => {
      if (hiddenBots > 0 && !showBots && 'isBot' in r && r.isBot) return false;
      if (!q) return true;
      const pr = 'headRefName' in r ? `${r.headRefName} ${r.author}` : '';
      return `${r.title} #${r.number} ${r.org}/${r.name} ${pr}`.toLowerCase().includes(q);
    });
  }, [rows, filter, showBots, hiddenBots]);

  const activeIndex = Math.min(active, Math.max(visible.length - 1, 0));
  useEffect(() => {
    rowRefs.current[activeIndex]?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex]);
  useEffect(() => {
    if (!disabled) filterRef.current?.focus();
  }, [disabled, tab]);

  function choose(row: Row | undefined) {
    if (!row) return;
    if (row.linkedTicket) return onOpenTicket(row.linkedTicket.id);
    const from = row.kind === 'prs' ? githubPrSource : githubIssueSource;
    onImport(from.fromParts(row.org, row.name, row.number));
  }

  function switchTab(next: Tab) {
    setTab(next);
    setActive(0);
    setFilter('');
  }

  function onKeyDown(e: KeyboardEvent) {
    if (repoListOpen) return; // the repo list owns the keyboard while it is open
    if (e.key === 'Escape') {
      e.preventDefault();
      if (filter) setFilter('');
      else onBack();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (visible.length === 0) return;
      e.preventDefault();
      setActive((activeIndex + (e.key === 'ArrowDown' ? 1 : -1) + visible.length) % visible.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(visible[activeIndex]);
    }
  }

  const tabs: { id: Tab; label: string; count?: number }[] = isPr
    ? [
        { id: 'review', label: 'To review', count: inbox.data?.reviewRequests.length },
        { id: 'mine', label: 'Mine', count: inbox.data?.myPullRequests.length },
        { id: 'repo', label: 'By repo' },
      ]
    : [
        { id: 'mine', label: 'Mine', count: inbox.data?.issues.length },
        { id: 'repo', label: 'By repo' },
      ];

  const grouped = tab !== 'repo';
  const current = visible[activeIndex];

  return (
    <NewTaskCard disabled={disabled} onKeyDown={onKeyDown}>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="flex h-7 w-7 items-center justify-center rounded-[7px] text-[16px] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-overlay)] hover:text-[var(--theme-text-primary)]"
        >
          ←
        </button>
        <span className="font-mono text-[11px] font-semibold tracking-[0.16em] text-[var(--theme-accent)]">GITHUB</span>
        <h2 className="text-[17px] font-semibold text-[var(--theme-text-primary)]">
          {isPr ? 'Pick a pull request' : 'Pick an issue'}
        </h2>
      </div>

      <div role="tablist" className="mt-[18px] flex gap-0.5 border-b border-[var(--theme-border)]">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => switchTab(t.id)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-[13px] transition-colors',
              tab === t.id
                ? 'border-[var(--theme-accent)] text-[var(--theme-text-primary)]'
                : 'border-transparent text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)]',
            )}
          >
            {t.label}
            {t.count !== undefined && <span className="ml-1.5 font-mono text-[11px] text-[var(--theme-text-muted)]">{t.count}</span>}
          </button>
        ))}
      </div>

      <div className="mt-3.5 flex h-[38px] gap-2">
        {tab === 'repo' && (
          <RepoPicker
            value={effectiveRepoKey}
            options={repoChoices}
            onOpenChange={setRepoListOpen}
            onChange={(key) => {
              setRepoKey(key);
              setActive(0);
            }}
          />
        )}
        <input
          ref={filterRef}
          value={filter}
          disabled={disabled}
          onChange={(e) => {
            setFilter(e.target.value);
            setActive(0);
          }}
          placeholder={isPr ? 'Filter by title, number, branch or author…' : 'Filter by title, number or repo…'}
          aria-label="Filter"
          className="min-w-0 flex-1 rounded-[9px] border border-[var(--theme-border-input)] bg-[var(--theme-bg-base)] px-3 text-[13.5px] text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-muted)] focus:border-[var(--theme-accent)] focus:outline-none"
        />
        {hiddenBots > 0 && (
          <button
            type="button"
            aria-pressed={!showBots}
            onClick={() => {
              setShowBots((v) => !v);
              setActive(0);
            }}
            className={cn(
              'shrink-0 whitespace-nowrap rounded-[9px] border px-3 text-[12px] transition-colors',
              showBots
                ? 'border-[var(--theme-border)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]'
                : 'border-[var(--theme-accent)] bg-[var(--theme-accent-muted)] text-[var(--theme-text-primary)]',
            )}
          >
            {showBots ? 'Showing bots' : `Bots hidden · ${hiddenBots}`}
          </button>
        )}
      </div>

      <div role="listbox" aria-label={isPr ? 'Pull requests' : 'Issues'} className="mt-2.5 max-h-[21rem] min-h-[12rem] flex-1 overflow-y-auto">
        {source.data === null && source.loading && <SkeletonRows />}
        {source.data === null && source.error && (
          <StateMessage title="GitHub didn't answer." detail={source.error}>
            <StateButton onClick={() => void source.retry()}>Try again</StateButton>
          </StateMessage>
        )}
        {source.data !== null && visible.length === 0 && (
          <EmptyState
            filter={filter}
            tab={tab}
            isPr={isPr}
            hasRepo={!!effectiveRepoKey}
            onClearFilter={() => setFilter('')}
            onBrowseRepo={() => switchTab('repo')}
          />
        )}
        {visible.map((row, i) => (
          <div key={`${row.org}/${row.name}#${row.number}`}>
            {grouped && `${row.org}/${row.name}` !== (visible[i - 1] && `${visible[i - 1]!.org}/${visible[i - 1]!.name}`) && (
              <div className={cn('px-3 pb-1 font-mono text-[11px] text-[var(--theme-text-muted)]', i === 0 ? 'pt-1' : 'pt-3.5')}>
                {row.org}/{row.name}
              </div>
            )}
            <BrowseRow
              rowRef={(el) => (rowRefs.current[i] = el)}
              role="option"
              aria-selected={i === activeIndex}
              tabIndex={-1}
              active={i === activeIndex}
              glyph={row.kind === 'prs' ? <PullRequestGlyph /> : <IssueGlyph />}
              title={row.title}
              meta={<RowMeta row={row} githubUser={inbox.data?.githubUser ?? ''} />}
              chips={
                <>
                  {'isDraft' in row && row.isDraft && <RowChip dashed>draft</RowChip>}
                  {row.linkedTicket && <RowChip>↗ ticket #{row.linkedTicket.displayId}</RowChip>}
                </>
              }
              trailing={formatAge(row.updatedAt)}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(row)}
            />
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-3.5 border-t border-[var(--theme-border)] pt-3.5 text-[12px] text-[var(--theme-text-muted)]">
        <span className="hidden flex-wrap gap-3.5 sm:flex">
          <Keys keys={['↑', '↓']} label="move" />
          <Keys keys={['↵']} label={current?.linkedTicket ? 'open ticket' : 'import'} />
          <Keys keys={['esc']} label="back" />
        </span>
        <span className="ml-auto font-mono text-[11px] text-[var(--theme-text-faint)]">
          <Freshness fetchedAt={source.data?.fetchedAt} refreshing={source.loading || source.data?.stale === true} failed={!!source.data && !!source.error} />
        </span>
      </div>
    </NewTaskCard>
  );
}

function RowMeta({ row, githubUser }: { row: Row; githubUser: string }) {
  const number = <span className="font-medium text-[var(--theme-text-secondary)]">#{row.number}</span>;
  if ('headRefName' in row) {
    return (
      <>
        {number} · {row.headRefName} · @{row.author}
      </>
    );
  }
  const mine = row.assignees.includes(githubUser) ? 'assigned to you' : row.author === githubUser ? 'opened by you' : `@${row.author}`;
  return (
    <>
      {number} · {mine}
    </>
  );
}

function Freshness({ fetchedAt, refreshing, failed }: { fetchedAt?: string; refreshing: boolean; failed: boolean }) {
  if (!fetchedAt) return <>{refreshing ? 'loading…' : ''}</>;
  const age = `updated ${formatAge(fetchedAt)} ago`;
  if (failed) return <>{age} · refresh failed</>;
  return <>{refreshing ? `${age} · refreshing` : age}</>;
}

function EmptyState({
  filter,
  tab,
  isPr,
  hasRepo,
  onClearFilter,
  onBrowseRepo,
}: {
  filter: string;
  tab: Tab;
  isPr: boolean;
  hasRepo: boolean;
  onClearFilter: () => void;
  onBrowseRepo: () => void;
}) {
  if (filter.trim()) {
    return (
      <StateMessage title={`Nothing matches “${filter.trim()}”.`} detail="The filter looks at titles, numbers, repos, branches and authors.">
        <StateButton onClick={onClearFilter}>Clear filter</StateButton>
      </StateMessage>
    );
  }
  if (tab === 'repo') {
    return hasRepo ? (
      <StateMessage title={isPr ? 'No open pull request in this repo.' : 'No open issue in this repo.'} detail="Pick another repo above." />
    ) : (
      <StateMessage title="No repo is set up in Fleex yet." detail="Add one from the Repos view, or paste a link instead." />
    );
  }
  const title = !isPr ? 'No open issue is yours.' : tab === 'review' ? 'No one is waiting on your review.' : 'You have no open pull request.';
  return (
    <StateMessage title={title} detail={isPr ? 'You can still pick any open pull request from a repo.' : 'You can still pick any open issue from a repo.'}>
      <StateButton onClick={onBrowseRepo}>Browse a repo</StateButton>
    </StateMessage>
  );
}

function StateMessage({ title, detail, children }: { title: string; detail: string; children?: ReactNode }) {
  return (
    <div className="px-3 py-9 text-center">
      <p className="text-[14px] text-[var(--theme-text-secondary)]">{title}</p>
      <p className="mb-3.5 mt-1 text-[12.5px] text-[var(--theme-text-muted)]">{detail}</p>
      {children}
    </div>
  );
}

function StateButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-[var(--theme-border-input)] px-3.5 py-1.5 text-[13px] text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-overlay)]"
    >
      {children}
    </button>
  );
}

function SkeletonRows() {
  return (
    <div aria-label="Loading" role="status">
      {[72, 58, 80, 46].map((w) => (
        <div key={w} className="flex gap-3.5 p-3">
          <span className="h-2.5 w-[18px] animate-pulse rounded bg-[var(--theme-bg-overlay)] motion-reduce:animate-none" />
          <span className="flex-1">
            <span className="block h-2.5 animate-pulse rounded bg-[var(--theme-bg-overlay)] motion-reduce:animate-none" style={{ width: `${w}%` }} />
            <span className="mt-2 block h-2.5 animate-pulse rounded bg-[var(--theme-bg-overlay)] opacity-60 motion-reduce:animate-none" style={{ width: `${w / 2}%` }} />
          </span>
        </div>
      ))}
    </div>
  );
}
