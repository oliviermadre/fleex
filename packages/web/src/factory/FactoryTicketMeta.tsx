/**
 * A ticket's marks, in Fleex's own iconography: type, priority, complexity and
 * favourite. One place, so the hover card, the console, the side panel and the
 * machine window all show a ticket the same way as the rest of the app.
 */
import { useEffect, useRef } from 'react';
import type { TicketComplexity, TicketPriority, TicketType } from '@fleex/shared';
import { TICKET_TYPE_LABELS } from '@fleex/shared';
import { TicketTypeIconSvg } from '../components/tickets/TicketTypeIconSvg';
import { PriorityIndicator, PRIORITY_LABELS } from '../components/tickets/PriorityIndicator';
import { ComplexityBadge, complexityDescription, DIAL_FILL } from '../components/tickets/ComplexityBadge';
import { tintClasses } from '../lib/tints';
import { cn } from '../lib/cn';
import { TYPE_COLORS } from './renderer';
import { tokenSprite, TOKEN_PAD } from './ticketToken';
import type { FactoryTicketInfo } from './types';

export const typeOf = (info: FactoryTicketInfo | null): TicketType | null => (info && info.type in TICKET_TYPE_LABELS ? (info.type as TicketType) : null);
export const priorityOf = (info: FactoryTicketInfo | null): TicketPriority => (info && info.priority in PRIORITY_LABELS ? (info.priority as TicketPriority) : 'none');
export const complexityOf = (info: FactoryTicketInfo | null): TicketComplexity | null => (info?.complexity != null && info.complexity in DIAL_FILL ? (info.complexity as TicketComplexity) : null);
export const typeLabel = (info: FactoryTicketInfo | null): string => { const t = typeOf(info); return t ? TICKET_TYPE_LABELS[t] ?? t : 'No type'; };

export function Star({ on, size = 12, className }: { on: boolean; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" aria-hidden="true"
      className={cn('shrink-0', on ? tintClasses('yellow').solidText : 'text-[var(--theme-text-faint)]', className)}>
      <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
    </svg>
  );
}

/** Type, priority, complexity and the favourite star, as icons; `words` adds what each one says. */
export function TicketGlyphs({ info, words = false, className }: { info: FactoryTicketInfo | null; words?: boolean; className?: string }) {
  if (!info) return null;
  const priority = priorityOf(info), complexity = complexityOf(info);
  return (
    <span className={cn('inline-flex flex-none items-center', words ? 'flex-wrap gap-x-3 gap-y-1' : 'gap-1.5', className)}>
      <span className="inline-flex items-center gap-1" title={`Type: ${typeLabel(info)}`}><TicketTypeIconSvg type={typeOf(info)} size={words ? 14 : 13} />{words && <span>{typeLabel(info)}</span>}</span>
      {(words || priority !== 'none') && <span className="inline-flex items-center gap-1" title={`Priority: ${PRIORITY_LABELS[priority]}`}><PriorityIndicator priority={priority} />{words && <span>{PRIORITY_LABELS[priority]}</span>}</span>}
      {(words || complexity !== null) && <span className="inline-flex items-center gap-1" title={`Complexity: ${complexityDescription(complexity)}`}><ComplexityBadge complexity={complexity} />{words && complexity === null && <span>Not estimated</span>}</span>}
      {info.favorite && <span className="inline-flex items-center gap-1" title="Favourite"><Star on />{words && <span>Favourite</span>}</span>}
    </span>
  );
}

/**
 * The ticket as it looks on the floor: the token in the shape of its type, drawn by the same code as the floor's
 * (`ticketToken.ts`), so a ticket is the same object in a list as on a belt.
 */
export function TicketToken({ info, size = 28, className }: { info: FactoryTicketInfo | null; size?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const type = info?.type ?? '', pad = Math.ceil(size * TOKEN_PAD);
  useEffect(() => {
    const cv = ref.current, ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    const d = Math.min(window.devicePixelRatio || 1, 3), sprite = tokenSprite(type, TYPE_COLORS[type] ?? '#8b949e', size * d);
    cv.width = cv.height = Math.round((size + pad * 2) * d);
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (sprite) ctx.drawImage(sprite, 0, 0, cv.width, cv.height);
  }, [type, size, pad]);
  return (
    <span className={cn('relative inline-block flex-none', className)} style={{ width: size, height: size }} role="img" aria-label={`${typeLabel(info)} ticket`}>
      {/* the picture is larger than the token's box, by the room its shadow and thickness take */}
      <canvas ref={ref} className="pointer-events-none absolute" style={{ left: -pad, top: -pad, width: size + pad * 2, height: size + pad * 2 }} aria-hidden="true" />
      {info?.favorite && <Star on size={Math.max(8, Math.round(size * 0.36))} className="absolute -right-1 -top-1 drop-shadow" />}
    </span>
  );
}
