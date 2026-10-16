/**
 * Pinning a comment to the Timeline from the conversation (SPEC annotations
 * §5.4): a hover pushpin next to the trash, and — once pinned — a "📌 Épinglé"
 * badge that opens the Timeline on the annotation.
 */
import { cn } from '../../../lib/cn';

export interface CommentPin {
  /** An annotation was already promoted from this comment. */
  pinned: boolean;
  /** Open the composer, pre-filled from the comment. */
  onPin: () => void;
  /** Open the Timeline and pulse the annotation. */
  onShow: () => void;
}

export function CommentPinButton({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Épingler sur la timeline"
      aria-label="Épingler sur la timeline"
      className={cn(
        'shrink-0 rounded p-1 text-[12px] leading-none text-[var(--theme-text-faint)] opacity-0 transition-opacity hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-primary)] focus-visible:opacity-100 group-hover/comment:opacity-100',
        className,
      )}
    >
      📌
    </button>
  );
}

export function PinnedBadge({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Voir l'annotation sur la timeline"
      aria-label="Voir l'annotation"
      className={cn(
        'shrink-0 rounded-full border border-[var(--theme-accent)] bg-[var(--theme-accent-muted)] px-1.5 text-[10.5px] font-normal leading-[16px] text-[var(--theme-accent)]',
        className,
      )}
    >
      📌 Épinglé
    </button>
  );
}
