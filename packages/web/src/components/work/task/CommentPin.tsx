/**
 * Pinning a comment to the Timeline from the conversation (SPEC annotations
 * §5.4): « Épingler sur la timeline » in the comment's "⋯" menu, and — once
 * pinned — an "Épinglé" badge (pin icon + label) that opens the Timeline on the annotation.
 */
import { cn } from '../../../lib/cn';
import { PinIcon } from '../../ui/icons/AnnotationIcons';

export interface CommentPin {
  /** An annotation was already promoted from this comment. */
  pinned: boolean;
  /** Open the composer, pre-filled from the comment. */
  onPin: () => void;
  /** Open the Timeline and pulse the annotation. */
  onShow: () => void;
}

export function PinnedBadge({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Voir l'annotation sur la timeline"
      aria-label="Voir l'annotation"
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--theme-accent)] bg-[var(--theme-accent-muted)] px-1.5 text-[10.5px] font-normal leading-[16px] text-[var(--theme-accent)]',
        className,
      )}
    >
      <PinIcon size={11} />
      Épinglé
    </button>
  );
}
