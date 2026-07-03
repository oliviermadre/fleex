import { describe, it, expect, vi } from 'vitest';
import {
  parseNotionUrl,
  NOTION_IMPORT_PENDING_TAG,
  NOTION_IMPORT_FAILED_TAG,
} from '@fleex/shared';
import { ImportNotionPageUseCase } from '../../src/application/use-cases/import-notion-page.js';
import { NotionImportError } from '../../src/domain/errors.js';
import { TicketEntity } from '../../src/domain/entities/ticket.entity.js';
import type { NotionImportResult } from '../../src/application/ports/notion-import.port.js';

const HEX_ID = '2f1a3b4c5d6e7f8091a2b3c4d5e6f708';
const DASHED_ID = '2f1a3b4c-5d6e-7f80-91a2-b3c4d5e6f708';
const VALID_URL = `https://www.notion.so/Spec-Onboarding-${HEX_ID}`;

/** A promise that never settles — used to prove `execute` does not block on synthesis. */
const NEVER = (): Promise<NotionImportResult> => new Promise<NotionImportResult>(() => {});

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
  const notionImport = { synthesizePage: vi.fn() };
  const logger = makeLogger();
  const eventBus = { emit: vi.fn() };
  const uc = new ImportNotionPageUseCase(ticketStore as never, notionImport as never, logger as never);
  uc.eventBus = eventBus as never;
  return { uc, ticketStore, notionImport, logger, eventBus };
};

describe('ImportNotionPageUseCase.execute (synchronous placeholder)', () => {
  it('creates and persists a pending placeholder ticket immediately, returning it', async () => {
    // WHY: Notion synthesis is slow; blocking the request makes the optimistic card vanish on
    // navigation and feel failed. So execute() must persist a real ticket up front (reload-safe)
    // and let synthesis finish in the background.
    const { uc, ticketStore, notionImport } = makeUseCase();
    notionImport.synthesizePage.mockReturnValue(NEVER());

    const ticket = await uc.execute(VALID_URL, 'board-1');

    expect(ticket.status).toBe('backlog');
    expect(ticket.boardId).toBe('board-1');
    expect(ticket.tags).toContain(NOTION_IMPORT_PENDING_TAG);
    // The placeholder title signals work in progress until synthesis replaces it.
    expect(ticket.title.toLowerCase()).toContain('import');
    expect(ticketStore.createTicket).toHaveBeenCalledWith(ticket);
    // It is actually persisted (reload-safe), not just returned.
    await expect(ticketStore.getTicketById(ticket.id)).resolves.toBe(ticket);
  });

  it('returns without waiting for the slow synthesis to complete, but does kick it off', async () => {
    // WHY: the whole point of the async design — the HTTP request returns in well under a second
    // even though synthesis is still running. A never-resolving synthesis must NOT hang execute().
    const { uc, notionImport } = makeUseCase();
    notionImport.synthesizePage.mockReturnValue(NEVER());

    const ticket = await uc.execute(VALID_URL, 'board-1'); // would hang if execute awaited synthesis

    expect(ticket).toBeDefined();
    expect(notionImport.synthesizePage).toHaveBeenCalledTimes(1);
  });

  it('attaches a notion_page provenance link keyed off the normalized page id', async () => {
    const { uc, notionImport } = makeUseCase();
    notionImport.synthesizePage.mockReturnValue(NEVER());

    const ticket = await uc.execute(VALID_URL, 'board-1');

    expect(ticket.links).toHaveLength(1);
    expect(ticket.links[0]).toMatchObject({
      type: 'notion_page',
      ref: DASHED_ID,
      label: 'Notion page',
      url: VALID_URL,
    });
  });

  it('records a creation activity attributing the ticket to its Notion source', async () => {
    const { uc, notionImport, ticketStore } = makeUseCase();
    notionImport.synthesizePage.mockReturnValue(NEVER());

    await uc.execute(VALID_URL, 'board-1');

    expect(ticketStore.saveActivity).toHaveBeenCalledTimes(1);
    const activity = ticketStore.saveActivity.mock.calls[0]![0] as { action: string; changes: { source: { to: string } } };
    expect(activity.action).toBe('created');
    expect(activity.changes.source.to).toBe(`notion:${DASHED_ID}`);
  });

  it('rejects a non-Notion link before creating anything (NOTION_INVALID_URL)', async () => {
    const { uc, notionImport, ticketStore } = makeUseCase();

    await expect(uc.execute('https://github.com/acme/repo/issues/42', 'board-1')).rejects.toMatchObject({
      notionCode: 'NOTION_INVALID_URL',
    });
    expect(notionImport.synthesizePage).not.toHaveBeenCalled();
    expect(ticketStore.createTicket).not.toHaveBeenCalled();
  });
});

