/**
 * Horizontal zoom of the frieze: spread it out to read short Δt (several steps
 * within minutes), or tighten it on a long ticket. Steps through ZOOM_LEVELS;
 * the label shows the current factor and resets to ×1 on click.
 */
import { cn } from '../../../lib/cn';
import { ZOOM_LEVELS } from './layoutTimeline';

const BTN =
  'grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[5px] text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--theme-accent)] disabled:pointer-events-none disabled:opacity-35';

function MagnifierIcon({ plus }: { plus: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5M8 11h6" />
      {plus && <path d="M11 8v6" />}
    </svg>
  );
}

export function TimelineZoomControl({ zoom, onZoom }: { zoom: number; onZoom: (zoom: number) => void }) {
  const idx = Math.max(0, ZOOM_LEVELS.findIndex((l) => l === zoom));
  const label = zoom === 0.5 ? '×½' : `×${zoom}`;
  return (
    <div className="flex items-center" role="group" aria-label="Zoom de la frise">
      <button type="button" className={BTN} aria-label="Resserrer la frise" title="Resserrer" disabled={idx === 0} onClick={() => onZoom(ZOOM_LEVELS[idx - 1]!)}>
        <MagnifierIcon plus={false} />
      </button>
      <button
        type="button"
        onClick={() => onZoom(1)}
        title="Revenir au zoom par défaut"
        aria-label={`Zoom ${label}, revenir au zoom par défaut`}
        className={cn(
          'min-w-[22px] rounded px-0.5 font-mono text-[10px] tabular-nums hover:bg-[var(--theme-bg-hover)]',
          zoom === 1 ? 'text-[var(--theme-text-faint)]' : 'text-[var(--theme-accent)]',
        )}
      >
        {label}
      </button>
      <button
        type="button"
        className={BTN}
        aria-label="Étaler la frise"
        title="Étaler"
        disabled={idx === ZOOM_LEVELS.length - 1}
        onClick={() => onZoom(ZOOM_LEVELS[idx + 1]!)}
      >
        <MagnifierIcon plus />
      </button>
    </div>
  );
}
