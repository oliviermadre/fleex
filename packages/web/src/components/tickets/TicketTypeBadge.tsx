import type { TicketType } from '@fleex/shared';
import { TICKET_TYPE_LABELS, TICKET_TYPE_EMOJIS } from '@fleex/shared';
import { cn } from '../../lib/cn';

const TYPE_ICONS: Record<TicketType, string> = {
  build: '🔨',
  fix: '🐛',
  review: '👀',
  ops: '⚙️',
  lead: '👔',
  think: '💡',
};

const TYPE_COLORS: Record<TicketType, string> = {
  build: 'text-emerald-400',
  fix: 'text-red-400',
  review: 'text-amber-400',
  ops: 'text-teal-400',
  lead: 'text-violet-400',
  think: 'text-cyan-400',
};

const TYPE_BG_COLORS: Record<TicketType, string> = {
  build: 'bg-emerald-400/15 text-emerald-400',
  fix: 'bg-red-400/15 text-red-400',
  review: 'bg-amber-400/15 text-amber-400',
  ops: 'bg-teal-400/15 text-teal-400',
  lead: 'bg-violet-400/15 text-violet-400',
  think: 'bg-cyan-400/15 text-cyan-400',
};

export function TicketTypeIcon({ type }: { type: TicketType | null }) {
  if (!type) return null;
  return <span className="text-xs leading-none">{TYPE_ICONS[type]}</span>;
}

export function TicketTypeBadge({ type, size = 'sm' }: { type: TicketType | null; size?: 'sm' | 'md' }) {
  if (!type) return null;

  if (size === 'sm') {
    return (
      <span className={cn('inline-flex items-center text-[10px] font-medium', TYPE_COLORS[type])}>
        {TICKET_TYPE_LABELS[type]}
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
        TYPE_BG_COLORS[type],
      )}
    >
      <span className="text-xs">{TYPE_ICONS[type]}</span>
      {TICKET_TYPE_LABELS[type]}
    </span>
  );
}

export { TYPE_ICONS, TYPE_COLORS };
