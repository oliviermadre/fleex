import type { Session } from '@asm/shared';
import { useSessionStore } from '../../stores/sessionStore';
import { formatAge } from '../../lib/formatAge';
import { cn } from '../../lib/cn';

interface Props {
  session: Session;
}

export function SessionItem({ session }: Props) {
  const selectedSessionId = useSessionStore((s) => s.selectedSessionId);
  const selectSession = useSessionStore((s) => s.selectSession);
  const isSelected = selectedSessionId === session.id;

  const dotColor = session.type === 'shell' ? 'bg-emerald-500' : 'bg-violet-500';
  const deadDotColor = 'bg-zinc-600';

  return (
    <button
      className={cn(
        'flex w-full items-center gap-2 px-4 py-1 text-left transition-colors',
        isSelected
          ? 'bg-zinc-800 text-zinc-100'
          : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-300'
      )}
      onClick={() => selectSession(session.id)}
    >
      <span
        className={cn(
          'h-2 w-2 shrink-0 rounded-full',
          session.status === 'running' ? dotColor : deadDotColor
        )}
      />
      <span className="min-w-0 flex-1 truncate text-[11px]">
        {session.tmuxName}
      </span>
      <span className="shrink-0 text-[10px] text-zinc-600">
        {formatAge(session.createdAt)}
      </span>
    </button>
  );
}
