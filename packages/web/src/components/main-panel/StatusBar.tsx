import type { Session } from '@fleex/shared';

import { cn } from '../../lib/cn';
import { tintSolid } from '../../lib/tints';
import { useTerminalStore } from '../../stores/terminalStore';

interface Props {
  session: Session;
  splitFocused?: boolean;
}

export function StatusBar({ session, splitFocused }: Props) {
  const connectionStatus = useTerminalStore(
    (s) => s.connectionStatus[session.id] ?? 'disconnected',
  );

  const cwdDisplay = session.cwd.replace(/^\/Users\/[^/]+/, '~');

  const statusColor = {
    connecting: tintSolid('yellow'),
    connected: tintSolid('green'),
    disconnected: 'bg-[var(--theme-text-faint)]',
  }[connectionStatus];

  const statusLabel = {
    connecting: 'Connecting',
    connected: 'Connected',
    disconnected: 'Disconnected',
  }[connectionStatus];

  return (
    <div
      className={cn(
        'flex items-center border-t px-3 text-[11px] text-[var(--theme-text-muted)]',
        splitFocused
          ? 'border-[var(--theme-accent)] bg-[var(--theme-accent-muted)]'
          : 'border-[var(--theme-border)] bg-[var(--theme-bg-surface)]',
      )}
      style={{ height: 'var(--statusbar-height)' }}
    >
      <span className="truncate">{cwdDisplay}</span>
      {session.worktreeBranch && (
        <span className="mx-2 flex items-center gap-1">
          <svg
            width="10"
            height="10"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="text-[var(--theme-text-faint)]"
          >
            <path d="M6 3v10M2 6l4-3 4 3" />
          </svg>
          {session.worktreeBranch}
        </span>
      )}
      {session.foregroundProcess &&
        !['zsh', 'bash', 'fish'].includes(session.foregroundProcess) && (
          <span className="mx-2 text-[var(--theme-text-faint)] text-[10px]">
            {session.foregroundProcess}
          </span>
        )}
      <span className="ml-auto flex items-center gap-1.5">
        <span className={cn('h-1.5 w-1.5 rounded-full', statusColor)} />
        {statusLabel}
      </span>
    </div>
  );
}
