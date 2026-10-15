/**
 * The hover trash on a stream comment (user, agent or pending question). It only
 * asks — the confirmation and the API call live in TaskStream, which owns one
 * ConfirmModal for the whole stream.
 */
import { tintClasses } from '../../../lib/tints';
import { cn } from '../../../lib/cn';
import { TrashIcon } from './TrashIcon';

export function CommentDeleteButton({ onClick, className }: { onClick: () => void; className?: string }) {
  const red = tintClasses('red');
  return (
    <button
      type="button"
      onClick={onClick}
      title="Delete comment"
      aria-label="Delete comment"
      className={cn(
        'shrink-0 rounded p-1 text-[var(--theme-text-faint)] opacity-0 transition-opacity focus-visible:opacity-100 group-hover/comment:opacity-100',
        red.hoverBg,
        red.hoverText,
        className,
      )}
    >
      <TrashIcon />
    </button>
  );
}
