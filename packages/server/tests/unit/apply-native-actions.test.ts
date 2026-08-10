import { describe, it, expect, vi } from 'vitest';
import type { NativeAction } from '@fleex/shared';
import {
  ApplyNativeActionsUseCase,
  NativeActionsPartialFailure,
} from '../../src/application/use-cases/apply-native-actions.js';
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
  const triggerWorkflowRun = vi.fn().mockResolvedValue({ id: 'run-child' });
  const ticketStore = {
    getTicketById: vi.fn().mockResolvedValue(ticket),
    saveTicket: vi.fn(),
    saveActivity: vi.fn(),
    getBoardById: vi.fn().mockResolvedValue({ id: 'b-2' }),
    getTicketsByStatus: vi.fn().mockResolvedValue([]),
    getTicketsLinkedTo: vi.fn().mockResolvedValue([]),
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
    eventBus: eventBus as never,
    triggerWorkflowRun,
  });

  const run = (actions: NativeAction[], refs?: {
    steps?: Record<string, Record<string, unknown>>;
    predecessorStepIds?: string[];
    item?: unknown;
  }, extra?: { ticketId?: string | null; subjectBoardId?: string | null; workflowRunId?: string }) => uc.execute({
    ticketId: extra && 'ticketId' in extra ? extra.ticketId : 't-1',
    subjectBoardId: extra?.subjectBoardId ?? null,
    workflowRunId: extra?.workflowRunId ?? 'run-1',
    actions,
    workflowName: 'Triage',
    references: {
      steps: refs?.steps ?? {},
      predecessorStepIds: refs?.predecessorStepIds ?? [],
      ...(refs && 'item' in refs ? { item: refs.item } : {}),
    },
  });

  const events = (type: string) => eventBus.emit.mock.calls
    .map(([e]) => e as { type: string })
    .filter((e) => e.type === type);

  return { uc, run, ticketStore, eventBus, postComment, createTicket, events, triggerWorkflowRun };
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

  it('digs into an upstream object field with a deep reference', async () => {
    // The webhook case: the trigger step publishes `issue` as one object, and a
    // deterministic template reads {{ steps.t.issue.title }} with no agent hop.
    const { run, ticketStore } = harness();

    await run(
      [action('ticket.set_title', { title: '{{ steps.t.issue.title }}' })],
      { steps: { t: { issue: { title: 'Deep title', number: 7 } } } },
    );

    expect((ticketStore.saveTicket.mock.calls[0]?.[0] as TicketEntity).title).toBe('Deep title');
  });

  it('fails loudly on a deep path the output does not contain', async () => {
    const { run } = harness();

    await expect(run(
      [action('ticket.set_title', { title: '{{ steps.t.issue.titel }}' })],
      { steps: { t: { issue: { title: 'Deep title' } } } },
    )).rejects.toThrow(/has no "titel"/);
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

    it('rejects a second create before the first one writes anything', async () => {
      // The dangerous shape: the leading create satisfies the placement rule, so
      // a check that only looked at the *first* create would let it commit a
      // ticket and reject the duplicate afterwards — the exact partial write the
      // validate-everything-first ordering exists to prevent.
      const { run, createTicket } = harness();
      createTicket.execute.mockResolvedValue(created());

      await expect(run([
        action('ticket.create', { boardId: 'b-2', title: 'First' }),
        action('ticket.set_priority', { priority: 'high' }),
        action('ticket.create', { boardId: 'b-2', title: 'Second' }),
      ])).rejects.toThrow(/only one subject-creating action/);

      expect(createTicket.execute).not.toHaveBeenCalled();
    });
  });

  describe('ticket.upsert', () => {
    const created = () => TicketEntity.create({
      id: 't-new', boardId: 'b-2', displayId: 7, title: 'Imported',
      description: '', status: 'backlog', priority: 'medium', type: null,
      position: 0, tags: [],
    });
    const imported = (overrides: { tags?: string[]; createdAt?: Date } = {}) => {
      const t = TicketEntity.create({
        id: 't-imported', boardId: 'b-2', displayId: 9, title: 'Already there',
        description: 'old', status: 'todo', priority: 'low', type: null,
        position: 0, tags: overrides.tags ?? ['keep'],
      });
      if (overrides.createdAt) (t as { createdAt: Date }).createdAt = overrides.createdAt;
      return t;
    };

    it('creates the ticket with the external link when nothing matches the ref', async () => {
      const { run, ticketStore, createTicket } = harness();
      createTicket.execute.mockResolvedValue(created());

      const result = await run([
        action('ticket.upsert', { externalRef: 'linear:ABC-42', boardId: 'b-2', title: 'Imported', url: 'https://linear.app/ABC-42' }),
      ]);

      expect(ticketStore.getTicketsLinkedTo).toHaveBeenCalledWith('external', 'linear:ABC-42');
      expect(createTicket.execute).toHaveBeenCalledWith(expect.objectContaining({
        boardId: 'b-2',
        title: 'Imported',
        links: [{ type: 'external', ref: 'linear:ABC-42', label: 'linear:ABC-42', url: 'https://linear.app/ABC-42' }],
      }));
      expect(result.wasCreated).toBe(true);
      expect(result.createdTicketId).toBe('t-new');
    });

    it('skip: binds the match and stops the remaining actions — the step is idempotent, not just the create', async () => {
      // The dark-factory guarantee: an already imported item must not re-trigger
      // the delivery workflow on every poll.
      const { run, ticketStore, createTicket, triggerWorkflowRun } = harness();
      ticketStore.getTicketsLinkedTo.mockResolvedValue([imported()]);

      const result = await run([
        action('ticket.upsert', { externalRef: 'linear:ABC-42', boardId: 'b-2', title: 'Imported' }),
        action('ticket.set_priority', { priority: 'high' }),
        action('workflow.trigger', { templateSlug: 'delivery' }),
      ]);

      expect(createTicket.execute).not.toHaveBeenCalled();
      expect(triggerWorkflowRun).not.toHaveBeenCalled();
      expect(ticketStore.saveTicket).not.toHaveBeenCalled();
      expect(result).toMatchObject({ ticketId: 't-imported', wasCreated: false, actionsApplied: 1 });
      expect(result.createdTicketId).toBeUndefined();
    });

    it('update: patches the match in one write, adding tags instead of replacing them', async () => {
      const { run, ticketStore, createTicket } = harness();
      ticketStore.getTicketsLinkedTo.mockResolvedValue([imported({ tags: ['keep'] })]);

      const result = await run([
        action('ticket.upsert', {
          externalRef: 'linear:ABC-42', onExisting: 'update',
          title: 'Refreshed', description: 'new body', tags: ['source:linear', 'keep'],
        }),
      ]);

      expect(createTicket.execute).not.toHaveBeenCalled();
      expect(ticketStore.saveTicket).toHaveBeenCalledTimes(1);
      const saved = ticketStore.saveTicket.mock.calls[0]?.[0] as TicketEntity;
      expect(saved.id).toBe('t-imported');
      expect(saved.title).toBe('Refreshed');
      expect(saved.description).toBe('new body');
      expect(saved.tags).toEqual(['keep', 'source:linear']);
      expect(result.wasCreated).toBe(false);
    });

    it('a match needs no board — a routine run without one must still converge', async () => {
      // The board cascade only runs when a ticket is actually created; on a
      // match the missing board is irrelevant and must not fail the iteration.
      const { run, ticketStore } = harness(null);
      ticketStore.getTicketsLinkedTo.mockResolvedValue([imported()]);

      const result = await run(
        [action('ticket.upsert', { externalRef: 'linear:ABC-42', title: 'Imported' })],
        {},
        { ticketId: null, subjectBoardId: null },
      );

      expect(result).toMatchObject({ ticketId: 't-imported', wasCreated: false });
    });

    it('exposes {{ created.* }} for the found ticket on the update path', async () => {
      const { run, postComment, ticketStore } = harness();
      ticketStore.getTicketsLinkedTo.mockResolvedValue([imported()]);

      await run([
        action('ticket.upsert', { externalRef: 'linear:ABC-42', onExisting: 'update', title: 'Refreshed' }),
        action('ticket.post_comment', { body: 'Upserted as #{{ created.displayId }}' }),
      ]);

      expect(postComment.execute).toHaveBeenCalledWith(expect.objectContaining({
        body: 'Upserted as #9',
      }));
    });

    it('converges on the oldest match when a race left several', async () => {
      const { run, ticketStore } = harness();
      const older = imported({ createdAt: new Date('2026-01-01') });
      const newer = TicketEntity.create({
        id: 't-dupe', boardId: 'b-2', displayId: 11, title: 'Race dupe',
        description: '', status: 'backlog', priority: 'none', type: null,
        position: 0, tags: [],
      });
      ticketStore.getTicketsLinkedTo.mockResolvedValue([newer, older]);

      const result = await run([
        action('ticket.upsert', { externalRef: 'linear:ABC-42', title: 'Imported' }),
      ]);

      expect(result.ticketId).toBe('t-imported');
    });

    it('rejects an upsert combined with a create in the same step', async () => {
      const { run, createTicket } = harness();

      await expect(run([
        action('ticket.upsert', { externalRef: 'linear:ABC-42', title: 'Imported' }),
        action('ticket.create', { boardId: 'b-2', title: 'Second' }),
      ])).rejects.toThrow(/only one subject-creating action/);

      expect(createTicket.execute).not.toHaveBeenCalled();
    });
  });

  describe('ticket.post_comment', () => {
    it('posts as the workflow and never creates mentions', async () => {
      // Mentions would auto-trigger agents; workflows advance through edges.
      const { run, postComment, events } = harness();

      await run([action('ticket.post_comment', { body: 'Triaged by {{ workflow }}' })]);

      expect(postComment.execute).toHaveBeenCalledWith(expect.objectContaining({
        ticketId: 't-1', authorType: 'agent', authorName: 'Triage',
        body: 'Triaged by Triage',
      }));
      expect(events('comment.posted')[0]).toMatchObject({ createdMentions: [] });
    });

    it('announces the comment so an open thread shows it without a remount', async () => {
      // WHY: persisting is only half the job — the WebSocket push that inserts
      // the comment into a thread the reader is already looking at is driven by
      // `comment.posted`. Without it a multi-action step (set status + comment)
      // ends with the run marked done and the comment nowhere to be seen until
      // the reader switches tabs and comes back.
      const { run, events } = harness();

      await run([
        action('ticket.set_status', { status: 'done' }),
        action('ticket.post_comment', { body: 'QA passed' }),
      ]);

      expect(events('comment.posted')).toEqual([
        expect.objectContaining({ commentId: 'c-1', ticketId: 't-1', authorName: 'Triage' }),
      ]);
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

  describe('failure after a write has committed', () => {
    it('reports the mutation that landed instead of claiming nothing happened', async () => {
      // Effects run after the single write, so they are outside its atomicity.
      // If the comment blows up, the status change is already durable — saying
      // "0 actions applied" would describe a ticket that was touched as one that
      // was not, and any recovery branch downstream would act on a false premise.
      const { run, postComment, ticketStore } = harness();
      postComment.execute.mockRejectedValue(new Error('comment backend down'));

      const error = await run([
        action('ticket.set_status', { status: 'doing' }),
        action('ticket.post_comment', { body: 'note' }),
      ]).catch((e: unknown) => e);

      expect(ticketStore.saveTicket).toHaveBeenCalledOnce(); // the write did happen
      expect(error).toBeInstanceOf(NativeActionsPartialFailure);
      expect((error as NativeActionsPartialFailure).message).toMatch(/comment backend down/);
      expect((error as NativeActionsPartialFailure).committed).toMatchObject({
        ticketId: 't-1', actionsApplied: 1, changed: expect.arrayContaining(['status']),
      });
    });

    it('leaves a failure that committed nothing as a plain error', async () => {
      // Wrapping it would imply a partial write that never happened.
      const { run } = harness();
      const error = await run([action('ticket.set_status', { status: 'nope' })])
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(NativeActionsPartialFailure);
    });

    it('counts only the actions that committed, not the ones that were requested', async () => {
      const { run, postComment } = harness();
      postComment.execute.mockRejectedValue(new Error('nope'));

      const error = await run([
        action('ticket.set_status', { status: 'doing' }),
        action('ticket.set_priority', { priority: 'high' }),
        action('ticket.post_comment', { body: 'a' }),
      ]).catch((e: unknown) => e) as NativeActionsPartialFailure;

      expect(error.committed.actionsApplied).toBe(2);
    });
  });

  describe('{{ created.* }} — the two-pass resolution', () => {
    const created = () => TicketEntity.create({
      id: 't-new', boardId: 'b-2', displayId: 7, title: 'Spun off',
      description: '', status: 'backlog', priority: 'medium', type: null,
      position: 0, tags: [],
    });

    it('substitutes the identifiers of the ticket the step just created', async () => {
      // Impossible in one pass: the id does not exist until the create commits,
      // and the create cannot commit until everything has been validated.
      const { run, postComment, createTicket } = harness();
      createTicket.execute.mockResolvedValue(created());

      await run([
        action('ticket.create', { boardId: 'b-2', title: 'Spun off' }),
        action('ticket.post_comment', { body: 'Spun off as #{{ created.displayId }} ({{ created.id }})' }),
      ]);

      expect(postComment.execute).toHaveBeenCalledWith(expect.objectContaining({
        body: 'Spun off as #7 (t-new)',
      }));
    });

    it('still rejects every *other* unresolvable reference before writing anything', async () => {
      // Tolerating `created.*` in the pre-write pass must not turn that pass
      // into a no-op: it is the only thing standing between a typo and a
      // half-applied step.
      const { run, createTicket } = harness();

      await expect(run([
        action('ticket.create', { boardId: 'b-2', title: 'Spun off' }),
        action('ticket.post_comment', { body: '{{ created.id }} / {{ steps.ghost.x }}' }),
      ])).rejects.toThrow(/ghost/);

      expect(createTicket.execute).not.toHaveBeenCalled();
    });

    it('refuses a created reference when the step creates nothing', async () => {
      const { run, ticketStore } = harness();

      await expect(run([action('ticket.post_comment', { body: '{{ created.id }}' })]))
        .rejects.toThrow(/no ticket was created/);

      expect(ticketStore.saveTicket).not.toHaveBeenCalled();
    });

    it('refuses a created reference inside the create itself, rather than writing the raw token', async () => {
      const { run, createTicket } = harness();

      await expect(run([action('ticket.create', { boardId: 'b-2', title: '{{ created.id }}' })]))
        .rejects.toThrow(/no ticket was created/);

      expect(createTicket.execute).not.toHaveBeenCalled();
    });
  });

  describe('runs without a subject ticket (routine runs)', () => {
    const created = () => TicketEntity.create({
      id: 't-new', boardId: 'b-routine', displayId: 7, title: 'From a routine',
      description: '', status: 'backlog', priority: 'medium', type: null,
      position: 0, tags: [],
    });

    it('falls back to the routine subject board when {{ ticket.boardId }} has no ticket', async () => {
      // `boardId` defaults to `{{ ticket.boardId }}`. In a routine run that
      // reference has nothing to read, so it is dropped and the subject's board
      // answers — otherwise every routine template would need the board hard-coded.
      const { run, createTicket, ticketStore } = harness();
      createTicket.execute.mockResolvedValue(created());

      await run(
        [action('ticket.create', { boardId: '{{ ticket.boardId }}', title: 'From a routine' })],
        {},
        { ticketId: null, subjectBoardId: 'b-routine' },
      );

      expect(ticketStore.getTicketById).not.toHaveBeenCalled();
      expect(createTicket.execute).toHaveBeenCalledWith(expect.objectContaining({ boardId: 'b-routine' }));
    });

    it('prefers an explicit board over the routine subject', async () => {
      const { run, createTicket } = harness();
      createTicket.execute.mockResolvedValue(created());

      await run(
        [action('ticket.create', { boardId: 'b-explicit', title: 'x' })],
        {},
        { ticketId: null, subjectBoardId: 'b-routine' },
      );

      expect(createTicket.execute).toHaveBeenCalledWith(expect.objectContaining({ boardId: 'b-explicit' }));
    });

    it('names the missing board instead of dropping the ticket into an arbitrary one', async () => {
      const { run, createTicket } = harness();

      await expect(run(
        [action('ticket.create', { boardId: '{{ ticket.boardId }}', title: 'x' })],
        {},
        { ticketId: null, subjectBoardId: null },
      )).rejects.toThrow(/has no board/);

      expect(createTicket.execute).not.toHaveBeenCalled();
    });

    it('refuses an operation that needs a subject ticket, by name', async () => {
      // Better than a null-deref inside a planner: the message tells the author
      // which action cannot work in a routine and why.
      const { run } = harness();

      await expect(run(
        [action('ticket.set_priority', { priority: 'high' })],
        {},
        { ticketId: null },
      )).rejects.toThrow(/needs a subject ticket; a routine run has none/);
    });
  });

  describe('{{ item.* }}', () => {
    it('reads the element the fan-out bound for this iteration', async () => {
      const { run, ticketStore } = harness();

      await run(
        [action('ticket.set_title', { title: 'Fix {{ item.file }}' })],
        { item: { file: 'src/a.ts' } },
      );

      expect((ticketStore.saveTicket.mock.calls[0]?.[0] as TicketEntity).title).toBe('Fix src/a.ts');
    });

    it('fails the iteration when the element has no such field, rather than blanking it', async () => {
      // A blanked title on 30 tickets is silent data loss; a failed iteration is
      // one line in `failures` the author can act on.
      const { run, ticketStore } = harness();

      await expect(run(
        [action('ticket.set_title', { title: '{{ item.missing }}' })],
        { item: { file: 'src/a.ts' } },
      )).rejects.toThrow(/item has no "missing"/);

      expect(ticketStore.saveTicket).not.toHaveBeenCalled();
    });

    it('refuses an item reference outside a fan-out', async () => {
      const { run } = harness();
      await expect(run([action('ticket.set_title', { title: '{{ item }}' })]))
        .rejects.toThrow(/no item in scope/);
    });
  });

  describe('workflow.trigger', () => {
    it('starts the workflow on the ticket the step just created', async () => {
      // The composition Lot 2 exists for: create a ticket, then hand it to
      // another workflow. It works because effects run after the create has
      // rebound the subject.
      const { run, createTicket, triggerWorkflowRun } = harness();
      createTicket.execute.mockResolvedValue(TicketEntity.create({
        id: 't-new', boardId: 'b-2', displayId: 7, title: 'Spun off',
        description: '', status: 'backlog', priority: 'medium', type: null,
        position: 0, tags: [],
      }));

      const result = await run([
        action('ticket.create', { boardId: 'b-2', title: 'Spun off' }),
        action('workflow.trigger', { templateSlug: 'auto-review' }),
      ]);

      expect(triggerWorkflowRun).toHaveBeenCalledWith({
        templateSlug: 'auto-review', ticketId: 't-new',
        triggeredBy: 'workflow:Triage', parentRunId: 'run-1',
      });
      // The child run id travels back so a downstream edge can route on it.
      expect(result.triggeredRunIds).toEqual(['run-child']);
    });

    it('passes the current run as the parent, which is what bounds recursion', async () => {
      const { run, triggerWorkflowRun } = harness();
      await run([action('workflow.trigger', { templateSlug: 'auto-review' })]);
      expect(triggerWorkflowRun.mock.calls[0]?.[0]).toMatchObject({ parentRunId: 'run-1' });
    });

    it('says there is nothing to run the workflow on rather than creating an orphan run', async () => {
      const { run } = harness();
      await expect(run(
        [action('workflow.trigger', { templateSlug: 'auto-review' })],
        {},
        { ticketId: null },
      )).rejects.toThrow(/no ticket to run "auto-review" on/);
    });
  });

  it('reports every action as applied on the happy path', async () => {
    const { run } = harness();
    const result = await run([
      action('ticket.set_status', { status: 'doing' }),
      action('ticket.set_priority', { priority: 'high' }),
      action('ticket.post_comment', { body: 'a' }),
    ]);
    expect(result.actionsApplied).toBe(3);
  });
});
