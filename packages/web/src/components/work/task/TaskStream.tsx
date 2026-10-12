/**
 * The conversation stream: the ticket's description as the opening block, then a
 * chronological timeline mixing agent runs, comments, deliverables and grey
 * activity event lines. A run card sits before the comment it produced and links
 * to the execution log; a deliverable card sits after and opens the deliverable
 * overlay. When the task is waiting on the user, the agent's last comment — if it
 * parses into options — renders as an answerable inline question card.
 *
 * With `editable` (the Work task pane, not the read-only Focus popup) the stream
 * also carries the ticket-detail actions: inline description editing, and
 * deleting a comment or a deliverable — each delete behind a confirmation.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AgentExecution, AgentThread, TicketActivity, TicketComment, TicketDeliverable, TicketMention } from '@fleex/shared';
import { StreamItem } from './StreamItem';
import { EventLine } from './EventLine';
import { RunCard } from './RunCard';
import { DeliverableCard } from './DeliverableCard';
import { InlineQuestion } from './InlineQuestion';
import { DescriptionBlock } from './DescriptionBlock';
import { TicketActionCards } from '../../tickets/TicketActionCards';
import { ConfirmModal } from '../../ui/ConfirmModal';
import * as api from '../../../services/api';
import { useToastStore } from '../../../stores/toastStore';
import { DelegationCard } from './DelegationCard';
import { ModeRequestCard } from './ModeRequestCard';
import { AssistantLiveReply } from './AssistantLiveReply';
import { buildStream, parseModeRequest, threadTargetLabel, threadTurns, threadMentionIds, type ModeRequest, type QueueActivity } from '../selectors';

const EMPTY_THREADS: AgentThread[] = [];
const EMPTY_NAMES: Record<string, string> = {};
const EMPTY_MENTIONS: TicketMention[] = [];

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
  /**
   * Render the answerable cards (inline question options, HITL / workflow action
   * cards). Off when the host already owns those actions, e.g. the Focus popup.
   */
  showActionCards?: boolean;
  /** Turns on description editing and comment / deliverable deletion. */
  editable?: boolean;
  /** Called once a comment is deleted server-side, to drop it from the list at once. */
  onCommentDeleted?: (commentId: string) => void;
  /** Called once a deliverable is deleted server-side, to drop it from the list at once. */
  onDeliverableDeleted?: (deliverableId: string) => void;
  /** Assistant ⇄ agent threads of the ticket (Phase 3); each renders a delegation card. */
  threads?: AgentThread[];
  /** Display name per persona id, for the cards. */
  personaNames?: Record<string, string>;
  /** The ticket's mentions: tells which runs / crash cards belong to a thread. */
  mentions?: TicketMention[];
  onOpenThread?: (threadId: string) => void;
  onAnswerThread?: (threadId: string, text: string) => void | Promise<void>;
  /** The ticket's current agents execution mode (talk / plan / edit). */
  conversationMode?: string;
  onGrantMode?: (request: ModeRequest) => void | Promise<void>;
  onDeclineMode?: (request: ModeRequest) => void | Promise<void>;
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
  showActionCards = true,
  editable = false,
  onCommentDeleted,
  onDeliverableDeleted,
  threads = EMPTY_THREADS,
  personaNames = EMPTY_NAMES,
  mentions = EMPTY_MENTIONS,
  onOpenThread,
  onAnswerThread,
  conversationMode = 'plan',
  onGrantMode,
  onDeclineMode,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const confirmDeleteComment = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api.deleteTicketComment(ticketId, pendingDelete);
      onCommentDeleted?.(pendingDelete);
    } catch (e) {
      useToastStore.getState().addToast('error', e instanceof Error ? e.message : "Couldn't delete comment");
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  };
  const askDelete = (commentId: string) => (editable ? () => setPendingDelete(commentId) : undefined);

  // Runs and action cards of agents working inside a thread stay out of the main
  // stream: the assistant owns them (relaunch, answers), the Threads panel shows them.
  const hiddenMentionIds = useMemo(() => threadMentionIds(comments, mentions), [comments, mentions]);
  const threadCommentIds = useMemo(() => new Set(comments.filter((c) => c.threadId).map((c) => c.id)), [comments]);
  const stream = useMemo(
    () => buildStream(comments, events, executions, deliverables, threads, hiddenMentionIds),
    [comments, events, executions, deliverables, threads, hiddenMentionIds],
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [stream.length]);

  // The pending question is the last agent comment when the task is waiting and
  // the agent declared closed questions on it.
  const questionCommentId = useMemo(() => {
    if (!showActionCards || activity !== 'waiting') return null;
    for (let i = comments.length - 1; i >= 0; i--) {
      const c = comments[i]!;
      // The assistant relays agent questions to the user with the same declared shape.
      if (c.authorType === 'agent' || c.authorType === 'assistant') {
        return c.questions?.length ? c.id : null;
      }
    }
    return null;
  }, [comments, activity, showActionCards]);

  // Only the most recent mode request is actionable; earlier ones are history.
  const latestModeRequestId = useMemo(() => {
    if (!showActionCards) return null;
    for (let i = comments.length - 1; i >= 0; i--) {
      const c = comments[i]!;
      if (c.threadId || c.authorType !== 'assistant') continue;
      if (parseModeRequest(c.body)) return c.id;
    }
    return null;
  }, [comments, showActionCards]);

  // An assistant turn in flight streams its answer live at the bottom of the stream.
  const liveAssistant = useMemo(
    () => executions.find((e) => e.status === 'running' && e.mentionId.startsWith('assistant:')) ?? null,
    [executions],
  );

  const hasContent = stream.length > 0 || (description && description.trim().length > 0);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <DescriptionBlock key={ticketId} ticketId={ticketId} description={description} editable={editable} />

        {stream.map((entry) => {
          switch (entry.kind) {
            case 'event':
              return <EventLine key={`e-${entry.id}`} text={entry.text} />;
            case 'run':
              return <RunCard key={`r-${entry.execution.id}`} execution={entry.execution} onOpen={onOpenExecution} />;
            case 'deliverable':
              return (
                <DeliverableCard
                  key={`d-${entry.deliverable.id}`}
                  deliverable={entry.deliverable}
                  onDeleted={editable ? (id) => onDeliverableDeleted?.(id) : undefined}
                />
              );
            case 'delegation':
              return (
                <DelegationCard
                  key={`t-${entry.thread.id}`}
                  thread={entry.thread}
                  turns={threadTurns(comments, entry.thread.id)}
                  personaDisplayName={threadTargetLabel(entry.thread, personaNames[entry.thread.personaId])}
                  onOpen={(id) => onOpenThread?.(id)}
                  onAnswer={(id, text) => onAnswerThread?.(id, text)}
                />
              );
            case 'comment': {
              const modeRequest = entry.comment.authorType === 'assistant' ? parseModeRequest(entry.comment.body) : null;
              if (modeRequest) {
                return (
                  <ModeRequestCard
                    key={entry.comment.id}
                    comment={entry.comment}
                    request={modeRequest}
                    currentMode={conversationMode}
                    actionable={entry.comment.id === latestModeRequestId}
                    onGrant={(r) => onGrantMode?.(r)}
                    onDecline={(r) => onDeclineMode?.(r)}
                  />
                );
              }
              return entry.comment.id === questionCommentId ? (
                <InlineQuestion
                  key={entry.comment.id}
                  authorName={entry.comment.authorName}
                  body={entry.comment.body}
                  questions={entry.comment.questions ?? []}
                  onAnswer={onAnswer}
                  onDelete={askDelete(entry.comment.id)}
                />
              ) : (
                <StreamItem key={entry.comment.id} comment={entry.comment} onDelete={askDelete(entry.comment.id)} />
              );
            }
          }
        })}

        {liveAssistant && (
          <AssistantLiveReply execution={liveAssistant} name={personaNames[liveAssistant.personaId] ?? 'Assistant'} />
        )}

        {/* Actionable HITL / workflow cards (Human Gate approve-reject, waiting
            for input, ambiguous route, failed-step retry, crashed relaunch,
            running / waiting banners) — same surface as the ticket Comments tab. */}
        {showActionCards && (
          <TicketActionCards
            ticketId={ticketId}
            deliverables={deliverables}
            onOpenExecution={onOpenExecution}
            // The stream already renders a RunCard per running execution, so the
            // "…is working" banner would double-report it.
            showRunningBanner={false}
            hideCommentIds={threadCommentIds}
          />
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
      <ConfirmModal
        open={pendingDelete !== null}
        title="Delete comment?"
        message="This comment will be permanently removed from the discussion."
        confirmLabel="Delete"
        danger
        busy={deleting}
        onConfirm={() => void confirmDeleteComment()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
