import { describe, it, expect, vi } from 'vitest';
import {
  parseSlackMessageUrl,
  SLACK_IMPORT_PENDING_TAG,
  SLACK_IMPORT_FAILED_TAG,
} from '@fleex/shared';
import { ImportSlackMessageUseCase } from '../../src/application/use-cases/import-slack-message.js';
import { SlackImportError } from '../../src/domain/errors.js';
import { TicketEntity } from '../../src/domain/entities/ticket.entity.js';
import type { SlackImportResult } from '../../src/application/ports/slack-import.port.js';

const VALID_URL = 'https://acme.slack.com/archives/C01234ABCDE/p1700000000123456';
const THREADED_URL =
  'https://acme.slack.com/archives/C01234ABCDE/p1700000000123456?thread_ts=1699999999.000100&cid=C01234ABCDE';

/** A promise that never settles — used to prove `execute` does not block on synthesis. */
const NEVER = (): Promise<SlackImportResult> => new Promise<SlackImportResult>(() => {});

const makeLogger = () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() });

/** Minimal in-memory ticket store: createTicket assigns a displayId, saveTicket overwrites. */
const makeTicketStore = () => {
  const tickets = new Map<string, TicketEntity>();
  let seq = 1;
  return {
    _tickets: tickets,
    createTicket: vi.fn(async (t: TicketEntity) => {
      t.displayId = seq++;
      tickets.set(t.id, t);
    }),
    saveTicket: vi.fn(async (t: TicketEntity) => {
      tickets.set(t.id, t);
    }),
    getTicketById: vi.fn(async (id: string) => tickets.get(id) ?? null),
    saveActivity: vi.fn(async () => {}),
  };
};

const makeUseCase = () => {
  const ticketStore = makeTicketStore();
  const slackImport = { synthesizeThread: vi.fn() };
  const logger = makeLogger();
  const eventBus = { emit: vi.fn() };
  const uc = new ImportSlackMessageUseCase(ticketStore as never, slackImport as never, logger as never);
  uc.eventBus = eventBus as never;
  return { uc, ticketStore, slackImport, logger, eventBus };
};

describe('ImportSlackMessageUseCase.execute (synchronous placeholder)', () => {
  it('creates and persists a pending placeholder ticket immediately, returning it', async () => {
    // WHY: Slack synthesis takes >1min; blocking the request makes the optimistic card vanish on
    // navigation and feel failed. So execute() must persist a real ticket up front (reload-safe)
    // and let synthesis finish in the background.
    const { uc, ticketStore, slackImport } = makeUseCase();
    slackImport.synthesizeThread.mockReturnValue(NEVER());

    const ticket = await uc.execute(VALID_URL, 'board-1');

    expect(ticket.status).toBe('backlog');
    expect(ticket.boardId).toBe('board-1');
    expect(ticket.tags).toContain(SLACK_IMPORT_PENDING_TAG);
    // The placeholder title signals work in progress until synthesis replaces it.
    expect(ticket.title.toLowerCase()).toContain('import');
    expect(ticketStore.createTicket).toHaveBeenCalledWith(ticket);
    // It is actually persisted (reload-safe), not just returned.
    await expect(ticketStore.getTicketById(ticket.id)).resolves.toBe(ticket);
  });

  it('returns without waiting for the slow synthesis to complete, but does kick it off', async () => {
    // WHY: the whole point of the fix — the HTTP request returns in well under a second even though
    // synthesis is still running. A never-resolving synthesis must NOT hang execute().
    const { uc, slackImport } = makeUseCase();
    slackImport.synthesizeThread.mockReturnValue(NEVER());

    const ticket = await uc.execute(VALID_URL, 'board-1'); // would hang if execute awaited synthesis

    expect(ticket).toBeDefined();
    expect(slackImport.synthesizeThread).toHaveBeenCalledTimes(1);
  });

  it('attaches a slack_message provenance link labelled for a single message', async () => {
    const { uc, slackImport } = makeUseCase();
    slackImport.synthesizeThread.mockReturnValue(NEVER());

    const ticket = await uc.execute(VALID_URL, 'board-1');

    expect(ticket.links).toHaveLength(1);
    expect(ticket.links[0]).toMatchObject({
      type: 'slack_message',
      ref: 'C01234ABCDE/1700000000.123456',
      label: 'Slack message',
      url: VALID_URL,
    });
  });

  it('labels the provenance link "Slack thread" for a threaded reply', async () => {
    const { uc, slackImport } = makeUseCase();
    slackImport.synthesizeThread.mockReturnValue(NEVER());

    const ticket = await uc.execute(THREADED_URL, 'board-1');

    expect(ticket.links[0]?.label).toBe('Slack thread');
  });

  it('records a creation activity attributing the ticket to its Slack source', async () => {
    const { uc, slackImport, ticketStore } = makeUseCase();
    slackImport.synthesizeThread.mockReturnValue(NEVER());

    await uc.execute(VALID_URL, 'board-1');

    expect(ticketStore.saveActivity).toHaveBeenCalledTimes(1);
    const activity = ticketStore.saveActivity.mock.calls[0]![0] as { action: string; changes: { source: { to: string } } };
    expect(activity.action).toBe('created');
    expect(activity.changes.source.to).toBe('slack:C01234ABCDE/1700000000.123456');
  });

  it('rejects a non-Slack link before creating anything (SLACK_INVALID_URL)', async () => {
    const { uc, slackImport, ticketStore } = makeUseCase();

    await expect(uc.execute('https://github.com/acme/repo/issues/42', 'board-1')).rejects.toMatchObject({
      slackCode: 'SLACK_INVALID_URL',
    });
    expect(slackImport.synthesizeThread).not.toHaveBeenCalled();
    expect(ticketStore.createTicket).not.toHaveBeenCalled();
  });
});