describe('ImportNotionPageUseCase.completeImport (background success)', () => {
  it('patches the title + description with the synthesis and clears the pending tag', async () => {
    // WHY: on success the placeholder becomes the real ticket — Claude's synthesis as the body,
    // a derived title, and NO lifecycle tag (the import is over).
    const { uc, notionImport, ticketStore } = makeUseCase();
    notionImport.synthesizePage.mockReturnValueOnce(NEVER()); // consumed by execute's background fire
    const ticket = await uc.execute(VALID_URL, 'board-1');

    notionImport.synthesizePage.mockResolvedValue({
      status: 'ok',
      title: 'Onboarding spec — Q3 revamp',
      synthesis: '## Summary\n\nThe page outlines the new onboarding revamp.',
    });
    await uc.completeImport(ticket.id, parseNotionUrl(VALID_URL)!);

    const reloaded = (await ticketStore.getTicketById(ticket.id))!;
    expect(reloaded.title).toBe('Onboarding spec — Q3 revamp');
    expect(reloaded.description).toContain('The page outlines the new onboarding revamp.');
    expect(reloaded.description).toContain(VALID_URL); // provenance footer preserved
    expect(reloaded.tags).not.toContain(NOTION_IMPORT_PENDING_TAG);
    expect(reloaded.tags).not.toContain(NOTION_IMPORT_FAILED_TAG);
    expect(ticketStore.saveTicket).toHaveBeenCalled();
  });

  it('emits ticket.updated so the optimistic card is replaced by the full ticket', async () => {
    // WHY: the front swaps a ticket on ticket:updated with the full DTO — that is what makes the
    // late synthesis appear even after the user navigated away and back.
    const { uc, notionImport, eventBus } = makeUseCase();
    notionImport.synthesizePage.mockReturnValueOnce(NEVER());
    const ticket = await uc.execute(VALID_URL, 'board-1');

    notionImport.synthesizePage.mockResolvedValue({ status: 'ok', title: 'T', synthesis: 'S' });
    await uc.completeImport(ticket.id, parseNotionUrl(VALID_URL)!);

    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ticket.updated', ticketId: ticket.id }),
    );
  });
});

describe('ImportNotionPageUseCase.completeImport (background failure)', () => {
  const arrangeFailedImport = async (result: NotionImportResult) => {
    const ctx = makeUseCase();
    ctx.notionImport.synthesizePage.mockReturnValueOnce(NEVER());
    const ticket = await ctx.uc.execute(VALID_URL, 'board-1');
    ctx.notionImport.synthesizePage.mockResolvedValue(result);
    await ctx.uc.completeImport(ticket.id, parseNotionUrl(VALID_URL)!);
    const reloaded = (await ctx.ticketStore.getTicketById(ticket.id))!;
    return { ...ctx, ticket, reloaded };
  };

  it('flags the ticket failed (failed tag, no pending tag) when the integration is unavailable', async () => {
    // WHY: the failure must be visible AND retryable. The failed tag is the reload-safe signal the
    // UI keys off to show "import failed" + a retry button.
    const { reloaded, eventBus } = await arrangeFailedImport({ status: 'integration_unavailable' });

    expect(reloaded.tags).toContain(NOTION_IMPORT_FAILED_TAG);
    expect(reloaded.tags).not.toContain(NOTION_IMPORT_PENDING_TAG);
    expect(reloaded.description.toLowerCase()).toContain('integration');
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ticket.updated' }),
    );
  });

  it('surfaces the inaccessibility detail in the failure description', async () => {
    const { reloaded } = await arrangeFailedImport({ status: 'inaccessible', detail: 'private page' });

    expect(reloaded.tags).toContain(NOTION_IMPORT_FAILED_TAG);
    expect(reloaded.description).toContain('private page');
  });

  it('flags failed when the page is empty', async () => {
    const { reloaded } = await arrangeFailedImport({ status: 'empty' });

    expect(reloaded.tags).toContain(NOTION_IMPORT_FAILED_TAG);
  });

  it('flags failed (not left pending) when the synthesis throws, without crashing', async () => {
    // WHY: a thrown SDK error must not leave the ticket stuck pending forever — fail loud, stay retryable.
    const { uc, notionImport, ticketStore } = makeUseCase();
    notionImport.synthesizePage.mockReturnValueOnce(NEVER());
    const ticket = await uc.execute(VALID_URL, 'board-1');

    notionImport.synthesizePage.mockRejectedValue(new Error('SDK boom'));
    await expect(uc.completeImport(ticket.id, parseNotionUrl(VALID_URL)!)).resolves.toBeUndefined();

    const reloaded = (await ticketStore.getTicketById(ticket.id))!;
    expect(reloaded.tags).toContain(NOTION_IMPORT_FAILED_TAG);
    expect(reloaded.tags).not.toContain(NOTION_IMPORT_PENDING_TAG);
  });
});

