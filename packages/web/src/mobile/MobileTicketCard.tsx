import { memo } from 'react';

import type { Ticket, TicketPriority } from '@fleex/shared';

import { tintSolid, tintText } from '../lib/tints';

const PRIORITY_COLOR: Record<TicketPriority, string> = {
  none: 'bg-transparent',
  low: tintSolid('blue'),
  medium: tintSolid('yellow'),
  high: tintSolid('red'),
};

export const MobileTicketCard = memo(function MobileTicketCard({
  ticket,
  boardName,
  onOpen,
}: {
  ticket: Ticket;
  boardName?: string;
  onOpen: () => void;
}) {
  const hasSession = ticket.links.some((l) => l.type === 'session');
  const repoLink = ticket.links.find((l) => l.type === 'worktree' || l.type === 'repository');
  const repo = repoLink
    ? repoLink.type === 'worktree'
      ? repoLink.ref.split(':')[0]
      : repoLink.ref
    : null;

  return (
    <button
      onClick={onOpen}
      className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg-secondary)] p-3 text-left active:bg-[var(--theme-bg-hover)]"
    >
      <div className="flex items-start gap-2">
        {ticket.priority !== 'none' && (
          <span
            className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${PRIORITY_COLOR[ticket.priority]}`}
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-snug text-[var(--theme-text-primary)]">
            {ticket.title}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--theme-text-faint)]">
            <span className="font-mono">#{ticket.displayId}</span>
            {boardName && <span>{boardName}</span>}
            {ticket.type && (
              <span className="rounded bg-[var(--theme-bg-hover)] px-1.5 py-0.5 uppercase tracking-wide">
                {ticket.type}
              </span>
            )}
            {repo && <span className="truncate">{repo}</span>}
            {ticket.blocked && <span className={tintText('red')}>bloqué</span>}
            {hasSession && <span className="text-[var(--theme-accent)]">session</span>}
            {ticket.favorite && <span className={tintText('yellow')}>★</span>}
            {ticket.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="rounded bg-[var(--theme-bg-hover)] px-1.5 py-0.5">
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>
    </button>
  );
});
