import type { LoggerPort } from '../ports/logger.port.js';
import type { PostCommentUseCase } from '../use-cases/post-comment.js';

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Makes a failed deliverable persistence visible instead of silent.
 *
 * On the mention path the failure used to be swallowed in a `logger.warn`: the
 * execution finished `completed`, the mention resolved, and the user saw an
 * agent that went all the way through yet produced nothing — with no
 * explanation anywhere in the ticket. That is the symptom this ticket reports.
 *
 * The execution is deliberately NOT failed here. A lost artifact must not
 * become a crashed run; the goal is only that a human can see what happened.
 */
export async function reportDeliverableFailure(params: {
  logger: LoggerPort;
  postComment: PostCommentUseCase;
  executionId: string;
  ticketId: string;
  /** Author to attribute the notice to — the agent that produced the artifact. */
  authorName: string;
  title: string;
  contentLength: number;
  error: unknown;
  parentId?: string | null;
}): Promise<void> {
  const storeError = message(params.error);

  params.logger.error('Failed to persist deliverable', {
    executionId: params.executionId,
    ticketId: params.ticketId,
    title: params.title,
    contentLength: params.contentLength,
    error: storeError,
  });

  try {
    await params.postComment.execute({
      ticketId: params.ticketId,
      authorType: 'agent',
      authorName: params.authorName,
      body:
        `⚠️ Deliverable "${params.title}" could not be saved (${params.contentLength} characters).\n\n` +
        `Store error: \`${storeError}\`\n\n` +
        'The content produced by this run was not persisted. Relaunching the ' +
        'step will regenerate it.',
      parentId: params.parentId ?? null,
    });
  } catch (notifyErr) {
    // Reporting the failure must never be the thing that breaks the run.
    params.logger.error('Failed to post deliverable failure notice', {
      executionId: params.executionId,
      ticketId: params.ticketId,
      error: message(notifyErr),
    });
  }
}
