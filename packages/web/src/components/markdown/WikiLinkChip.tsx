import type { ReactNode } from 'react';
import { useScratchpadStore } from '../../stores/scratchpadStore';
import { useUIStore } from '../../stores/uiStore';
import { TicketMentionChip } from './TicketMentionChip';

/**
 * Inline chip for a `[[…]]` link, rendered by the generic Markdown surfaces via
 * the `#fleex-wiki:` href.
 *
 * A ticket target reuses the mention chip: `[[#42]]` and `@ticket:42` point at
 * the same thing, and two different-looking chips for one destination would read
 * as two different kinds of reference.
 *
 * A note target is rendered here, because it navigates somewhere the mention
 * vocabulary has no word for. Note links resolve by key alone — the note may not
 * exist yet, and refusing to link to it would make `[[org/repo]]` useless in the
 * case it is most useful for: writing the link before writing the note.
 */
export function WikiLinkChip({ target, children }: { target: string; children: ReactNode }) {
  if (target.startsWith('#')) {
    return <TicketMentionChip idRef={target.slice(1)} />;
  }
  return <NoteLinkChip noteKey={target}>{children}</NoteLinkChip>;
}

function NoteLinkChip({ noteKey, children }: { noteKey: string; children: ReactNode }) {
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
      title={noteKey === '__global__' ? 'Global note' : `Note: ${noteKey}`}
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
      <span className="truncate">{children}</span>
    </button>
  );
}
