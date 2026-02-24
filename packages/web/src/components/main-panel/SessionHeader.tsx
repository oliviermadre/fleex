import type { Session } from '@asm/shared';
import { Badge } from '../ui/Badge';
import { cn } from '../../lib/cn';
import { useUIStore } from '../../stores/uiStore';

interface Props {
  session: Session;
  splitFocused?: boolean;
}

export function SessionHeader({ session, splitFocused }: Props) {
  // Truncate CWD path for display
  const cwdDisplay = session.cwd.replace(/^\/Users\/[^/]+/, '~');
  const floatingSessionId = useUIStore((s) => s.floatingSessionId);
  const setFloatingSession = useUIStore((s) => s.setFloatingSession);
  const isFloating = floatingSessionId === session.id;

  return (
    <div
      className={cn(
        'flex items-center gap-3 border-b px-3',
        splitFocused
          ? 'border-[var(--theme-accent)] bg-[var(--theme-accent-muted)]'
          : 'border-[var(--theme-border)]'
      )}
      style={{ height: 'var(--header-height)' }}
    >
      <span className="text-sm font-medium text-[var(--theme-text-primary)] truncate">
        {session.displayName || session.tmuxName}
      </span>
      <Badge type={session.type} />
      <span className="truncate text-xs text-[var(--theme-text-muted)]" title={session.cwd}>
        {cwdDisplay}
      </span>
      <div className="ml-auto flex items-center gap-1">
        <button
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded transition-colors border-none',
            isFloating
              ? 'text-[var(--theme-accent)] bg-[var(--theme-accent-muted)]'
              : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-accent)] bg-transparent hover:bg-[var(--theme-bg-hover)]'
          )}
          onClick={() => setFloatingSession(isFloating ? null : session.id)}
          title={isFloating ? 'Re-attach to main panel' : 'Detach to floating overlay'}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="9" height="9" rx="1.5" />
            <path d="M13 7V3h-4" />
            <line x1="13" y1="3" x2="7" y2="9" />
          </svg>
        </button>
      </div>
    </div>
  );
}
