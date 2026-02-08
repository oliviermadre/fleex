import type { Session } from '@asm/shared';
import { Badge } from '../ui/Badge';

interface Props {
  session: Session;
}

export function SessionHeader({ session }: Props) {
  // Truncate CWD path for display
  const cwdDisplay = session.cwd.replace(/^\/Users\/[^/]+/, '~');

  return (
    <div
      className="flex items-center gap-3 border-b border-[var(--theme-border)] px-3"
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
