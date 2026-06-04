import { describe, it, expect, vi } from 'vitest';
import { ImportSlackMessageUseCase } from '../../src/application/use-cases/import-slack-message.js';
import { SlackImportError } from '../../src/domain/errors.js';
import type { SlackImportResult } from '../../src/application/ports/slack-import.port.js';

const VALID_URL = 'https://acme.slack.com/archives/C01234ABCDE/p1700000000123456';
const THREADED_URL =
  'https://acme.slack.com/archives/C01234ABCDE/p1700000000123456?thread_ts=1699999999.000100&cid=C01234ABCDE';

const makeLogger = () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() });
const makeTicketStore = () => ({ createTicket: vi.fn(), saveActivity: vi.fn() });

/** Build a use case whose Slack port returns exactly `result`. */
const makeUseCase = (result: SlackImportResult) => {
  const ticketStore = makeTicketStore();
  const slackImport = { synthesizeThread: vi.fn().mockResolvedValue(result) };
  const logger = makeLogger();
  const uc = new ImportSlackMessageUseCase(ticketStore as never, slackImport as never, logger as never);
  return { uc, ticketStore, slackImport, logger };
};

describe('ImportSlackMessageUseCase', () => {
  it('creates a backlog ticket from a successful synthesis, with the synthesis as description', async () => {
    // WHY: the whole point of the feature — a pasted Slack link becomes a ticket whose body is
    // Claude's faithful synthesis, NOT raw Slack content (which Fleex never persists).
    const { uc, ticketStore } = makeUseCase({
      status: 'ok',
      title: 'Decide on the new onboarding flow',
      synthesis: '## Summary\n\nThe team debated two onboarding flows.',
    });

    const ticket = await uc.execute(VALID_URL, 'board-1');

    expect(ticket.title).toBe('Decide on the new onboarding flow');
    expect(ticket.status).toBe('backlog');
    expect(ticket.boardId).toBe('board-1');
    expect(ticket.description).toContain('The team debated two onboarding flows.');
    // The provenance URL is appended so the ticket links back to its Slack origin.
    expect(ticket.description).toContain(VALID_URL);
    expect(ticketStore.createTicket).toHaveBeenCalledWith(ticket);
  });

  it('attaches a slack_message provenance link keyed by channel id + message ts', async () => {
    // WHY: the link's ref is the stable (channel, ts) identity — independent of query params —
    // so two imports of the same message are recognizably the same source. The label is the
    // word "message" because this permalink targets a root message, not a reply.
    const { uc } = makeUseCase({ status: 'ok', title: 'T', synthesis: 'S' });

    const ticket = await uc.execute(VALID_URL, 'board-1');

    expect(ticket.links).toHaveLength(1);
    expect(ticket.links[0]).toMatchObject({
      type: 'slack_message',
      ref: 'C01234ABCDE/1700000000.123456',
      label: 'Slack message',
      url: VALID_URL,
    });
  });

  it('labels the link "Slack thread" when the permalink points to a threaded reply', async () => {
    // WHY: a reply carries ?thread_ts=<parent> — the label must reflect that the imported
    // content is a thread, so the reviewer knows the description spans multiple messages.
    const { uc } = makeUseCase({ status: 'ok', title: 'T', synthesis: 'S' });

    const ticket = await uc.execute(THREADED_URL, 'board-1');

    expect(ticket.links[0]?.label).toBe('Slack thread');
  });

  it('records a creation activity attributing the ticket to its Slack source', async () => {
    // WHY: the activity trail must show WHERE the ticket came from, mirroring the github:<...>
    // provenance written by the GitHub import, so the timeline is auditable.
    const { uc, ticketStore } = makeUseCase({ status: 'ok', title: 'T', synthesis: 'S' });

    await uc.execute(VALID_URL, 'board-1');

    expect(ticketStore.saveActivity).toHaveBeenCalledTimes(1);
    const activity = ticketStore.saveActivity.mock.calls[0][0];
    expect(activity.action).toBe('created');
    expect(activity.changes.source.to).toBe('slack:C01234ABCDE/1700000000.123456');
  });

  it('rejects a non-Slack link before ever calling the integration (US7)', async () => {
    // WHY: an invalid link is a client mistake — fail fast with SLACK_INVALID_URL and never
    // burn an SDK slot on a URL we already know is unusable.
    const { uc, slackImport, ticketStore } = makeUseCase({ status: 'ok', title: 'T', synthesis: 'S' });

    await expect(uc.execute('https://github.com/acme/repo/issues/42', 'board-1')).rejects.toMatchObject({
      slackCode: 'SLACK_INVALID_URL',
    });
    expect(slackImport.synthesizeThread).not.toHaveBeenCalled();
    expect(ticketStore.createTicket).not.toHaveBeenCalled();
  });

  it('surfaces an unavailable Slack integration as SLACK_INTEGRATION_UNAVAILABLE (US5)', async () => {
    const { uc, ticketStore } = makeUseCase({ status: 'integration_unavailable' });

    const err = await uc.execute(VALID_URL, 'board-1').catch((e) => e);
    expect(err).toBeInstanceOf(SlackImportError);
    expect((err as SlackImportError).slackCode).toBe('SLACK_INTEGRATION_UNAVAILABLE');
    expect(ticketStore.createTicket).not.toHaveBeenCalled();
  });

  it('surfaces an unreadable conversation as SLACK_CONVERSATION_INACCESSIBLE, including the detail (US6)', async () => {
    const { uc } = makeUseCase({ status: 'inaccessible', detail: 'private channel' });

    const err = (await uc.execute(VALID_URL, 'board-1').catch((e) => e)) as SlackImportError;
    expect(err.slackCode).toBe('SLACK_CONVERSATION_INACCESSIBLE');
    // The reviewer-facing message must carry the reason so they know why it failed.
    expect(err.message).toContain('private channel');
  });

  it('still classifies an inaccessible conversation without a detail', async () => {
    const { uc } = makeUseCase({ status: 'inaccessible' });

    const err = (await uc.execute(VALID_URL, 'board-1').catch((e) => e)) as SlackImportError;
    expect(err.slackCode).toBe('SLACK_CONVERSATION_INACCESSIBLE');
  });

  it('surfaces an empty conversation as SLACK_CONVERSATION_EMPTY', async () => {
    const { uc, ticketStore } = makeUseCase({ status: 'empty' });

    const err = (await uc.execute(VALID_URL, 'board-1').catch((e) => e)) as SlackImportError;
    expect(err.slackCode).toBe('SLACK_CONVERSATION_EMPTY');
    expect(ticketStore.createTicket).not.toHaveBeenCalled();
  });
});