describe('ImportSlackMessageUseCase.completeImport (background success)', () => {
  it('patches the title + description with the synthesis and clears the pending tag', async () => {
    // WHY: on success the placeholder becomes the real ticket — Claude's synthesis as the body,
    // a derived title, and NO lifecycle tag (the import is over).
    const { uc, slackImport, ticketStore } = makeUseCase();
    slackImport.synthesizeThread.mockReturnValueOnce(NEVER()); // consumed by execute's background fire
    const ticket = await uc.execute(VALID_URL, 'board-1');

    slackImport.synthesizeThread.mockResolvedValue({
      status: 'ok',
      title: 'Decide on the new onboarding flow',
      synthesis: '## Summary\n\nThe team debated two onboarding flows.',
    });
    await uc.completeImport(ticket.id, parseSlackMessageUrl(VALID_URL)!);

    const reloaded = (await ticketStore.getTicketById(ticket.id))!;
    expect(reloaded.title).toBe('Decide on the new onboarding flow');
    expect(reloaded.description).toContain('The team debated two onboarding flows.');
    expect(reloaded.description).toContain(VALID_URL); // provenance footer preserved
    expect(reloaded.tags).not.toContain(SLACK_IMPORT_PENDING_TAG);
    expect(reloaded.tags).not.toContain(SLACK_IMPORT_FAILED_TAG);
    expect(ticketStore.saveTicket).toHaveBeenCalled();
  });

  it('emits ticket.updated so the optimistic card is replaced by the full ticket', async () => {
    // WHY: the front already swaps a ticket on ticket:updated with the full DTO — that is what makes
    // the late synthesis appear even after the user navigated away and back.
    const { uc, slackImport, eventBus } = makeUseCase();
    slackImport.synthesizeThread.mockReturnValueOnce(NEVER());
    const ticket = await uc.execute(VALID_URL, 'board-1');

    slackImport.synthesizeThread.mockResolvedValue({ status: 'ok', title: 'T', synthesis: 'S' });
    await uc.completeImport(ticket.id, parseSlackMessageUrl(VALID_URL)!);

    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ticket.updated', ticketId: ticket.id }),
    );
  });
});

