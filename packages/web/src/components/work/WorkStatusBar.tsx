/**
 * Work status bar (26px, full width): a breadcrumb on the left
 * (Board › #num Title › workspace path + copy) and, on the right, the selected
 * task's agent activity and its cost (bottom-right). PR / repo count / status
 * live in the Context sidebar, not here, to avoid duplication.
 */
import { useMemo, useState } from 'react';
import { useTicketStore } from '../../stores/ticketStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { buildWorkspaceContext } from '../../lib/templateUtils';
import type { WorkTask } from './types';

interface Props {
  task: WorkTask | null;
}

export function WorkStatusBar({ task }: Props) {
  const ticket = useTicketStore((s) => (task ? s.tickets.find((t) => t.id === task.id) ?? null : null));
  const basePath = useSettingsStore((s) => s.settings.basePath);
  const workspacePath = useMemo(
    () => (ticket ? buildWorkspaceContext(ticket, basePath).workspace_path : null),
    [ticket, basePath],
  );

  return (
    <footer className="flex h-[26px] shrink-0 items-center justify-between border-t border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-3 text-[11px] text-[var(--theme-text-muted)]">
      <div className="flex min-w-0 items-center gap-1.5">
        {task ? (
          <>
            {task.boardName && <Segment>{task.boardName}</Segment>}
            <Chevron />
            <Segment>
              <span className="font-mono text-[var(--theme-text-faint)]">#{task.number}</span>{' '}
              <span className="truncate text-[var(--theme-text-secondary)]">{task.title}</span>
            </Segment>
            {workspacePath && (
              <>
                <Chevron />
                <Segment>
                  <span className="truncate font-mono" title={workspacePath}>
                    {workspacePath}
                  </span>
                  <CopyButton value={workspacePath} />
                </Segment>
              </>
            )}
          </>
        ) : (
          <span className="text-[var(--theme-text-faint)]">No task selected</span>
        )}
      </div>

      {task && (
        <div className="flex shrink-0 items-center gap-2">
          {task.activityDetail && <span>{task.activityDetail}</span>}
          {task.cost != null && task.cost > 0 && <Hair>${task.cost.toFixed(2)}</Hair>}
        </div>
      )}
    </footer>
  );
}

function Segment({ children }: { children: React.ReactNode }) {
  return <span className="flex min-w-0 items-center gap-1 truncate">{children}</span>;
}

/** Icon-only clipboard button: copies `value`, flashes "Copied!" for ~1.4s. */
function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard unavailable (insecure context / denied) — silently no-op.
    }
  };

  if (copied) {
    return <span className="shrink-0 text-[10px] font-medium text-[var(--tint-green-text)]">Copied!</span>;
  }

  return (
    <button
      type="button"
      onClick={copy}
      title="Copy path"
      aria-label="Copy workspace path"
      className="flex shrink-0 cursor-pointer items-center text-[var(--theme-text-faint)] transition-colors hover:text-[var(--theme-text-primary)]"
    >
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
        <path d="M3.5 10.5H3a1.5 1.5 0 0 1-1.5-1.5V3A1.5 1.5 0 0 1 3 1.5h6A1.5 1.5 0 0 1 10.5 3v.5" />
      </svg>
    </button>
  );
}
function Chevron() {
  return <span className="text-[var(--theme-text-faint)]">›</span>;
}
function Hair({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-2 border-l border-[var(--theme-border)] pl-2">{children}</span>
  );
}
