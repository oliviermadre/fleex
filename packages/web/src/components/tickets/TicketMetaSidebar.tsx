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

      {/* Repository & Worktree */}
      <RepoWorktreePicker
        linkedRepo={linkedRepo}
        worktreeLink={worktreeLink ?? null}
        repoLink={repoLink ?? null}
        onAddLink={(link) => addLink(ticket.id, link)}
        onRemoveLink={(linkId) => removeLink(ticket.id, linkId)}
      />

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

      {/* Favorite */}
      <div className="flex items-center gap-2">
        <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
          Favorite
        </label>
        <button
          className={cn(
            'h-4 w-7 rounded-full transition-colors',
            ticket.favorite ? 'bg-yellow-400' : 'bg-[var(--theme-bg-overlay)]',
          )}
          onClick={() => updateTicket(ticket.id, { favorite: !ticket.favorite })}
        >
          <span
            className={cn(
              'block h-3 w-3 rounded-full bg-white transition-transform',
              ticket.favorite ? 'translate-x-3.5' : 'translate-x-0.5',
            )}
          />
        </button>
      </div>

      {/* Other Links (non-worktree, non-repository) */}
      {ticket.links.filter((l) => l.type !== 'worktree' && l.type !== 'repository').length > 0 && (
        <div>
          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
            Links
          </label>
          <div className="flex flex-col gap-1">
            {ticket.links.filter((l) => l.type !== 'worktree' && l.type !== 'repository').map((link) => (
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
        {repos.length === 0 ? (
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
