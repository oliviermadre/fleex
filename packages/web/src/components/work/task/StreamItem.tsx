/**
 * One item in the conversation stream. User comments are right-aligned accent
 * bubbles; agent/assistant comments are left-aligned with an avatar and name.
 * Bubbles clip their content and let code blocks scroll inside (MessageMarkdown),
 * so a wide code block never spills past the bubble.
 */
import type { TicketComment } from '@fleex/shared';
import { MessageMarkdown } from './MessageMarkdown';

export function StreamItem({ comment }: { comment: TicketComment }) {
  const isUser = comment.authorType === 'user';
  const isAssistant = comment.authorType === 'assistant';

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="min-w-0 max-w-[80%] overflow-hidden rounded-xl rounded-br-sm bg-[var(--theme-accent-muted)] px-3 py-2 text-[13px] text-[var(--theme-text-primary)]">
          <MessageMarkdown body={comment.body} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
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
        <div className="mb-0.5 text-[11px] font-medium text-[var(--theme-text-secondary)]">
          {comment.authorName || (isAssistant ? 'Assistant' : 'Agent')}
        </div>
        <div className="min-w-0 max-w-full overflow-hidden text-[13px] text-[var(--theme-text-primary)]">
          <MessageMarkdown body={comment.body} />
        </div>
      </div>
    </div>
  );
}