describe('ImportSlackMessageUseCase.completeImport (background failure)', () => {
  const arrangeFailedImport = async (result: SlackImportResult) => {
    const ctx = makeUseCase();
    ctx.slackImport.synthesizeThread.mockReturnValueOnce(NEVER());
    const ticket = await ctx.uc.execute(VALID_URL, 'board-1');
    ctx.slackImport.synthesizeThread.mockResolvedValue(result);
    await ctx.uc.completeImport(ticket.id, parseSlackMessageUrl(VALID_URL)!);
    const reloaded = (await ctx.ticketStore.getTicketById(ticket.id))!;
    return { ...ctx, ticket, reloaded };
  };

  it('flags the ticket failed (failed tag, no pending tag) when the integration is unavailable', async () => {
    // WHY: NaS wants the failure to be visible AND retryable. The failed tag is the reload-safe
    // signal the UI keys off to show "import failed" + a retry button.
    const { reloaded, eventBus } = await arrangeFailedImport({ status: 'integration_unavailable' });

    expect(reloaded.tags).toContain(SLACK_IMPORT_FAILED_TAG);
    expect(reloaded.tags).not.toContain(SLACK_IMPORT_PENDING_TAG);
    expect(reloaded.description.toLowerCase()).toContain('integration');
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ticket.updated' }),
    );
  });

  it('surfaces the inaccessibility detail in the failure description', async () => {
    const { reloaded } = await arrangeFailedImport({ status: 'inaccessible', detail: 'private channel' });

    expect(reloaded.tags).toContain(SLACK_IMPORT_FAILED_TAG);
    expect(reloaded.description).toContain('private channel');
  });

  it('flags failed when the conversation is empty', async () => {
    const { reloaded } = await arrangeFailedImport({ status: 'empty' });

    expect(reloaded.tags).toContain(SLACK_IMPORT_FAILED_TAG);
  });

  it('flags failed (not left pending) when the synthesis throws, without crashing', async () => {
    // WHY: a thrown SDK error must not leave the ticket stuck pending forever — fail loud, stay retryable.
    const { uc, slackImport, ticketStore } = makeUseCase();
    slackImport.synthesizeThread.mockReturnValueOnce(NEVER());
    const ticket = await uc.execute(VALID_URL, 'board-1');

    slackImport.synthesizeThread.mockRejectedValue(new Error('SDK boom'));
    await expect(uc.completeImport(ticket.id, parseSlackMessageUrl(VALID_URL)!)).resolves.toBeUndefined();

    const reloaded = (await ticketStore.getTicketById(ticket.id))!;
    expect(reloaded.tags).toContain(SLACK_IMPORT_FAILED_TAG);
    expect(reloaded.tags).not.toContain(SLACK_IMPORT_PENDING_TAG);
  });
});

