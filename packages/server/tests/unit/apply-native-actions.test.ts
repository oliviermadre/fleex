import { describe, it, expect, vi } from 'vitest';
import type { NativeAction } from '@fleex/shared';
import { ApplyNativeActionsUseCase } from '../../src/application/use-cases/apply-native-actions.js';
import { ApplyTicketMutationUseCase } from '../../src/application/use-cases/apply-ticket-mutation.js';
import { NativeOperationRegistry } from '../../src/application/services/native-operations/registry.js';
import { TicketEntity } from '../../src/domain/entities/ticket.entity.js';
import { TicketNotFoundError } from '../../src/domain/errors.js';

const makeTicket = (overrides: Partial<{ status: string; tags: string[]; description: string }> = {}) =>
  TicketEntity.create({
    id: 't-1',
    boardId: 'b-1',
    displayId: 42,
    title: 'Subject',
    description: overrides.description ?? 'before',
    status: (overrides.status ?? 'backlog') as never,
    priority: 'medium',
    type: 'feature',
    position: 1,
    tags: overrides.tags ?? ['keep'],
  });

const action = (operationId: string, params: Record<string, unknown> = {}): NativeAction =>
  ({ id: `a-${operationId}`, operationId, params });

function harness(ticket: TicketEntity | null = makeTicket()) {
  const ticketStore = {
    getTicketById: vi.fn().mockResolvedValue(ticket),
    saveTicket: vi.fn(),
    saveActivity: vi.fn(),
    getBoardById: vi.fn().mockResolvedValue({ id: 'b-2' }),
    getTicketsByStatus: vi.fn().mockResolvedValue([]),
    createTicket: vi.fn(),
  };
  const eventBus = { emit: vi.fn() };
  const postComment = {
    execute: vi.fn().mockResolvedValue({ comment: { id: 'c-1' }, createdMentions: [] }),
  };
  const createTicket = { execute: vi.fn() };
  const applyTicketMutation = new ApplyTicketMutationUseCase(ticketStore as never, eventBus as never);

  const uc = new ApplyNativeActionsUseCase({
    ticketStore: ticketStore as never,
    registry: new NativeOperationRegistry(),
    createTicket: createTicket as never,
    applyTicketMutation,
    postComment: postComment as never,
  });

  const run = (actions: NativeAction[], refs?: {
    steps?: Record<string, Record<string, unknown>>;
    predecessorStepIds?: string[];
  }) => uc.execute({
    ticketId: 't-1',
    actions,
    workflowName: 'Triage',
    references: {
      steps: refs?.steps ?? {},
      predecessorStepIds: refs?.predecessorStepIds ?? [],
    },
  });

  const events = (type: string) => eventBus.emit.mock.calls
    .map(([e]) => e as { type: string })
    .filter((e) => e.type === type);

  return { uc, run, ticketStore, eventBus, postComment, createTicket, events };
}

