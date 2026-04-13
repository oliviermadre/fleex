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
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-medium',
        TYPE_COLORS[type],
        size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-[11px]',
      )}
    >
      <span className={size === 'sm' ? 'text-[10px]' : 'text-xs'}>{TYPE_ICONS[type]}</span>
      {TICKET_TYPE_LABELS[type]}
    </span>
  );
}

export { TYPE_ICONS, TYPE_COLORS };
