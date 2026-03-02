import { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import type { TicketPriority } from '@asm/shared';
import { TICKET_PRIORITIES } from '@asm/shared';
import { useTicketStore } from '../../stores/ticketStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { PriorityIndicator } from './PriorityIndicator';
import { cn } from '../../lib/cn';

export function FilterDropdown() {
  const tickets = useTicketStore((s) => s.tickets);
  const filters = useTicketStore((s) => s.filters);
  const setFilters = useTicketStore((s) => s.setFilters);
  const clearFilters = useTicketStore((s) => s.clearFilters);
  const resolvedRepositories = useSettingsStore((s) => s.settings.resolvedRepositories);

  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const activeFilterCount =
    (filters.repo ? 1 : 0) +
    (filters.priority ? 1 : 0) +
    (filters.hasSession !== null ? 1 : 0) +
    (filters.tag ? 1 : 0) +
    (filters.favorite !== null ? 1 : 0);

  const { repos, tags } = useMemo(() => {
    const repoSet = new Set<string>();
    for (const r of resolvedRepositories) repoSet.add(r);
    for (const t of tickets) {
      for (const l of t.links) {
        if (l.type === 'worktree') {
          const colonIdx = l.ref.indexOf(':');
          if (colonIdx > 0) repoSet.add(l.ref.substring(0, colonIdx));
        }
      }
    }
    const tagSet = new Set<string>();
    for (const t of tickets) {
      for (const tag of t.tags) tagSet.add(tag);
    }
    return { repos: [...repoSet].sort(), tags: [...tagSet].sort() };
  }, [tickets, resolvedRepositories]);

  useEffect(() => {
    if (!open) return;
    function handleMouseDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node) &&
          buttonRef.current && !buttonRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const rect = buttonRef.current?.getBoundingClientRect();

  return (
    <>
      <button
        ref={buttonRef}
        className={cn(
          'relative flex h-8 w-8 items-center justify-center rounded-md transition-colors',
          activeFilterCount > 0
            ? 'bg-[var(--theme-accent)]/15 text-[var(--theme-accent)]'
            : 'text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]',
          open && 'bg-[var(--theme-bg-hover)]',
        )}
        onClick={() => setOpen(!open)}
        title="Filter tickets"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="1 1 15 1 9 8 9 13 7 15 7 8 1 1" />
        </svg>
        {activeFilterCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--theme-accent)] text-[9px] font-bold text-white">
            {activeFilterCount}
          </span>
        )}
      </button>

      {open && rect && createPortal(
        <div
          ref={menuRef}
          className="fixed z-50 w-[280px] rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-4 shadow-xl"
          style={{ right: window.innerWidth - rect.right, top: rect.bottom + 4 }}
        >
          {/* Header */}
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-[var(--theme-text-muted)]">Filters</span>
            {activeFilterCount > 0 && (
              <button
                className="text-xs text-[var(--theme-accent)] transition-colors hover:underline"
                onClick={() => { clearFilters(); }}
              >
                Clear all ({activeFilterCount})
              </button>
            )}
          </div>

          <div className="flex flex-col gap-3.5">
            {/* Repository */}
            {repos.length > 0 && (
              <div>
                <label className="mb-1 block text-[11px] text-[var(--theme-text-muted)]">Repository</label>
                <select
                  className="w-full rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-2 py-1 text-xs text-[var(--theme-text-primary)] focus:border-[var(--theme-accent)] focus:outline-none"
                  value={filters.repo ?? ''}
                  onChange={(e) => setFilters({ repo: e.target.value || null })}
                >
                  <option value="">All</option>
                  {repos.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Priority */}
            <div>
              <label className="mb-1 block text-[11px] text-[var(--theme-text-muted)]">Priority</label>
              <div className="flex flex-wrap gap-1">
                <button
                  className={cn(
                    'rounded px-2 py-1 text-[11px] transition-colors',
                    !filters.priority
                      ? 'bg-[var(--theme-accent)] text-white'
                      : 'bg-[var(--theme-bg-overlay)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]',
                  )}
                  onClick={() => setFilters({ priority: null })}
                >
                  All
                </button>
                {(TICKET_PRIORITIES as readonly TicketPriority[]).map((p) => (
                  <button
                    key={p}
                    className={cn(
                      'flex items-center gap-1 rounded px-2 py-1 text-[11px] transition-colors',
                      filters.priority === p
                        ? 'bg-[var(--theme-accent)] text-white'
                        : 'bg-[var(--theme-bg-overlay)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]',
                    )}
                    onClick={() => setFilters({ priority: p })}
                  >
                    <PriorityIndicator priority={p} />
                    {p === 'none' ? 'None' : p.charAt(0).toUpperCase() + p.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Session */}
            <div>
              <label className="mb-1 block text-[11px] text-[var(--theme-text-muted)]">Session</label>
              <div className="flex gap-1">
                {([
                  { label: 'All', value: null },
                  { label: 'Active', value: true },
                  { label: 'None', value: false },
                ] as const).map((opt) => (
                  <button
                    key={String(opt.value)}
                    className={cn(
                      'rounded px-2 py-1 text-[11px] transition-colors',
                      filters.hasSession === opt.value
                        ? 'bg-[var(--theme-accent)] text-white'
                        : 'bg-[var(--theme-bg-overlay)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]',
                    )}
                    onClick={() => setFilters({ hasSession: opt.value })}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Favorite */}
            <div>
              <label className="mb-1 block text-[11px] text-[var(--theme-text-muted)]">Favorite</label>
              <div className="flex gap-1">
                {([
                  { label: 'All', value: null },
                  { label: '\u2605 Starred', value: true },
                ] as const).map((opt) => (
                  <button
                    key={String(opt.value)}
                    className={cn(
                      'rounded px-2 py-1 text-[11px] transition-colors',
                      filters.favorite === opt.value
                        ? 'bg-[var(--theme-accent)] text-white'
                        : 'bg-[var(--theme-bg-overlay)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]',
                    )}
                    onClick={() => setFilters({ favorite: opt.value })}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Tags */}
            {tags.length > 0 && (
              <div>
                <label className="mb-1 block text-[11px] text-[var(--theme-text-muted)]">Tag</label>
                <select
                  className="w-full rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-2 py-1 text-xs text-[var(--theme-text-primary)] focus:border-[var(--theme-accent)] focus:outline-none"
                  value={filters.tag ?? ''}
                  onChange={(e) => setFilters({ tag: e.target.value || null })}
                >
                  <option value="">All</option>
                  {tags.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