describe('ApplyNativeActionsUseCase', () => {
  it('applies several actions in a single write, so the step cannot be half-applied', async () => {
    // The unit-of-work guarantee (AC5): whatever the number of mutating actions,
    // the subject is read once and written once. Without it, a step that failed
    // midway would leave the ticket in a state no author asked for.
    const { run, ticketStore } = harness();

    const result = await run([
      action('ticket.set_priority', { priority: 'high' }),
      action('ticket.set_title', { title: 'Renamed' }),
      action('ticket.set_blocked', { blocked: true }),
    ]);

    expect(ticketStore.getTicketById).toHaveBeenCalledTimes(1);
    expect(ticketStore.saveTicket).toHaveBeenCalledTimes(1);
    expect(result.actionsApplied).toBe(3);
    expect(result.changed).toEqual(expect.arrayContaining(['priority', 'title', 'blocked']));

    const saved = ticketStore.saveTicket.mock.calls[0]?.[0] as TicketEntity;
    expect(saved.priority).toBe('high');
    expect(saved.title).toBe('Renamed');
    expect(saved.blocked).toBe(true);
  });

  it('routes a status change through moveTo, emitting ticket.moved rather than ticket.updated', async () => {
    // AC7. Automations (auto-review, board columns, notifications) key off
    // `ticket.moved`. If the status ever travelled through `update()` it would
    // change the ticket and silently notify nobody.
    const { run, ticketStore, events } = harness();

    await run([action('ticket.set_status', { status: 'doing' })]);

    const moved = events('ticket.moved');
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({ fromStatus: 'backlog', toStatus: 'doing' });
    expect(events('ticket.updated')).toHaveLength(0);

    const activities = ticketStore.saveActivity.mock.calls.map(([a]) => (a as { action: string }).action);
    expect(activities).toContain('moved');
    expect(activities).not.toContain('updated');
  });

  it('records a move and a field change as two distinct activities in one write', async () => {
    const { run, ticketStore, events } = harness();

    await run([
      action('ticket.set_status', { status: 'doing' }),
      action('ticket.set_priority', { priority: 'high' }),
    ]);

    expect(ticketStore.saveTicket).toHaveBeenCalledTimes(1);
    const activities = ticketStore.saveActivity.mock.calls.map(([a]) => (a as { action: string }).action);
    expect(activities).toEqual(['moved', 'updated']);
    expect(events('ticket.moved')).toHaveLength(1);
  });

  it('attributes the change to the workflow, not to a user', async () => {
    // Otherwise the ticket history reads as if a human did it, and there is no
    // way to tell an automated triage from a manual one.
    const { run, ticketStore } = harness();

    await run([action('ticket.set_priority', { priority: 'low' })]);

    expect(ticketStore.saveActivity.mock.calls[0]?.[0]).toMatchObject({
      actorType: 'agent', actorName: 'Triage', source: 'api',
    });
  });

  it('consumes an upstream step output as a parameter value', async () => {
    // The motivating use case: an agent step qualifies the ticket, a native step
    // applies its verdict without a second LLM call.
    const { run, ticketStore } = harness();

    await run(
      [action('ticket.set_priority', { priority: '{{ steps.qualify.priority }}' })],
      { steps: { qualify: { priority: 'high' } } },
    );

    expect((ticketStore.saveTicket.mock.calls[0]?.[0] as TicketEntity).priority).toBe('high');
  });

  it('accepts the {{ output.* }} shorthand when the step has a single predecessor', async () => {
    const { run, ticketStore } = harness();

    await run(
      [action('ticket.set_priority', { priority: '{{ output.priority }}' })],
      { steps: { qualify: { priority: 'high' } }, predecessorStepIds: ['qualify'] },
    );

    expect((ticketStore.saveTicket.mock.calls[0]?.[0] as TicketEntity).priority).toBe('high');
  });

  it('interpolates references inside text instead of replacing the whole value', async () => {
    const { run, ticketStore } = harness();

    await run(
      [action('ticket.set_title', { title: 'Review: {{ ticket.title }} ({{ workflow }})' })],
      {},
    );

    expect((ticketStore.saveTicket.mock.calls[0]?.[0] as TicketEntity).title)
      .toBe('Review: Subject (Triage)');
  });

  it('fails loudly — and writes nothing — when a reference cannot be resolved', async () => {
    // AC17. A missing upstream output must not degrade to "" and quietly blank a
    // field: a step on a branch that did not run has to fail the step.
    const { run, ticketStore } = harness();

    await expect(
      run([action('ticket.set_priority', { priority: '{{ steps.never_ran.priority }}' })]),
    ).rejects.toThrow(/never_ran/);

    expect(ticketStore.saveTicket).not.toHaveBeenCalled();
  });

  it('rejects a resolved value the parameter does not accept, before writing', async () => {
    // Static validation cannot know what an upstream step will actually emit, so
    // the resolved value is re-checked. "P1" is not a Fleex priority.
    const { run, ticketStore } = harness();

    await expect(
      run(
        [action('ticket.set_priority', { priority: '{{ steps.qualify.priority }}' })],
        { steps: { qualify: { priority: 'P1' } } },
      ),
    ).rejects.toThrow(/Priority/);

    expect(ticketStore.saveTicket).not.toHaveBeenCalled();
  });

  it('refuses two actions writing the same field, so action order stays irrelevant', async () => {
    // AC6. If both were applied, the result would depend on the list order —
    // which is exactly the non-determinism a native step exists to avoid.
    const { run, ticketStore } = harness();

    await expect(run([
      action('ticket.add_tags', { tags: ['x'] }),
      action('ticket.remove_tags', { tags: ['keep'] }),
    ])).rejects.toThrow(/both write "tags"/);

    expect(ticketStore.saveTicket).not.toHaveBeenCalled();
  });

  it('rejects an unknown operation instead of skipping it', async () => {
    const { run, ticketStore } = harness();

    await expect(run([action('ticket.launch_missiles')])).rejects.toThrow(/unknown operation/);
    expect(ticketStore.saveTicket).not.toHaveBeenCalled();
  });

  it('rejects an empty action list', async () => {
    const { run } = harness();
    await expect(run([])).rejects.toThrow(/at least one action/);
  });

  it('reports the missing subject ticket rather than creating one', async () => {
    const { run } = harness(null);
    await expect(run([action('ticket.set_priority', { priority: 'low' })]))
      .rejects.toThrow(TicketNotFoundError);
  });

  describe('tag operations read the current ticket', () => {
    it('adds tags without dropping the existing ones', async () => {
      const { run, ticketStore } = harness(makeTicket({ tags: ['keep'] }));
      await run([action('ticket.add_tags', { tags: ['new', 'keep'] })]);
      expect((ticketStore.saveTicket.mock.calls[0]?.[0] as TicketEntity).tags).toEqual(['keep', 'new']);
    });

    it('removes only the listed tags', async () => {
      const { run, ticketStore } = harness(makeTicket({ tags: ['keep', 'drop'] }));
      await run([action('ticket.remove_tags', { tags: ['drop'] })]);
      expect((ticketStore.saveTicket.mock.calls[0]?.[0] as TicketEntity).tags).toEqual(['keep']);
    });
  });

  describe('description modes', () => {
    it('appends below the existing description', async () => {
      const { run, ticketStore } = harness(makeTicket({ description: 'before' }));
      await run([action('ticket.set_description', { description: 'added', mode: 'append' })]);
      expect((ticketStore.saveTicket.mock.calls[0]?.[0] as TicketEntity).description)
        .toBe('before\n\nadded');
    });

    it('replaces by default', async () => {
      const { run, ticketStore } = harness(makeTicket({ description: 'before' }));
      await run([action('ticket.set_description', { description: 'after' })]);
      expect((ticketStore.saveTicket.mock.calls[0]?.[0] as TicketEntity).description).toBe('after');
    });
  });

  describe('ticket.create', () => {
    const created = () => TicketEntity.create({
      id: 't-new', boardId: 'b-2', displayId: 7, title: 'Spun off',
      description: '', status: 'backlog', priority: 'medium', type: null,
      position: 0, tags: [],
    });

    it('creates the ticket and applies the following actions to it, not to the subject', async () => {
      const { run, ticketStore, createTicket } = harness();
      createTicket.execute.mockResolvedValue(created());

      const result = await run([
        action('ticket.create', { boardId: 'b-2', title: 'Spun off' }),
        action('ticket.set_priority', { priority: 'high' }),
      ]);

      expect(result.createdTicketId).toBe('t-new');
      expect(result.createdTicketDisplayId).toBe(7);
      expect(result.ticketId).toBe('t-new');
      // The mutation lands on the new ticket — the subject is untouched.
      expect((ticketStore.saveTicket.mock.calls[0]?.[0] as TicketEntity).id).toBe('t-new');
    });

    it('can seed the new ticket from the subject and from an upstream output', async () => {
      const { run, createTicket } = harness();
      createTicket.execute.mockResolvedValue(created());

      await run(
        [action('ticket.create', {
          boardId: '{{ ticket.boardId }}',
          title: '{{ steps.qualify.title }}',
          priority: '{{ steps.qualify.priority }}',
        })],
        { steps: { qualify: { title: 'Follow-up', priority: 'high' } } },
      );

      expect(createTicket.execute).toHaveBeenCalledWith(expect.objectContaining({
        boardId: 'b-1', title: 'Follow-up', priority: 'high',
      }));
    });

    it('refuses to create anywhere but first, where the rebinding is unambiguous', async () => {
      const { run, createTicket } = harness();

      await expect(run([
        action('ticket.set_priority', { priority: 'high' }),
        action('ticket.create', { boardId: 'b-2', title: 'Late' }),
      ])).rejects.toThrow(/must be the first action/);

      expect(createTicket.execute).not.toHaveBeenCalled();
    });
  });

  describe('ticket.post_comment', () => {
    it('posts as the workflow and never creates mentions', async () => {
      // Mentions would auto-trigger agents; workflows advance through edges.
      const { run, postComment } = harness();

      await run([action('ticket.post_comment', { body: 'Triaged by {{ workflow }}' })]);

      expect(postComment.execute).toHaveBeenCalledWith(expect.objectContaining({
        ticketId: 't-1', authorType: 'agent', authorName: 'Triage',
        body: 'Triaged by Triage', humanMentionNames: [],
      }));
    });

    it('does not write the ticket when no action mutates it', async () => {
      const { run, ticketStore } = harness();
      await run([action('ticket.post_comment', { body: 'note' })]);
      expect(ticketStore.saveTicket).not.toHaveBeenCalled();
    });

    it('comments on the ticket it just created, not on the subject', async () => {
      const { run, postComment, createTicket } = harness();
      createTicket.execute.mockResolvedValue(TicketEntity.create({
        id: 't-new', boardId: 'b-2', displayId: 7, title: 'Spun off',
        description: '', status: 'backlog', priority: 'medium', type: null,
        position: 0, tags: [],
      }));

      await run([
        action('ticket.create', { boardId: 'b-2', title: 'Spun off' }),
        action('ticket.post_comment', { body: 'created' }),
      ]);

      expect(postComment.execute).toHaveBeenCalledWith(expect.objectContaining({ ticketId: 't-new' }));
    });
  });
});
