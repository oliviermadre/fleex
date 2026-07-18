import { useState, useEffect, useMemo, useCallback } from 'react';
import type { RepoDiscovery } from '@fleex/shared';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useSettingsStore } from '../../stores/settingsStore';
import * as api from '../../services/api';
import { cn } from '../../lib/cn';
import { tintClasses, tintText } from '../../lib/tints';

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days > 30) return `${Math.floor(days / 30)}mo ago`;
  if (days > 0) return `${days}d ago`;
  const hours = Math.floor(diff / 3600000);
  if (hours > 0) return `${hours}h ago`;
  return `${Math.floor(diff / 60000)}m ago`;
}

function Toggle({ on, disabled, label, onChange }: { on: boolean; disabled?: boolean; label: string; onChange?: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={cn(
        'relative h-[19px] w-[34px] rounded-full transition-colors',
        on ? 'bg-[var(--theme-accent)]' : 'bg-[var(--theme-bg-overlay)]',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <span className={cn(
        'absolute top-[2.5px] h-[14px] w-[14px] rounded-full bg-white transition-[left] duration-150',
        on ? 'left-[17px]' : 'left-[3px]',
      )} />
    </button>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}

export function AddRepositoriesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const tracked = useSettingsStore((s) => s.settings.repositories);
  const addRepositories = useSettingsStore((s) => s.addRepositories);
  const trackedSet = useMemo(() => new Set(tracked.map((r) => r.toLowerCase())), [tracked]);

  const [discovery, setDiscovery] = useState<RepoDiscovery | null>(null);
  const [discoveryError, setDiscoveryError] = useState(false);
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [freeform, setFreeform] = useState('');
  const [freeformHint, setFreeformHint] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const loadDiscovery = useCallback(() => {
    setDiscoveryError(false);
    api.fetchGithubDiscovery().then(setDiscovery).catch(() => setDiscoveryError(true));
  }, []);

  useEffect(() => {
    if (open) { loadDiscovery(); setSelection(new Set()); setQuery(''); setFreeform(''); setFreeformHint(null); }
  }, [open, loadDiscovery]);

  const normalizedQuery = query.trim().toLowerCase();

  const filteredOwners = useMemo(() => {
    if (!discovery) return [];
    if (!normalizedQuery) return discovery.owners;
    return discovery.owners
      .map((owner) => ({
        ...owner,
        repos: owner.repos.filter((repo) => repo.nameWithOwner.toLowerCase().includes(normalizedQuery)),
      }))
      .filter((owner) => owner.repos.length > 0);
  }, [discovery, normalizedQuery]);

  const totalMatches = useMemo(
    () => filteredOwners.reduce((sum, owner) => sum + owner.repos.length, 0),
    [filteredOwners],
  );

  const toggle = useCallback((repo: string) => {
    const key = repo.toLowerCase();
    if (trackedSet.has(key)) return;
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, [trackedSet]);

  const selectAll = useCallback((owner: RepoDiscovery['owners'][number]) => {
    setSelection((prev) => {
      const next = new Set(prev);
      for (const repo of owner.repos) {
        const key = repo.nameWithOwner.toLowerCase();
        if (!trackedSet.has(key)) next.add(key);
      }
      return next;
    });
  }, [trackedSet]);

  const handleVerify = useCallback(async () => {
    const repo = freeform.trim().toLowerCase();
    setVerifying(true);
    setFreeformHint(null);
    try {
      const result = await api.verifyGithubRepo(repo);
      if (result.exists) {
        const nameWithOwner = (result.nameWithOwner ?? repo).toLowerCase();
        if (trackedSet.has(nameWithOwner)) {
          setFreeformHint('already tracked');
        } else {
          setSelection((prev) => new Set(prev).add(nameWithOwner));
          setFreeform('');
          setFreeformHint(null);
        }
      } else {
        setFreeformHint('Repository not found');
      }
    } finally {
      setVerifying(false);
    }
  }, [freeform, trackedSet]);

  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    try {
      await addRepositories([...selection]);
      setSelection(new Set());
      onClose();
    } finally {
      setSubmitting(false);
    }
  }, [addRepositories, selection, onClose]);

  const selectionCount = selection.size;
  const selectionList = useMemo(() => [...selection], [selection]);
  const recap = selectionCount === 0
    ? 'Select repos to track'
    : `${selectionCount} repo${selectionCount === 1 ? '' : 's'} to add · ${selectionList.slice(0, 3).join(', ')}${selectionCount > 3 ? `, +${selectionCount - 3} more` : ''}`;

  const isFreeformValid = REPO_RE.test(freeform.trim());

  const totalOwners = discovery?.owners.length ?? 0;
  const totalRepos = discovery?.totalRepos ?? 0;

  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-3xl">
      <div>
        <h2 className="text-sm font-semibold text-[var(--theme-text-primary)]">Add repositories</h2>
        <p className="mt-1 text-xs text-[var(--theme-text-secondary)]">
          Organizations detected via <code>gh</code> — {totalOwners} orgs, {totalRepos} accessible repos
        </p>
      </div>

      {discoveryError ? (
        <div className="mt-6 flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-[var(--theme-text-secondary)]">GitHub CLI not authenticated or unavailable</p>
          <Button size="sm" onClick={loadDiscovery}>Retry</Button>
        </div>
      ) : !discovery ? (
        <div className="mt-6 py-10 text-center text-sm text-[var(--theme-text-secondary)]">Loading…</div>
      ) : (
        <>
          <div className="mt-4 flex items-center gap-2">
            <div className="relative flex-1">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--theme-text-muted)]">
                <SearchIcon />
              </span>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search repositories…"
                className={cn(
                  'w-full rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] py-1.5 pl-8 pr-3 text-sm text-[var(--theme-text-primary)]',
                  'placeholder:text-[var(--theme-text-muted)]',
                  'focus:border-[var(--theme-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)]',
                )}
              />
            </div>
            <span className="shrink-0 text-xs text-[var(--theme-text-muted)]">
              {totalMatches} result{totalMatches === 1 ? '' : 's'}
            </span>
          </div>

          <div className="mt-3 max-h-[50vh] overflow-y-auto rounded-md border border-[var(--theme-border)]">
            {filteredOwners.length === 0 ? (
              <div className="py-8 text-center text-sm text-[var(--theme-text-secondary)]">No repositories match your search.</div>
            ) : (
              filteredOwners.map((owner) => {
                const ownerTrackedCount = owner.repos.filter((r) => trackedSet.has(r.nameWithOwner.toLowerCase())).length;
                return (
                  <div key={owner.login} className="border-b border-[var(--theme-border)] last:border-b-0">
                    <div className="flex items-center justify-between bg-[var(--theme-bg-overlay)] px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--theme-text-primary)]">{owner.login}</span>
                        <span className="text-xs text-[var(--theme-text-muted)]">{ownerTrackedCount}/{owner.repos.length} tracked</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => selectAll(owner)}
                        className="text-xs text-[var(--theme-accent)] hover:underline"
                      >
                        Select all · <span className="font-mono">{owner.login}/*</span>
                      </button>
                    </div>
                    <div>
                      {owner.repos.map((repo) => {
                        const key = repo.nameWithOwner.toLowerCase();
                        const isTracked = trackedSet.has(key);
                        const isSelected = selection.has(key);
                        return (
                          <div
                            key={repo.nameWithOwner}
                            className={cn(
                              'flex items-center justify-between px-3 py-2',
                              isSelected && cn('border', tintClasses('purple').borderColor, tintClasses('purple').bg),
                            )}
                          >
                            <div>
                              <div className="font-mono text-xs text-[var(--theme-text-primary)]">{repo.nameWithOwner}</div>
                              <div className="text-[11px] text-[var(--theme-text-muted)]">
                                {repo.visibility} · updated {formatRelativeTime(repo.updatedAt)}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {isTracked && (
                                <span className={cn('text-[11px]', tintText('green'))}>already tracked</span>
                              )}
                              <Toggle
                                on={isTracked || isSelected}
                                disabled={isTracked}
                                label={repo.nameWithOwner}
                                onChange={() => toggle(repo.nameWithOwner)}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="mt-4 rounded-md border border-[var(--theme-border)] p-3">
            <label className="text-xs font-medium text-[var(--theme-text-secondary)]">
              Repo outside your organizations? Enter its full name
            </label>
            <div className="mt-2 flex items-center gap-2">
              <input
                type="text"
                value={freeform}
                onChange={(e) => { setFreeform(e.target.value); setFreeformHint(null); }}
                placeholder="owner/repo — e.g. anthropics/claude-code"
                className={cn(
                  'flex-1 rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-3 py-1.5 text-sm text-[var(--theme-text-primary)]',
                  'placeholder:text-[var(--theme-text-muted)]',
                  'focus:border-[var(--theme-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)]',
                )}
              />
              <Button
                size="sm"
                disabled={!isFreeformValid || verifying}
                onClick={handleVerify}
              >
                Verify & add
              </Button>
            </div>
            {freeformHint && (
              <p className={cn('mt-1.5 text-xs', freeformHint === 'already tracked' ? tintText('green') : tintText('red'))}>
                {freeformHint}
              </p>
            )}
          </div>
        </>
      )}

      <div className="mt-5 flex items-center justify-between border-t border-[var(--theme-border)] pt-4">
        <span className="text-xs text-[var(--theme-text-secondary)]">{recap}</span>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            size="sm"
            disabled={selectionCount === 0 || submitting}
            onClick={handleSubmit}
          >
            Add {selectionCount} repo{selectionCount === 1 ? '' : 's'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
