/**
 * The conversation stream: the ticket's description as the opening user message,
 * then its comments in order. When the task is waiting on the user, the agent's
 * last comment — if it parses into options — renders as an answerable inline
 * question card instead of a plain bubble. Event lines from the domain event log
 * layer on in a later pass.
 */
import { useEffect, useMemo, useRef } from 'react';
import type { TicketComment } from '@fleex/shared';
import { StreamItem } from './StreamItem';
import { InlineQuestion } from './InlineQuestion';
import { MessageMarkdown } from './MessageMarkdown';
import { parseInlineOptions, type QueueActivity } from '../selectors';

interface Props {
  description: string | null;
  comments: TicketComment[];
  activity: QueueActivity;
  loading: boolean;
  error: string | null;
  onAnswer: (optionText: string) => void | Promise<void>;
}

export function TaskStream({ description, comments, activity, loading, error, onAnswer }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [comments.length]);

  // The pending question is the last agent comment when the task is waiting and
  // that comment offers a parseable choice.
  const questionCommentId = useMemo(() => {
    if (activity !== 'waiting') return null;
    for (let i = comments.length - 1; i >= 0; i--) {
      const c = comments[i]!;
      if (c.authorType === 'agent') {
        return parseInlineOptions(c.body).length >= 2 ? c.id : null;
      }
    }
    return null;
  }, [comments, activity]);

  const hasContent = comments.length > 0 || (description && description.trim().length > 0);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        {description && description.trim().length > 0 && (
          <div className="overflow-hidden rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-3 py-2.5">
            <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.08em] text-[var(--theme-text-muted)]">
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 2h5l3 3v9H4z" />
                <path d="M9 2v3h3" />
                <line x1="6" y1="8.5" x2="10" y2="8.5" />
                <line x1="6" y1="11" x2="9" y2="11" />
              </svg>
              DESCRIPTION
            </div>
            <div className="min-w-0 text-[13px] text-[var(--theme-text-primary)]">
              <MessageMarkdown body={description} />
            </div>
          </div>
        )}

        {comments.map((c) =>
          c.id === questionCommentId ? (
            <InlineQuestion
              key={c.id}
              authorName={c.authorName}
              body={c.body}
              options={parseInlineOptions(c.body)}
              onAnswer={onAnswer}
            />
          ) : (
            <StreamItem key={c.id} comment={c} />
          ),
        )}

        {loading && !hasContent && (
          <div className="py-8 text-center text-[12px] text-[var(--theme-text-faint)]">Loading conversation…</div>
        )}
        {error && <div className="py-2 text-center text-[12px] text-[var(--theme-danger)]">{error}</div>}
        {!loading && !hasContent && !error && (
          <div className="py-8 text-center text-[12px] text-[var(--theme-text-faint)]">
            No messages yet. Start the conversation below.
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
