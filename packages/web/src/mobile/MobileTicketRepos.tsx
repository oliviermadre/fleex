import { useMemo, useState } from 'react';
import type { Ticket, TicketLink } from '@fleex/shared';
import { useTicketStore } from '../stores/ticketStore';
import { useSettingsStore } from '../stores/settingsStore';

/**
 * Repository links of a ticket — without a repo link there is no worktree and
 * agents have nothing to act on, so this is first-class on mobile too.
 * Mirrors the desktop RepoWorktreePicker (TicketMetaSidebar): repos come from
 * settings.resolvedRepositories, links are plain `repository` ticket links.
 */
export function MobileTicketRepos({ ticket }: { ticket: Ticket }) {
  const addLink = useTicketStore((s) => s.addLink);
  const removeLink = useTicketStore((s) => s.removeLink);
  const resolvedRepositories = useSettingsStore((s) => s.settings.resolvedRepositories);

  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  const repoLinks = ticket.links.filter((l: TicketLink) => l.type === 'repository');
  const worktreeLinks = ticket.links.filter((l: TicketLink) => l.type === 'worktree');

  const availableRepos = useMemo(() => {
    const linked = new Set(repoLinks.map((l) => l.ref));
    return resolvedRepositories
      .filter((r) => r.includes('/') && !linked.has(r))
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  }, [resolvedRepositories, repoLinks]);

  const handleAdd = async (key: string) => {
    setBusy(true);
    try {
      await addLink(ticket.id, { type: 'repository', ref: key, label: key });
      setPicking(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-4 pb-2">
      {repoLinks.map((link) => (
        <span
          key={link.id}
          className="flex items-center gap-1 rounded-full border border-[var(--theme-border)] bg-[var(--theme-bg-secondary)] py-1 pl-2.5 pr-1 text-[11px] text-[var(--theme-text-secondary)]"
        >
          {link.ref}
          <button
            onClick={() => removeLink(ticket.id, link.id)}
            className="flex h-5 w-5 items-center justify-center rounded-full text-[var(--theme-text-faint)] active:text-[var(--theme-danger)]"
            aria-label={`Retirer ${link.ref}`}
          >
            ✕
          </button>
        </span>
      ))}
      {worktreeLinks.map((link) => (
        <span
          key={link.id}
          className="rounded-full border border-dashed border-[var(--theme-border)] px-2.5 py-1 text-[11px] text-[var(--theme-text-faint)]"
          title="Worktree"
        >
          ⎇ {link.ref.includes(':') ? link.ref.slice(link.ref.indexOf(':') + 1) : link.ref}
        </span>
      ))}
      <button
        onClick={() => setPicking(true)}
        className="rounded-full border border-[var(--theme-border)] px-2.5 py-1 text-[11px] font-medium text-[var(--theme-accent)]"
      >
        + Repo
      </button>

      {picking && (
        <div className="fixed inset-0 z-40 flex items-end bg-black/50" onClick={() => setPicking(false)}>
          <div
            className="max-h-[70dvh] w-full overflow-y-auto rounded-t-2xl border-t border-[var(--theme-border)] bg-[var(--theme-bg-base)] p-4"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--theme-text-muted)]">
              Lier un repository
            </p>
            {availableRepos.length === 0 ? (
              <p className="py-6 text-center text-sm text-[var(--theme-text-faint)]">
                {resolvedRepositories.length === 0
                  ? 'Aucun repository configuré dans ce workspace'
                  : 'Tous les repos sont déjà liés'}
              </p>
            ) : (
              availableRepos.map((key) => (
                <button
                  key={key}
                  disabled={busy}
                  onClick={() => handleAdd(key)}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-3 text-left text-sm text-[var(--theme-text-primary)] active:bg-[var(--theme-bg-hover)] disabled:opacity-50"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="shrink-0 text-[var(--theme-text-muted)]">
                    <path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5v-9z" />
                  </svg>
                  {key}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