describe('ImportNotionPageUseCase.completeImport (concurrency)', () => {
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
    const { uc, ticketStore, notionImport } = makeUseCase();
    notionImport.synthesizePage.mockReturnValueOnce(NEVER()); // execute's background fire (parked)
    const ticket = await uc.execute(VALID_URL, 'board-1');

    notionImport.synthesizePage.mockImplementationOnce(async () => {
      moveToDoingFresh(ticketStore, ticket);
      return { status: 'ok', title: 'Synth title', synthesis: 'Body' };
    });

    await uc.completeImport(ticket.id, parseNotionUrl(VALID_URL)!);

    const reloaded = (await ticketStore.getTicketById(ticket.id))!;
    expect(reloaded.status).toBe('doing'); // the move survived
    expect(reloaded.title).toBe('Synth title'); // synthesis still applied on top
    expect(reloaded.tags).not.toContain(NOTION_IMPORT_PENDING_TAG);
  });

  it('preserves a concurrent column move on failure (re-reads the ticket after synthesis)', async () => {
    // WHY: the move lands regardless of how synthesis ends, so the failure path must re-read too —
    // flagging the ticket failed without reverting the user's column.
    const { uc, ticketStore, notionImport } = makeUseCase();
    notionImport.synthesizePage.mockReturnValueOnce(NEVER());
    const ticket = await uc.execute(VALID_URL, 'board-1');

    notionImport.synthesizePage.mockImplementationOnce(async () => {
      moveToDoingFresh(ticketStore, ticket);
      return { status: 'integration_unavailable' };
    });

    await uc.completeImport(ticket.id, parseNotionUrl(VALID_URL)!);

    const reloaded = (await ticketStore.getTicketById(ticket.id))!;
    expect(reloaded.status).toBe('doing'); // the move survived
    expect(reloaded.tags).toContain(NOTION_IMPORT_FAILED_TAG); // failure still flagged
  });
});

describe('ImportNotionPageUseCase.retry', () => {
  const arrangeFailed = async () => {
    const ctx = makeUseCase();
    ctx.notionImport.synthesizePage.mockReturnValueOnce(NEVER());
    const ticket = await ctx.uc.execute(VALID_URL, 'board-1');
    ctx.notionImport.synthesizePage.mockResolvedValueOnce({ status: 'integration_unavailable' });
    await ctx.uc.completeImport(ticket.id, parseNotionUrl(VALID_URL)!);
    return { ...ctx, ticket };
  };

  it('re-arms a failed ticket to pending and kicks off a fresh synthesis', async () => {
    // WHY: the retry affordance — flip failed → pending, broadcast the change so the card
    // immediately shows "importing" again, and re-run the (now hopefully working) synthesis.
    const { uc, notionImport, eventBus, ticket } = await arrangeFailed();
    const callsBefore = notionImport.synthesizePage.mock.calls.length;
    notionImport.synthesizePage.mockReturnValue(NEVER()); // keep the re-armed synthesis pending for the assertion

    const reArmed = await uc.retry(ticket.id);

    expect(reArmed.tags).toContain(NOTION_IMPORT_PENDING_TAG);
    expect(reArmed.tags).not.toContain(NOTION_IMPORT_FAILED_TAG);
    expect(notionImport.synthesizePage.mock.calls.length).toBe(callsBefore + 1);
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ticket.updated', ticketId: ticket.id }),
    );
  });

  it('throws TICKET_NOT_FOUND for an unknown ticket id', async () => {
    const { uc } = makeUseCase();
    await expect(uc.retry('does-not-exist')).rejects.toMatchObject({ code: 'TICKET_NOT_FOUND' });
  });

  it('throws NOTION_INVALID_URL when the ticket has no Notion provenance link', async () => {
    const { uc, ticketStore } = makeUseCase();
    const plain = TicketEntity.create({ id: 'plain-1', boardId: 'b', displayId: 0, title: 'No notion' });
    await ticketStore.createTicket(plain);

    await expect(uc.retry('plain-1')).rejects.toMatchObject({ notionCode: 'NOTION_INVALID_URL' });
  });
});
