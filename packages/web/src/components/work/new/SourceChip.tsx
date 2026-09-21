import { getSource } from '@fleex/shared';
import type { DraftSource } from '../../../stores/workStore';

/**
 * The provenance chip shown above the description once a draft was imported from
 * a source. Clicking the link opens the source in a new tab; the `×` detaches the
 * source (keeping title/description) — see NewTaskCompose.
 */
export function SourceChip({ source, onDetach }: { source: DraftSource; onDetach: () => void }) {
  const name = getSource(source.sourceId).name;
  return (
    <div className="flex items-center gap-2 rounded-md border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-base)] px-2 py-1 text-[11px] text-[var(--theme-text-secondary)]">
      <span aria-hidden>◆</span>
      <span className="font-medium">{name}</span>
      <span className="text-[var(--theme-text-faint)]">·</span>
      <a
        href={source.url}
        target="_blank"
        rel="noopener noreferrer"
        className="truncate font-mono text-[var(--theme-text-primary)] hover:underline"
        title={source.url}
      >
        {source.ref} ↗
      </a>
      <button
        type="button"
        onClick={onDetach}
        aria-label="Detach source"
        title="Detach source"
        className="ml-auto rounded px-1 text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-primary)]"
      >
        ×
      </button>
    </div>
  );
}
