import { describe, it, expect, vi } from 'vitest';
import { reportDeliverableFailure } from '../../src/application/utils/report-deliverable-failure.js';

const STORE_ERROR = 'SupabaseDeliverableStore.save failed: unsupported Unicode escape sequence';

const setup = () => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const postComment = {
    execute: vi.fn().mockResolvedValue({ comment: { id: 'c-1' }, createdMentions: [] }),
  };
  return { logger, postComment };
};

const call = (
  deps: ReturnType<typeof setup>,
  overrides: Partial<Parameters<typeof reportDeliverableFailure>[0]> = {},
) =>
  reportDeliverableFailure({
    logger: deps.logger as never,
    postComment: deps.postComment as never,
    executionId: 'exec-1',
    ticketId: 't-1',
    authorName: 'Catalyst',
    title: 'Spec — storage-safe text',
    contentLength: 28_386,
    error: new Error(STORE_ERROR),
    ...overrides,
  });

describe('reportDeliverableFailure', () => {
  it('logs at error level with the deliverable title and content size', async () => {
    // AC 26. The reported symptom was an agent that "goes all the way through
    // but produces no deliverable", with nothing in the logs above `warn` to
    // explain it. Title and size are what make the row identifiable after
    // the fact.
    const deps = setup();

    await call(deps);

    expect(deps.logger.warn).not.toHaveBeenCalled();
    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        executionId: 'exec-1',
        title: 'Spec — storage-safe text',
        contentLength: 28_386,
        error: STORE_ERROR,
      }),
    );
  });

  it('posts an agent comment naming the deliverable and the store error', async () => {
    // Without this the failure is invisible in the product: the user sees a
    // missing deliverable and no explanation anywhere in the ticket.
    const deps = setup();

    await call(deps);

    expect(deps.postComment.execute).toHaveBeenCalledOnce();
    const args = deps.postComment.execute.mock.calls[0]![0] as {
      ticketId: string; authorType: string; authorName: string; body: string;
    };
    expect(args.ticketId).toBe('t-1');
    expect(args.authorType).toBe('agent');
    expect(args.authorName).toBe('Catalyst');
    expect(args.body).toContain('Spec — storage-safe text');
    expect(args.body).toContain(STORE_ERROR);
  });

  it('threads the parent comment so the notice lands in the right thread', async () => {
    const deps = setup();

    await call(deps, { parentId: 'parent-comment-1' });

    const args = deps.postComment.execute.mock.calls[0]![0] as { parentId?: string | null };
    expect(args.parentId).toBe('parent-comment-1');
  });

  it('never throws when posting the notice itself fails', async () => {
    // This runs inside a catch block on a path that must still resolve the
    // mention and finish `completed`. A throw here would turn a lost artifact
    // into a crashed execution — strictly worse than the bug being reported.
    const deps = setup();
    deps.postComment.execute.mockRejectedValue(new Error('ticket is archived'));

    await expect(call(deps)).resolves.toBeUndefined();

    expect(deps.logger.error).toHaveBeenCalledTimes(2);
  });

  it('reports a non-Error rejection without crashing on it', async () => {
    const deps = setup();

    await call(deps, { error: 'plain string rejection' });

    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ error: 'plain string rejection' }),
    );
  });
});
