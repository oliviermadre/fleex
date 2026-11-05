/**
 * Hover / focus card of a timeline picto (SPEC §8): picto + mono overline +
 * bold title, an optional state chip, then a key/value grid and a muted footer.
 * All strings come pre-computed from the model (buildTimeline).
 */
import { cn } from '../../../lib/cn';
import { tint } from '../../../lib/tints';
import type { TimelineAction, TimelineEvent, TooltipContent } from './buildTimeline';
import { GlyphIcon, glyphHue } from './TimelineGlyph';
import { PrIcon } from '../queue/QueuePrGlyph';
import { getPrBadgeClasses } from '../../../lib/prBadgeStyle';

const CHIP_HUE = { ok: 'green', ko: 'red', warn: 'yellow', running: 'blue', muted: 'gray' } as const;

function Chip({ chip }: { chip: NonNullable<TooltipContent['chip']> }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', tint(CHIP_HUE[chip.tone]))}>
      {chip.tone === 'ok' && '✓ '}
      {chip.tone === 'ko' && '✕ '}
      {chip.text}
    </span>
  );
}

/**
 * `content` overrides the event's own tooltip (an exchange capsule shows its
 * exchange card); `onAction` makes its `links` clickable.
 */
export function TimelineTooltip({
  event,
  content,
  onAction,
}: {
  event: TimelineEvent;
  content?: TooltipContent;
  onAction?: (action: TimelineAction, event: TimelineEvent) => void;
}) {
  const t = content ?? event.tooltip;
  const g = event.glyph;
  return (
    <div className="w-[300px] max-w-[80vw] space-y-2 p-0.5 text-[12px] font-normal">
      <div className="flex items-start gap-2.5">
        {g.type === 'pr' ? (
          <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[11px]', getPrBadgeClasses({ state: g.state === 'draft' ? 'open' : g.state ?? 'open', isDraft: g.state === 'draft' }))}>
            <PrIcon state={g.state} />
            {g.label}
          </span>
        ) : g.type !== 'status' ? (
          <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-md', tint(glyphHue(g)))}>
            <GlyphIcon glyph={g} size={16} />
          </span>
        ) : null}
        <div className="min-w-0">
          {t.overline && <div className="truncate font-mono text-[11px] text-[var(--theme-text-muted)]">{t.overline}</div>}
          <div className="break-words text-[13px] font-semibold text-[var(--theme-text-primary)]">{t.title}</div>
        </div>
      </div>
      {t.chip && <Chip chip={t.chip} />}
      {t.rows.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {t.rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-[var(--theme-text-muted)]">{k}</dt>
              <dd className={cn('min-w-0 break-words text-[var(--theme-text-primary)]', k === 'Extrait' && 'line-clamp-3', k === 'Branche' && 'font-mono')}>
                {v}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {t.links && t.links.length > 0 && onAction && (
        <div className="flex flex-col items-start gap-0.5 border-t border-[var(--theme-border)] pt-1.5">
          {t.links.map((l, i) => (
            <button
              key={`${l.label}-${i}`}
              type="button"
              className="max-w-full truncate rounded px-1 text-left text-[11px] text-[var(--theme-accent)] hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--theme-accent)]"
              onClick={() => onAction(l.action, event)}
            >
              {l.label}
            </button>
          ))}
        </div>
      )}
      {t.footer && (
        <div className="border-t border-[var(--theme-border)] pt-1.5 text-[11px] text-[var(--theme-text-muted)]">{t.footer}</div>
      )}
    </div>
  );
}
