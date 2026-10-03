/**
 * The ticket browser's empty tab: URL shortcuts from `.claude/launch.json` in the
 * ticket's worktree(s). Shortcuts only — no server is started from here.
 */
import { useEffect, useState } from 'react';
import { fetchWorktreeFile, fetchWorktreeTree } from '../../../../services/api';
import { parseLaunchConfig, type LaunchShortcut } from './launchConfig';

export function NewTabPage({ ticketId, onOpen }: { ticketId: string; onOpen: (url: string) => void }) {
  const [shortcuts, setShortcuts] = useState<LaunchShortcut[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const tree = await fetchWorktreeTree(ticketId);
        const lists = await Promise.all(
          tree.repos.map(async (r) => {
            try {
              const file = await fetchWorktreeFile(ticketId, r.repo, '.claude/launch.json');
              const items = parseLaunchConfig(file.content);
              return tree.repos.length > 1 ? items.map((s) => ({ ...s, name: `${r.repo} · ${s.name}` })) : items;
            } catch {
              return [];
            }
          }),
        );
        if (!cancelled) setShortcuts(lists.flat());
      } catch {
        // no worktree for this ticket: the page is just the address bar
      }
    })();
    return () => { cancelled = true; };
  }, [ticketId]);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-sm">
      {shortcuts.length > 0 && (
        <ul className="w-full max-w-md divide-y divide-[var(--theme-border)] rounded-lg border border-[var(--theme-border)]">
          {shortcuts.map((s) => (
            <li key={s.name}>
              <button
                type="button"
                onClick={() => onOpen(s.url)}
                className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-[var(--theme-bg-hover)]"
              >
                <span className="text-[var(--theme-text-primary)]">{s.name}</span>
                <span className="font-mono text-xs text-[var(--theme-text-muted)]">{s.url.replace(/^https?:\/\/(localhost)?/, '')}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-center text-xs text-[var(--theme-text-muted)]">
        Type a URL, or add shortcuts in <code className="font-mono">.claude/launch.json</code>.
      </p>
    </div>
  );
}
