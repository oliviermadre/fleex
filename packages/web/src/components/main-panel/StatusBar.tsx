import type { Session } from '@asm/shared';
import { useTerminalStore } from '../../stores/terminalStore';
import { cn } from '../../lib/cn';

interface Props {
  session: Session;
}

export function StatusBar({ session }: Props) {
  const connectionStatus = useTerminalStore(
    (s) => s.connectionStatus[session.id] ?? 'disconnected'
  );

  const cwdDisplay = session.cwd.replace(/^\/Users\/[^/]+/, '~');

  const statusColor = {
    connecting: 'bg-yellow-500',
    connected: 'bg-emerald-500',
    disconnected: 'bg-zinc-600',
  }[connectionStatus];

  const statusLabel = {
    connecting: 'Connecting',
    connected: 'Connected',
    disconnected: 'Disconnected',
  }[connectionStatus];

  return (
    <div
      className="flex items-center border-t border-zinc-800 bg-zinc-900/80 px-3 text-[11px] text-zinc-500"
      style={{ height: 'var(--statusbar-height)' }}
    >
      <span className="truncate">{cwdDisplay}</span>
      {session.worktreeBranch && (
        <span className="mx-2 flex items-center gap-1">
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-zinc-600">
            <path d="M6 3v10M2 6l4-3 4 3" />
          </svg>
          {session.worktreeBranch}
        </span>
      )}
      <span className="ml-auto flex items-center gap-1.5">
        <span className={cn('h-1.5 w-1.5 rounded-full', statusColor)} />
        {statusLabel}
      </span>
    </div>
  );
}
