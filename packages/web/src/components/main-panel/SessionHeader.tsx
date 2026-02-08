import type { Session } from '@asm/shared';
import { Badge } from '../ui/Badge';
import { cn } from '../../lib/cn';

interface Props {
  session: Session;
  splitFocused?: boolean;
}

export function SessionHeader({ session, splitFocused }: Props) {
  // Truncate CWD path for display
  const cwdDisplay = session.cwd.replace(/^\/Users\/[^/]+/, '~');

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
        {session.tmuxName}
      </span>
      <Badge type={session.type} />
      <span className="truncate text-xs text-[var(--theme-text-muted)]" title={session.cwd}>
        {cwdDisplay}
      </span>
    </div>
  );
}
