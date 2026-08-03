import { useMemo, useState } from 'react';

import type { Ticket } from '@fleex/shared';

import { cn } from '../../lib/cn';
import { isMissingRepo, NO_REPO_TAG, topReposForBoard } from '../../lib/repoStatus';
import { tint, tintText } from '../../lib/tints';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTicketStore } from '../../stores/ticketStore';
import { MissingRepoIcon } from '../sidebar/icons';

/**
 * Detail-view guard-rail (ticket #401). When a ticket has no `repository` link
 * — the thing that lets a run build a worktree — it will run "with no codebase"
 * silently. This banner surfaces that BEFORE a run is launched and offers the
 * two exits: link a repo (1-click for the board's most-used repos, or pick any),
 * or flag the ticket as intentionally code-less (sets the reserved `no-repo`
 * tag, which permanently silences the warning).
 *
 * Renders nothing when the ticket already has a repo or is flagged no-code, so
 * callers can mount it unconditionally.
 */
export function MissingRepoBanner({ ticket }: { ticket: Ticket }) {
  const tickets = useTicketStore((s) => s.tickets);
  const addLink = useTicketStore((s) => s.addLink);
  const updateTicket = useTicketStore((s) => s.updateTicket);
  const resolvedRepositories = useSettingsStore((s) => s.settings.resolvedRepositories);
  const [busy, setBusy] = useState(false);

  // Suggestions: the repos most used on THIS board (likely the right default),
  // falling back to the global resolved list so the picker is never empty on a
  // fresh board.
  const suggestions = useMemo(() => {
    const top = topReposForBoard(tickets, ticket.boardId, { limit: 3 });
    if (top.length > 0) return top;
    return resolvedRepositories.slice(0, 3);
  }, [tickets, ticket.boardId, resolvedRepositories]);

  if (!isMissingRepo(ticket)) return null;

  const linkRepo = async (ref: string) => {
    if (busy || !ref) return;
    setBusy(true);
    try {
      await addLink(ticket.id, { type: 'repository', ref, label: ref });
    } finally {
      setBusy(false);
    }
  };

  const markNoCode = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await updateTicket(ticket.id, { tags: [...ticket.tags, NO_REPO_TAG] });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={cn(
        'mt-3 flex flex-shrink-0 flex-col gap-2 rounded-md border p-3 text-xs',
        tint('orange'),
      )}
    >
      <div className="flex items-center gap-2">
        <MissingRepoIcon size={16} className={cn('flex-shrink-0', tintText('orange'))} />
        <span className="font-medium text-[var(--theme-text-primary)]">Aucun repository lié</span>
        <span className="text-[var(--theme-text-muted)]">
          — sans repo, un agent tournera sans codebase.
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {/* 1-click suggestions (board's most-used repos) */}
        {suggestions.map((ref) => (
          <button
            key={ref}
            className="rounded-full border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-2 py-0.5 text-[11px] text-[var(--theme-text-primary)] transition-colors hover:bg-[var(--theme-bg-hover)] disabled:opacity-50"
            onClick={() => linkRepo(ref)}
            disabled={busy}
            title={`Lier ${ref}`}
          >
            + {ref}
          </button>
        ))}

        {/* Fallback: pick any resolved repo */}
        {resolvedRepositories.length > 0 && (
          <select
            className="rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-2 py-0.5 text-[11px] text-[var(--theme-text-primary)] focus:border-[var(--theme-accent)] focus:outline-none disabled:opacity-50"
            value=""
            disabled={busy}
            onChange={(e) => linkRepo(e.target.value)}
          >
            <option value="">Lier un repo…</option>
            {resolvedRepositories.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        )}

        <span className="mx-0.5 text-[var(--theme-text-faint)]">·</span>

        <button
          className="rounded-md px-2 py-0.5 text-[11px] text-[var(--theme-text-muted)] underline-offset-2 transition-colors hover:text-[var(--theme-text-secondary)] hover:underline disabled:opacity-50"
          onClick={markNoCode}
          disabled={busy}
          title="Ce ticket n'a pas besoin de code (prépa, emails, recherche…)"
        >
          Marquer sans code
        </button>
      </div>
    </div>
  );
}