describe('ImportSlackMessageUseCase.completeImport (concurrency)', () => {
  // A concurrent move that lands DURING synthesis, persisting a brand-new entity instance —
  // exactly how a real DB hands back a fresh row on the next load.
  const moveToDoingFresh = (
    ticketStore: ReturnType<typeof makeTicketStore>,
    placeholder: TicketEntity,
  ): TicketEntity => {
    const movedFresh = TicketEntity.create({
      id: placeholder.id,
      boardId: placeholder.boardId,
      displayId: placeholder.displayId,
      title: placeholder.title,
      description: placeholder.description,
      status: 'doing',
      tags: [...placeholder.tags],
      links: [...placeholder.links],
    });
    ticketStore._tickets.set(placeholder.id, movedFresh);
    return movedFresh;
  };

  it('preserves a concurrent column move on success (re-reads the ticket after synthesis)', async () => {
    // WHY: when a ticket is created straight into a column, the client fires moveTicket (PATCH status)
    // right after the 201 — while the multi-second synthesis is still running. completeImport must
    // patch a FRESH snapshot taken AFTER synthesis, not one captured before it, or it silently reverts
    // the user's column move back to backlog.
    const { uc, ticketStore, slackImport } = makeUseCase();
    slackImport.synthesizeThread.mockReturnValueOnce(NEVER()); // execute's background fire (parked)
    const ticket = await uc.execute(VALID_URL, 'board-1');

    slackImport.synthesizeThread.mockImplementationOnce(async () => {
      moveToDoingFresh(ticketStore, ticket);
      return { status: 'ok', title: 'Synth title', synthesis: 'Body' };
    });

    await uc.completeImport(ticket.id, parseSlackMessageUrl(VALID_URL)!);

    const reloaded = (await ticketStore.getTicketById(ticket.id))!;
    expect(reloaded.status).toBe('doing'); // the move survived
    expect(reloaded.title).toBe('Synth title'); // synthesis still applied on top
    expect(reloaded.tags).not.toContain(SLACK_IMPORT_PENDING_TAG);
  });

  it('preserves a concurrent column move on failure (re-reads the ticket after synthesis)', async () => {
    // WHY: the move lands regardless of how synthesis ends, so the failure path must re-read too —
    // flagging the ticket failed without reverting the user's column.
    const { uc, ticketStore, slackImport } = makeUseCase();
    slackImport.synthesizeThread.mockReturnValueOnce(NEVER());
    const ticket = await uc.execute(VALID_URL, 'board-1');

    slackImport.synthesizeThread.mockImplementationOnce(async () => {
      moveToDoingFresh(ticketStore, ticket);
      return { status: 'integration_unavailable' };
    });

    await uc.completeImport(ticket.id, parseSlackMessageUrl(VALID_URL)!);

    const reloaded = (await ticketStore.getTicketById(ticket.id))!;
    expect(reloaded.status).toBe('doing'); // the move survived
    expect(reloaded.tags).toContain(SLACK_IMPORT_FAILED_TAG); // failure still flagged
  });
});

describe('ImportSlackMessageUseCase.retry', () => {
  const arrangeFailed = async () => {
    const ctx = makeUseCase();
    ctx.slackImport.synthesizeThread.mockReturnValueOnce(NEVER());
    const ticket = await ctx.uc.execute(VALID_URL, 'board-1');
    ctx.slackImport.synthesizeThread.mockResolvedValueOnce({ status: 'integration_unavailable' });
    await ctx.uc.completeImport(ticket.id, parseSlackMessageUrl(VALID_URL)!);
    return { ...ctx, ticket };
  };

  it('re-arms a failed ticket to pending and kicks off a fresh synthesis', async () => {
    // WHY: the retry affordance NaS asked for — flip failed → pending, broadcast the change so the
    // card immediately shows "importing" again, and re-run the (now hopefully working) synthesis.
    const { uc, slackImport, eventBus, ticket } = await arrangeFailed();
    const callsBefore = slackImport.synthesizeThread.mock.calls.length;
    slackImport.synthesizeThread.mockReturnValue(NEVER()); // keep the re-armed synthesis pending for the assertion

    const reArmed = await uc.retry(ticket.id);

    expect(reArmed.tags).toContain(SLACK_IMPORT_PENDING_TAG);
    expect(reArmed.tags).not.toContain(SLACK_IMPORT_FAILED_TAG);
    expect(slackImport.synthesizeThread.mock.calls.length).toBe(callsBefore + 1);
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ticket.updated', ticketId: ticket.id }),
    );
  });

  it('throws TICKET_NOT_FOUND for an unknown ticket id', async () => {
    const { uc } = makeUseCase();
    await expect(uc.retry('does-not-exist')).rejects.toMatchObject({ code: 'TICKET_NOT_FOUND' });
  });

  it('throws SLACK_INVALID_URL when the ticket has no Slack provenance link', async () => {
    const { uc, ticketStore } = makeUseCase();
    const plain = TicketEntity.create({ id: 'plain-1', boardId: 'b', displayId: 0, title: 'No slack' });
    await ticketStore.createTicket(plain);

    await expect(uc.retry('plain-1')).rejects.toMatchObject({ slackCode: 'SLACK_INVALID_URL' });
  });
});
