import type { TicketType } from '@fleex/shared';
import { TICKET_TYPE_LABELS, TICKET_TYPE_EMOJIS } from '@fleex/shared';
import { cn } from '../../lib/cn';
import { tint, tintText, type TintHue } from '../../lib/tints';

const TYPE_ICONS: Record<TicketType, string> = {
  build: '🔨',
  fix: '🐛',
  review: '👀',
  ops: '⚙️',
  lead: '👔',
  think: '💡',
};

/**
 * Ticket type → tint hue (emerald→green, amber→yellow, violet→purple;
 * think takes blue instead of cyan→teal to stay distinguishable from ops).
 */
const TYPE_HUES: Record<TicketType, TintHue> = {
  build: 'green',
  fix: 'red',
  review: 'yellow',
  ops: 'teal',
  lead: 'purple',
  think: 'blue',
};

const TYPE_COLORS: Record<TicketType, string> = {
  build: tintText(TYPE_HUES.build),
  fix: tintText(TYPE_HUES.fix),
  review: tintText(TYPE_HUES.review),
  ops: tintText(TYPE_HUES.ops),
  lead: tintText(TYPE_HUES.lead),
  think: tintText(TYPE_HUES.think),
};

const TYPE_BG_COLORS: Record<TicketType, string> = {
  build: tint(TYPE_HUES.build),
  fix: tint(TYPE_HUES.fix),
  review: tint(TYPE_HUES.review),
  ops: tint(TYPE_HUES.ops),
  lead: tint(TYPE_HUES.lead),
  think: tint(TYPE_HUES.think),
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
