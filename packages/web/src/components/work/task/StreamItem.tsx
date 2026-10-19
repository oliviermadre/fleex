/**
 * One item in the conversation stream. User comments are right-aligned accent
 * bubbles; agent/assistant comments are left-aligned with an avatar and name.
 * Bubbles clip their content and let code blocks scroll inside (MessageMarkdown),
 * so a wide code block never spills past the bubble. Every action on a comment
 * (pin to the Timeline, delete…) lives in one "⋯" menu, always on the right of
 * the comment whoever wrote it. A pinned comment also shows an "Épinglé" badge.
 */
import type { TicketComment } from '@fleex/shared';
import { MessageMarkdown } from './MessageMarkdown';
import { PinnedBadge, type CommentPin } from './CommentPin';
import { CommentActionsMenu, type CommentAction } from './CommentActionsMenu';
import { TrashIcon } from './TrashIcon';
import { PinIcon } from '../../ui/icons/AnnotationIcons';
import { stripModeRequest } from '../selectors';

/** The menu entries a comment offers, in order: pin (or go to its annotation), then delete. */
export function commentActions({ onDelete, pin }: { onDelete?: () => void; pin?: CommentPin }): CommentAction[] {
  const actions: CommentAction[] = [];
  if (pin) {
    actions.push(
      pin.pinned
        ? { key: 'show-annotation', label: "Voir l'annotation", icon: <PinIcon size={13} />, onSelect: pin.onShow }
        : { key: 'pin', label: 'Épingler sur la timeline', icon: <PinIcon size={13} />, onSelect: pin.onPin },
    );
  }
  if (onDelete) actions.push({ key: 'delete', label: 'Supprimer', icon: <TrashIcon className="h-3.5 w-3.5" />, onSelect: onDelete, danger: true });
  return actions;
}

export function StreamItem({ comment, onDelete, pin }: { comment: TicketComment; onDelete?: () => void; pin?: CommentPin }) {
  const isUser = comment.authorType === 'user';
  const actions = commentActions({ onDelete, pin });
  const isAssistant = comment.authorType === 'assistant';

  if (isUser) {
    return (
      <div className="group/comment flex items-start justify-end gap-1" data-comment-id={comment.id}>
        {pin?.pinned && <PinnedBadge onClick={pin.onShow} className="mt-1" />}
        <div className="min-w-0 max-w-[80%] overflow-hidden rounded-xl rounded-br-sm bg-[var(--theme-accent-muted)] px-3 py-2 text-[13px] text-[var(--theme-text-primary)]">
          <MessageMarkdown body={comment.body} />
        </div>
        <CommentActionsMenu actions={actions} className="mt-1" />
      </div>
    );
  }

  return (
    <div className="group/comment flex gap-2" data-comment-id={comment.id}>
      <div
        className={
          isAssistant
            ? 'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--theme-accent-muted)] text-[12px] text-[var(--theme-accent)]'
            : 'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--tint-purple-bg)] text-[12px] text-[var(--tint-purple-text)]'
        }
        aria-hidden
      >
        {isAssistant ? '◆' : '⌬'}
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-center text-[11px] font-medium text-[var(--theme-text-secondary)]">
          {comment.authorName || (isAssistant ? 'Assistant' : 'Agent')}
          {pin?.pinned && <PinnedBadge onClick={pin.onShow} className="ml-2" />}
          <CommentActionsMenu actions={actions} className="-my-1 ml-auto" />
        </div>
        <div className="min-w-0 max-w-full overflow-hidden text-[13px] text-[var(--theme-text-primary)]">
          <MessageMarkdown body={stripModeRequest(comment.body)} />
        </div>
      </div>
    </div>
  );
}
