/**
 * The conversation stream: the ticket's description as the opening block, then a
 * chronological timeline mixing agent runs, comments, deliverables and grey
 * activity event lines. A run card sits before the comment it produced and links
 * to the execution log; a deliverable card sits after and opens the deliverable
 * overlay. When the task is waiting on the user, the agent's last comment — if it
 * parses into options — renders as an answerable inline question card.
 */
import { useEffect, useMemo, useRef } from 'react';
import type { AgentExecution, TicketActivity, TicketComment, TicketDeliverable } from '@fleex/shared';
import { StreamItem } from './StreamItem';
import { EventLine } from './EventLine';
import { RunCard } from './RunCard';
import { DeliverableCard } from './DeliverableCard';
import { InlineQuestion } from './InlineQuestion';
import { MessageMarkdown } from './MessageMarkdown';
import { TicketActionCards } from '../../tickets/TicketActionCards';
import { buildStream, parseInlineOptions, type QueueActivity } from '../selectors';

interface Props {
  ticketId: string;
  description: string | null;
  comments: TicketComment[];
  events: TicketActivity[];
  executions: AgentExecution[];
  deliverables: TicketDeliverable[];
  activity: QueueActivity;
  loading: boolean;
  error: string | null;
  onAnswer: (optionText: string) => void | Promise<void>;
  onOpenExecution: (executionId: string, title: string) => void;
}

export function TaskStream({
  ticketId,
  description,
  comments,
  events,
  executions,
  deliverables,
  activity,
  loading,
  error,
  onAnswer,
  onOpenExecution,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  const stream = useMemo(
    () => buildStream(comments, events, executions, deliverables),
    [comments, events, executions, deliverables],
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [stream.length]);

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

  const hasContent = stream.length > 0 || (description && description.trim().length > 0);

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

        {stream.map((entry) => {
          switch (entry.kind) {
            case 'event':
              return <EventLine key={`e-${entry.id}`} text={entry.text} />;
            case 'run':
              return <RunCard key={`r-${entry.execution.id}`} execution={entry.execution} onOpen={onOpenExecution} />;
            case 'deliverable':
              return <DeliverableCard key={`d-${entry.deliverable.id}`} deliverable={entry.deliverable} />;
            case 'comment':
              return entry.comment.id === questionCommentId ? (
                <InlineQuestion
                  key={entry.comment.id}
                  authorName={entry.comment.authorName}
                  body={entry.comment.body}
                  options={parseInlineOptions(entry.comment.body)}
                  onAnswer={onAnswer}
                />
              ) : (
                <StreamItem key={entry.comment.id} comment={entry.comment} />
              );
          }
        })}

        {/* Actionable HITL / workflow cards (Human Gate approve-reject, waiting
            for input, ambiguous route, failed-step retry, crashed relaunch,
            running / waiting banners) — same surface as the ticket Comments tab. */}
        <TicketActionCards
          ticketId={ticketId}
          deliverables={deliverables}
          onOpenExecution={onOpenExecution}
          // The stream already renders a RunCard per running execution, so the
          // "…is working" banner would double-report it.
          showRunningBanner={false}
        />

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
