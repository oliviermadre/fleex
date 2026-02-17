import { useState, useEffect, useMemo, useCallback } from 'react';
import type { Ticket, TicketStatus, TicketPriority, Worktree } from '@asm/shared';
import { TICKET_STATUSES, TICKET_STATUS_LABELS, TICKET_PRIORITIES } from '@asm/shared';
import { useTicketStore } from '../../stores/ticketStore';
import { useSettingsStore } from '../../stores/settingsStore';
import * as api from '../../services/api';
import { PriorityIndicator } from './PriorityIndicator';
import { cn } from '../../lib/cn';

export function TicketMetaSidebar({
  ticket,
  onOpenSession,
  loading,
}: {
  ticket: Ticket;
  onOpenSession: () => void;
  loading?: boolean;
}) {
  const updateTicket = useTicketStore((s) => s.updateTicket);
  const deleteTicket = useTicketStore((s) => s.deleteTicket);
  const addLink = useTicketStore((s) => s.addLink);
  const removeLink = useTicketStore((s) => s.removeLink);
  const boards = useTicketStore((s) => s.boards);

  const handleStatusChange = (status: TicketStatus) => {
    updateTicket(ticket.id, { status });
  };

  const handlePriorityChange = (priority: TicketPriority) => {
    updateTicket(ticket.id, { priority });
  };

  const handleDelete = () => {
    if (confirm('Delete this ticket?')) {
      deleteTicket(ticket.id);
    }
  };

  // Derive current repo from repository links or worktree links
  const worktreeLink = ticket.links.find((l) => l.type === 'worktree');
  const repoLink = ticket.links.find((l) => l.type === 'repository');
  const linkedRepo = useMemo(() => {
    // Repository link takes priority (explicit selection)
    if (repoLink) {
      const slashIdx = repoLink.ref.indexOf('/');
      if (slashIdx > 0) {
        return { org: repoLink.ref.substring(0, slashIdx), name: repoLink.ref.substring(slashIdx + 1) };
      }
    }
    // Fallback: derive from worktree link (ref format: "org/name:branch")
    if (worktreeLink) {
      const colonIdx = worktreeLink.ref.indexOf(':');
      if (colonIdx > 0) {
        const repoKey = worktreeLink.ref.substring(0, colonIdx);
        const slashIdx = repoKey.indexOf('/');
        if (slashIdx > 0) {
          return { org: repoKey.substring(0, slashIdx), name: repoKey.substring(slashIdx + 1) };
        }
      }
    }
    return null;
  }, [repoLink, worktreeLink]);

  return (
    <div className="flex w-[280px] flex-shrink-0 flex-col gap-5 border-l border-[var(--theme-border)] p-4 overflow-y-auto">
      {/* Status */}
      <div>
        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
          Status
        </label>
        <div className="flex flex-wrap gap-1">
          {(TICKET_STATUSES as readonly TicketStatus[]).map((s) => (
            <button
              key={s}
              className={cn(
                'rounded-md px-2 py-1 text-[10px] font-medium transition-colors',
                ticket.status === s
                  ? 'bg-[var(--theme-accent)] text-white'
                  : 'bg-[var(--theme-bg-overlay)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]',
              )}
              onClick={() => handleStatusChange(s)}
            >
              {TICKET_STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      {/* Board */}
      {boards.length > 1 && (
        <div>
          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
            Board
          </label>
          <select
            className="w-full rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-2 py-1 text-xs text-[var(--theme-text-primary)] focus:border-[var(--theme-accent)] focus:outline-none"
            value={ticket.boardId}
            onChange={(e) => updateTicket(ticket.id, { boardId: e.target.value })}
          >
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.emoji} {b.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Priority */}
      <div>
        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
          Priority
        </label>
        <div className="flex gap-1">
          {(TICKET_PRIORITIES as readonly TicketPriority[]).map((p) => (
            <button
              key={p}
              className={cn(
                'flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition-colors',
                ticket.priority === p
                  ? 'bg-[var(--theme-bg-hover)] text-[var(--theme-text-primary)] ring-1 ring-[var(--theme-accent)]'
                  : 'bg-[var(--theme-bg-overlay)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]',
              )}
              onClick={() => handlePriorityChange(p)}
            >
              <PriorityIndicator priority={p} />
              {p === 'none' ? 'None' : p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* GitHub Issue */}
      <GitHubIssuePicker
        ticket={ticket}
        onAddLink={(link) => addLink(ticket.id, link)}
        onRemoveLink={(linkId) => removeLink(ticket.id, linkId)}
      />

      {/* Repository & Worktree */}
      <RepoWorktreePicker
        linkedRepo={linkedRepo}
        worktreeLink={worktreeLink ?? null}
        repoLink={repoLink ?? null}
        onAddLink={(link) => addLink(ticket.id, link)}
        onRemoveLink={(linkId) => removeLink(ticket.id, linkId)}
      />

      {/* Pull Requests */}
      {ticket.links.filter((l) => l.type === 'github_pr').length > 0 && (
        <div>
          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
            Pull Request
          </label>
          <div className="flex flex-col gap-1.5">
            {ticket.links.filter((l) => l.type === 'github_pr').map((pr) => (
              <a
                key={pr.id}
                href={pr.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-md border border-purple-500/20 bg-purple-500/[0.06] px-2 py-1.5 text-xs transition-colors hover:bg-purple-500/[0.12]"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="flex-shrink-0 text-purple-400">
                  <path d="M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218zM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5zm8-8a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5zM4.25 4a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5z" />
                </svg>
                <span className="font-medium text-purple-400">{pr.label}</span>
                <span className="ml-auto text-[10px] text-[var(--theme-text-faint)]">{pr.ref}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Tags */}
      <div>
        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
          Tags
        </label>
        <div className="flex flex-wrap gap-1">
          {ticket.tags.map((tag: string) => (
            <span
              key={tag}
              className="flex items-center gap-1 rounded bg-[var(--theme-bg-overlay)] px-1.5 py-0.5 text-[10px] text-[var(--theme-text-secondary)]"
            >
              {tag}
              <button
                className="text-[var(--theme-text-faint)] hover:text-[var(--theme-danger)]"
                onClick={() => {
                  updateTicket(ticket.id, { tags: ticket.tags.filter((t: string) => t !== tag) });
                }}
              >
                ×
              </button>
            </span>
          ))}
          <TagInput
            onAdd={(tag) => {
              if (!ticket.tags.includes(tag)) {
                updateTicket(ticket.id, { tags: [...ticket.tags, tag] });
              }
            }}
          />
        </div>
      </div>

      {/* Blocked */}
      <div className="flex items-center gap-2">
        <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
          Blocked
        </label>
        <button
          className={cn(
            'h-4 w-7 rounded-full transition-colors',
            ticket.blocked ? 'bg-red-500' : 'bg-[var(--theme-bg-overlay)]',
          )}
          onClick={() => updateTicket(ticket.id, { blocked: !ticket.blocked })}
        >
          <span
            className={cn(
              'block h-3 w-3 rounded-full bg-white transition-transform',
              ticket.blocked ? 'translate-x-3.5' : 'translate-x-0.5',
            )}
          />
        </button>
      </div>

      {/* Other Links (non-worktree, non-repository, non-PR) */}
      {ticket.links.filter((l) => l.type !== 'worktree' && l.type !== 'repository' && l.type !== 'github_pr').length > 0 && (
        <div>
          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
            Links
          </label>
          <div className="flex flex-col gap-1">
            {ticket.links.filter((l) => l.type !== 'worktree' && l.type !== 'repository' && l.type !== 'github_pr').map((link) => (
              <div key={link.id} className="flex items-center gap-2 text-xs">
                <span className="rounded bg-[var(--theme-bg-overlay)] px-1 py-0.5 text-[9px] font-medium text-[var(--theme-text-muted)]">
                  {link.type.replace('_', ' ')}
                </span>
                {link.url ? (
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 truncate text-[var(--theme-accent)] hover:underline"
                  >
                    {link.label}
                  </a>
                ) : (
                  <span className="flex-1 truncate text-[var(--theme-text-secondary)]">{link.label}</span>
                )}
                <button
                  className="text-[var(--theme-text-faint)] hover:text-[var(--theme-danger)]"
                  onClick={() => removeLink(ticket.id, link.id)}
                  title="Remove link"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="mt-auto flex flex-col gap-2 pt-4 border-t border-[var(--theme-border)]">
        <button
          className="w-full rounded-md bg-[var(--theme-accent)] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[var(--theme-accent-active)] disabled:opacity-50"
          onClick={onOpenSession}
          disabled={loading}
        >
          {loading ? 'Opening...' : 'Open Session'}
        </button>
        <button
          className="w-full rounded-md border border-[var(--theme-border)] px-3 py-1.5 text-xs text-[var(--theme-danger)] transition-colors hover:bg-red-500/10"
          onClick={handleDelete}
        >
          Delete Ticket
        </button>
      </div>
    </div>
  );
}

// ── Repository & Worktree Picker ──
// Uses resolvedRepositories from settings and fetches worktrees from filesystem via API.

interface WorktreeOption {
  org: string;
  name: string;
  branch: string;
  path: string;
  isMain: boolean;
}

function RepoWorktreePicker({
  linkedRepo,
  worktreeLink,
  repoLink,
  onAddLink,
  onRemoveLink,
}: {
  linkedRepo: { org: string; name: string } | null;
  worktreeLink: Ticket['links'][number] | null;
  repoLink: Ticket['links'][number] | null;
  onAddLink: (link: { type: string; ref: string; label: string; url?: string }) => Promise<void>;
  onRemoveLink: (linkId: string) => Promise<void>;
}) {
  const resolvedRepositories = useSettingsStore((s) => s.settings.resolvedRepositories);
  const [selectedRepo, setSelectedRepo] = useState<string | null>(
    linkedRepo ? `${linkedRepo.org}/${linkedRepo.name}` : null,
  );
  const [worktrees, setWorktrees] = useState<WorktreeOption[]>([]);
  const [loading, setLoading] = useState(false);

  // Parse resolved repositories into { org, name, key } objects
  const repos = useMemo(() => {
    return resolvedRepositories
      .map((r) => {
        const slashIdx = r.indexOf('/');
        if (slashIdx <= 0) return null;
        const org = r.substring(0, slashIdx);
        const name = r.substring(slashIdx + 1);
        return { org, name, key: r };
      })
      .filter((r): r is { org: string; name: string; key: string } => r !== null);
  }, [resolvedRepositories]);

  // Effective repo (from linked worktree or manual selection)
  const effectiveRepo = linkedRepo ? `${linkedRepo.org}/${linkedRepo.name}` : selectedRepo;

  // Whether the linked repo exists in the current configuration
  const repoInConfig = effectiveRepo ? repos.some((r) => r.key === effectiveRepo) : false;

  // Fetch worktrees from filesystem when repo selection changes
  const fetchWorktreesForRepos = useCallback(async (repoList: { org: string; name: string; key: string }[]) => {
    setLoading(true);
    try {
      const results: WorktreeOption[] = [];
      await Promise.all(
        repoList.map(async (repo) => {
          try {
            const wts: Worktree[] = await api.fetchWorktrees(repo.org, repo.name);
            for (const wt of wts) {
              if (!wt.isBare) {
                results.push({
                  org: repo.org,
                  name: repo.name,
                  branch: wt.branch,
                  path: wt.path,
                  isMain: wt.isMain,
                });
              }
            }
          } catch {
            // Skip repos that fail to fetch (e.g. not cloned yet)
          }
        }),
      );
      setWorktrees(results);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (repos.length === 0) {
      setWorktrees([]);
      return;
    }
    if (effectiveRepo) {
      const match = repos.filter((r) => r.key === effectiveRepo);
      fetchWorktreesForRepos(match.length > 0 ? match : repos);
    } else {
      fetchWorktreesForRepos(repos);
    }
  }, [repos, effectiveRepo, fetchWorktreesForRepos]);

  const handleRepoChange = async (value: string) => {
    if (value === '__all__') {
      setSelectedRepo(null);
      // Remove repository link if one exists
      if (repoLink) {
        await onRemoveLink(repoLink.id);
      }
      if (worktreeLink) {
        await onRemoveLink(worktreeLink.id);
      }
    } else {
      setSelectedRepo(value);
      // Remove old repository link, then save new one
      if (repoLink) {
        await onRemoveLink(repoLink.id);
      }
      await onAddLink({ type: 'repository', ref: value, label: value });
      // Remove worktree link if repo changed
      if (worktreeLink && linkedRepo && `${linkedRepo.org}/${linkedRepo.name}` !== value) {
        await onRemoveLink(worktreeLink.id);
      }
    }
  };

  const handleWorktreeSelect = async (wt: WorktreeOption) => {
    if (worktreeLink) {
      await onRemoveLink(worktreeLink.id);
    }
    // Remove repository link — worktree link implies the repo
    if (repoLink) {
      await onRemoveLink(repoLink.id);
    }
    const ref = `${wt.org}/${wt.name}:${wt.branch}`;
    await onAddLink({ type: 'worktree', ref, label: wt.branch });
    // Auto-set local repo state
    setSelectedRepo(`${wt.org}/${wt.name}`);
  };

  const handleClearWorktree = async () => {
    if (worktreeLink) {
      // Derive the repo from the worktree being cleared
      const colonIdx = worktreeLink.ref.indexOf(':');
      const repoKey = colonIdx > 0 ? worktreeLink.ref.substring(0, colonIdx) : null;

      await onRemoveLink(worktreeLink.id);

      // Re-add a repository link if none exists (preserve the repo selection)
      if (!repoLink && repoKey) {
        await onAddLink({ type: 'repository', ref: repoKey, label: repoKey });
      }
    }
  };

  return (
    <>
      {/* Repository */}
      <div>
        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
          Repository
        </label>
        {linkedRepo && !repoInConfig ? (
          /* Read-only: repo linked but no longer in resolved repositories */
          <div className="flex items-center gap-1.5 rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-2 py-1">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="flex-shrink-0 text-[var(--theme-text-muted)]">
              <path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5v-9z" />
            </svg>
            <span className="truncate text-xs text-[var(--theme-text-secondary)]">{linkedRepo.org}/{linkedRepo.name}</span>
          </div>
        ) : repos.length === 0 ? (
          <span className="text-[10px] text-[var(--theme-text-muted)]">No repositories configured</span>
        ) : (
          <select
            className="w-full rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-2 py-1 text-xs text-[var(--theme-text-primary)] focus:border-[var(--theme-accent)] focus:outline-none"
            value={effectiveRepo ?? '__all__'}
            onChange={(e) => handleRepoChange(e.target.value)}
          >
            <option value="__all__">All repositories</option>
            {repos.map((r) => (
              <option key={r.key} value={r.key}>
                {r.org}/{r.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Worktree */}
      <div>
        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
          Worktree
        </label>
        {worktreeLink ? (
          <div className="flex items-center gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-2 py-1">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="flex-shrink-0 text-[var(--theme-text-muted)]">
                <circle cx="5" cy="3.5" r="1.5" />
                <circle cx="8" cy="12.5" r="1.5" />
                <line x1="5" y1="5" x2="8" y2="11" />
              </svg>
              <span className="truncate text-xs text-[var(--theme-text-primary)]">{worktreeLink.label}</span>
            </div>
            {repoInConfig && (
              <button
                className="rounded p-0.5 text-[var(--theme-text-faint)] hover:text-[var(--theme-danger)]"
                onClick={handleClearWorktree}
                title="Unlink worktree"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="4" y1="4" x2="12" y2="12" />
                  <line x1="12" y1="4" x2="4" y2="12" />
                </svg>
              </button>
            )}
          </div>
        ) : loading ? (
          <span className="text-[10px] text-[var(--theme-text-muted)]">Loading worktrees...</span>
        ) : worktrees.length === 0 ? (
          <span className="text-[10px] text-[var(--theme-text-muted)]">No worktrees found</span>
        ) : (
          <select
            className="w-full rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-2 py-1 text-xs text-[var(--theme-text-primary)] focus:border-[var(--theme-accent)] focus:outline-none"
            value=""
            onChange={(e) => {
              const idx = parseInt(e.target.value, 10);
              const wt = worktrees[idx];
              if (wt) handleWorktreeSelect(wt);
            }}
          >
            <option value="" disabled>Select a worktree...</option>
            {worktrees.map((wt, i) => {
              const prefix = !effectiveRepo ? `${wt.org}/${wt.name} · ` : '';
              return (
                <option key={`${wt.org}/${wt.name}:${wt.branch}`} value={i}>
                  {prefix}{wt.branch}
                </option>
              );
            })}
          </select>
        )}
      </div>
    </>
  );
}

// ── GitHub Issue Picker ──

const GITHUB_ISSUE_RE = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)\/?$/;

function GitHubIssuePicker({
  ticket,
  onAddLink,
  onRemoveLink,
}: {
  ticket: Ticket;
  onAddLink: (link: { type: string; ref: string; label: string; url?: string }) => Promise<void>;
  onRemoveLink: (linkId: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [urlValue, setUrlValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const issueLink = ticket.links.find((l) => l.type === 'github_issue');

  const handleSave = async () => {
    const trimmed = urlValue.trim();
    setError(null);

    // If empty, just close
    if (!trimmed) {
      setEditing(false);
      return;
    }

    const match = trimmed.match(GITHUB_ISSUE_RE);
    if (!match) {
      setError('Invalid GitHub issue URL');
      return;
    }

    const [, org, name, num] = match;
    const issueNumber = parseInt(num, 10);
    const ref = `${org}/${name}#${issueNumber}`;
    const label = `#${issueNumber}`;

    setLoading(true);
    try {
      // Remove existing github_issue link first
      if (issueLink) {
        await onRemoveLink(issueLink.id);
      }
      await onAddLink({ type: 'github_issue', ref, label, url: trimmed });
      setEditing(false);
      setUrlValue('');
    } catch (err) {
      setError('Failed to save link');
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async () => {
    if (issueLink) {
      await onRemoveLink(issueLink.id);
    }
  };

  return (
    <div>
      <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
        GitHub Issue
      </label>
      {issueLink && !editing ? (
        <div className="flex items-center gap-2">
          <a
            href={issueLink.url ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-2 py-1.5 text-xs transition-colors hover:bg-[var(--theme-bg-hover)]"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="flex-shrink-0 text-[var(--theme-text-secondary)]">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            <span className="truncate font-medium text-[var(--theme-text-primary)]">{issueLink.ref}</span>
          </a>
          <button
            className="rounded p-0.5 text-[var(--theme-text-faint)] hover:text-[var(--theme-text-secondary)]"
            onClick={() => {
              setUrlValue(issueLink.url ?? '');
              setEditing(true);
            }}
            title="Edit GitHub issue link"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" />
            </svg>
          </button>
          <button
            className="rounded p-0.5 text-[var(--theme-text-faint)] hover:text-[var(--theme-danger)]"
            onClick={handleRemove}
            title="Remove GitHub issue link"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="4" y1="4" x2="12" y2="12" />
              <line x1="12" y1="4" x2="4" y2="12" />
            </svg>
          </button>
        </div>
      ) : editing ? (
        <div className="flex flex-col gap-1.5">
          <input
            autoFocus
            className="w-full rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-2 py-1 text-xs text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-muted)] focus:border-[var(--theme-accent)] focus:outline-none"
            placeholder="https://github.com/org/repo/issues/123"
            value={urlValue}
            onChange={(e) => { setUrlValue(e.target.value); setError(null); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave();
              if (e.key === 'Escape') { setEditing(false); setUrlValue(''); setError(null); }
            }}
            disabled={loading}
          />
          {error && (
            <span className="text-[10px] text-[var(--theme-danger)]">{error}</span>
          )}
          <div className="flex gap-1">
            <button
              className="rounded-md bg-[var(--theme-accent)] px-2 py-0.5 text-[10px] font-medium text-white transition-colors hover:bg-[var(--theme-accent-active)] disabled:opacity-50"
              onClick={handleSave}
              disabled={loading}
            >
              {loading ? 'Saving...' : 'Save'}
            </button>
            <button
              className="rounded-md bg-[var(--theme-bg-overlay)] px-2 py-0.5 text-[10px] text-[var(--theme-text-secondary)] transition-colors hover:bg-[var(--theme-bg-hover)]"
              onClick={() => { setEditing(false); setUrlValue(''); setError(null); }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          className="w-full rounded-md border border-dashed border-[var(--theme-border)] px-2 py-1.5 text-[10px] text-[var(--theme-text-muted)] transition-colors hover:border-[var(--theme-border-input)] hover:text-[var(--theme-text-secondary)]"
          onClick={() => setEditing(true)}
        >
          + Link GitHub issue
        </button>
      )}
    </div>
  );
}

// ── Tag Input ──

function TagInput({ onAdd }: { onAdd: (tag: string) => void }) {
  const [value, setValue] = useState('');
  const [active, setActive] = useState(false);

  if (!active) {
    return (
      <button
        className="rounded bg-[var(--theme-bg-overlay)] px-1.5 py-0.5 text-[10px] text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)]"
        onClick={() => setActive(true)}
      >
        + tag
      </button>
    );
  }

  return (
    <input
      autoFocus
      className="w-16 rounded border border-[var(--theme-border-input)] bg-transparent px-1 py-0.5 text-[10px] text-[var(--theme-text-primary)] focus:outline-none"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && value.trim()) {
          onAdd(value.trim());
          setValue('');
          setActive(false);
        }
        if (e.key === 'Escape') {
          setValue('');
          setActive(false);
        }
      }}
      onBlur={() => {
        if (value.trim()) onAdd(value.trim());
        setValue('');
        setActive(false);
      }}
    />
  );
}
