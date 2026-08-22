import type { ReactNode } from 'react';
import { GLOBAL_NOTE_KEY } from '@fleex/shared';
import { useScratchpadStore } from '../../stores/scratchpadStore';
import { useUIStore } from '../../stores/uiStore';

/**
 * Inline chip for a `@scratchpad:` reference, rendered by every Markdown surface
 * via the `#fleex-scratchpad:` href.
 *
 * A reference resolves by key alone — the note may not exist yet, and refusing to
 * link to it would make the reference useless in the case it is most useful for:
 * writing the link before writing the note.
 */
export function NoteRefChip({ noteKey, children }: { noteKey: string; children: ReactNode }) {
  const isGlobal = noteKey === GLOBAL_NOTE_KEY;

  const open = () => {
    useUIStore.getState().setActivePanel('scratchpads');
    useScratchpadStore.getState().setSelectedScratchpadKey(noteKey);
  };

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        open();
      }}
      title={isGlobal ? 'Global note' : `Note: ${noteKey}`}
      className="inline-flex max-w-full items-baseline gap-1 rounded-sm bg-[var(--theme-accent)]/12 px-1 py-px align-baseline text-[var(--theme-accent)] transition-colors hover:bg-[var(--theme-accent)]/25"
    >
      <svg
        width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
        className="shrink-0 self-center"
      >
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <path d="M14 2v6h6" />
      </svg>
      <span className="truncate">{isGlobal ? 'Global' : children}</span>
    </button>
  );
}
