import { describe, it, expect } from 'vitest';
import { hasUnstorableChars } from '@fleex/shared';
import type { StepOutput } from '@fleex/shared';
import { TicketDeliverableEntity } from '../../src/domain/entities/ticket-deliverable.entity.js';
import { TicketCommentEntity } from '../../src/domain/entities/ticket-comment.entity.js';
import { StepRunEntity } from '../../src/domain/entities/step-run.entity.js';
import { TicketEntity } from '../../src/domain/entities/ticket.entity.js';
import { TicketActivityEntity } from '../../src/domain/entities/ticket-activity.entity.js';

// D5 / spec §0 — no literal escape sequence, no raw NUL in source.
const cu = (n: number) => String.fromCharCode(n);
const BS = cu(92);
const NUL = cu(0);
const escOf = (ch: string) => BS + 'u' + ch.charCodeAt(0).toString(16).padStart(4, '0');
const ESC_NUL = escOf(NUL);

/** The shape that actually broke this ticket: a spec documenting an escape. */
const dirty = (label: string) => 'the ' + label + ' sentinel is ' + NUL + ' here';
const clean = (label: string) => 'the ' + label + ' sentinel is ' + ESC_NUL + ' here';

describe('TicketDeliverableEntity storage sanitization', () => {
  it('escapes title and content on create', () => {
    // AC 12 — the exact write that failed with 22P05 on attempt 1.
    const entity = TicketDeliverableEntity.create({
      id: 'd1',
      ticketId: 't1',
      agentName: 'catalyst',
      type: 'spec',
      title: dirty('title'),
      content: dirty('content'),
    });

    expect(entity.title).toBe(clean('title'));
    expect(entity.content).toBe(clean('content'));
    expect(hasUnstorableChars(entity.title)).toBe(false);
    expect(hasUnstorableChars(entity.content)).toBe(false);
  });

  it('escapes on update and still bumps the version', () => {
    // AC 13, first half — sanitizing must not swallow a real content change.
    const entity = TicketDeliverableEntity.create({
      id: 'd1', ticketId: 't1', agentName: 'catalyst',
      type: 'spec', title: 'T', content: 'original',
    });

    entity.update({ content: dirty('content') });

    expect(entity.content).toBe(clean('content'));
    expect(entity.version).toBe(2);
  });

  it('does not bump the version when the sanitized content equals what is stored', () => {
    // AC 13, second half / D2 — sanitize BEFORE the equality check. Comparing a
    // raw resubmission against the already-escaped stored value would look like
    // a change and bump `version` for nothing, on every retry.
    const entity = TicketDeliverableEntity.create({
      id: 'd1', ticketId: 't1', agentName: 'catalyst',
      type: 'spec', title: 'T', content: dirty('content'),
    });
    expect(entity.version).toBe(1);

    entity.update({ content: dirty('content') });

    expect(entity.version).toBe(1);
    expect(entity.content).toBe(clean('content'));
  });

  it('escapes a title passed to update', () => {
    const entity = TicketDeliverableEntity.create({
      id: 'd1', ticketId: 't1', agentName: 'catalyst',
      type: 'spec', title: 'T', content: 'c',
    });

    entity.update({ title: dirty('title') });

    expect(entity.title).toBe(clean('title'));
  });
});

describe('TicketCommentEntity storage sanitization', () => {
  it('escapes the body on create and still extracts mentions', () => {
    // AC 14 — sanitizing must not break mention routing, which is what makes
    // the whole agent handoff work.
    const entity = TicketCommentEntity.create({
      id: 'c1',
      ticketId: 't1',
      authorType: 'agent',
      authorName: 'catalyst',
      body: 'ready for build ' + NUL + ' @agent:builder',
    });

    expect(entity.body).toBe('ready for build ' + ESC_NUL + ' @agent:builder');
    expect(entity.mentions).toEqual(['builder']);
  });

  it('escapes the body on updateBody and still extracts mentions', () => {
    const entity = TicketCommentEntity.create({
      id: 'c1', ticketId: 't1', authorType: 'agent', authorName: 'catalyst', body: 'draft',
    });

    entity.updateBody('revised ' + NUL + ' @agent:builder');

    expect(entity.body).toBe('revised ' + ESC_NUL + ' @agent:builder');
    expect(entity.mentions).toEqual(['builder']);
  });
});

describe('StepRunEntity storage sanitization', () => {
  const dirtyOutput = (): StepOutput => ({
    deliverable: {
      title: dirty('title'),
      markdown: dirty('markdown'),
      type: 'spec',
      status: 'final',
    },
    comment: dirty('comment'),
    schemaFields: { note: dirty('field') },
    result: 'ok',
  });

  const assertClean = (output: StepOutput | null) => {
    expect(output).not.toBeNull();
    expect(output!.deliverable!.title).toBe(clean('title'));
    expect(output!.deliverable!.markdown).toBe(clean('markdown'));
    expect(output!.comment).toBe(clean('comment'));
    expect(output!.schemaFields['note']).toBe(clean('field'));
  };

  const fresh = () =>
    StepRunEntity.create({ id: 's1', workflowRunId: 'r1', stepId: 'step-1' });

  // AC 15 — all seven mutators that write `output`. Each is a distinct write
  // path to a jsonb column, so each is a distinct way to lose a step's work.
  it('escapes through complete()', () => {
    const run = fresh();
    run.complete({ output: dirtyOutput() });
    assertClean(run.output);
  });

  it('escapes through markNeedsReview()', () => {
    const run = fresh();
    run.markNeedsReview({ output: dirtyOutput() });
    assertClean(run.output);
  });

  it('escapes through markAwaitingRouting()', () => {
    const run = fresh();
    run.markAwaitingRouting({ output: dirtyOutput(), candidateEdgeIds: ['e1', 'e2'] });
    assertClean(run.output);
    expect(run.output!.routing!.candidateEdgeIds).toEqual(['e1', 'e2']);
  });

  it('escapes through resolveRoute()', () => {
    const run = fresh();
    run.output = dirtyOutput();
    run.resolveRoute({ edgeId: 'e1', decidedBy: 'nas', notes: dirty('notes') });
    assertClean(run.output);
    expect(run.output!.routing!.notes).toBe(clean('notes'));
  });

  it('escapes through resolveGate()', () => {
    const run = fresh();
    run.output = dirtyOutput();
    run.resolveGate('approved', dirty('notes'));
    assertClean(run.output);
    expect(run.output!.schemaFields['notes']).toBe(clean('notes'));
  });

  it('escapes an error message through fail()', () => {
    // A store error message can itself carry the character — that is exactly
    // how a failing save would poison the record of its own failure.
    const run = fresh();
    run.fail({ message: dirty('error') });
    expect(run.output!.schemaFields['error']).toBe(clean('error'));
  });

  it('escapes through recordHumanResponse()', () => {
    const run = fresh();
    run.markNeedsReview({ output: dirtyOutput() });
    run.recordHumanResponse(dirty('answer'));
    expect(run.output!.humanResponse).toBe(clean('answer'));
  });

  it('escapes an output assigned directly, as the workflow step does', () => {
    // D4 assigns `stepRun.output = result.output` before persisting artifacts.
    // That assignment must go through the same guard.
    const run = fresh();
    run.output = dirtyOutput();
    assertClean(run.output);
  });
});

describe('TicketEntity storage sanitization', () => {
  it('escapes title and description on create', () => {
    // AC 16
    const ticket = TicketEntity.create({
      id: 't1', boardId: 'b1', displayId: 1,
      title: dirty('title'),
      description: dirty('description'),
    });

    expect(ticket.title).toBe(clean('title'));
    expect(ticket.description).toBe(clean('description'));
  });

  it('escapes title and description on update, and reports the escaped diff', () => {
    // The diff feeds TicketActivityEntity.changes — another jsonb column. An
    // unescaped diff would move the failure from `tickets` to `ticket_activities`.
    const ticket = TicketEntity.create({
      id: 't1', boardId: 'b1', displayId: 1, title: 'T', description: 'D',
    });

    const diff = ticket.update({ title: dirty('title'), description: dirty('description') });

    expect(ticket.title).toBe(clean('title'));
    expect(ticket.description).toBe(clean('description'));
    expect(diff['title']!.to).toBe(clean('title'));
    expect(diff['description']!.to).toBe(clean('description'));
  });

  it('does not report a diff when the sanitized value equals what is stored', () => {
    // Same reasoning as the deliverable: sanitize before comparing, or every
    // idempotent resubmission writes a spurious activity row.
    const ticket = TicketEntity.create({
      id: 't1', boardId: 'b1', displayId: 1, title: dirty('title'), description: 'D',
    });

    const diff = ticket.update({ title: dirty('title') });

    expect(diff['title']).toBeUndefined();
  });
});

describe('TicketActivityEntity storage sanitization', () => {
  it('escapes a nested changes payload on create', () => {
    // AC 17
    const activity = TicketActivityEntity.create({
      id: 'a1',
      ticketId: 't1',
      action: 'updated',
      changes: { description: { from: 'old', to: dirty('to') } },
    });

    expect(activity.changes['description']!.to).toBe(clean('to'));
  });
});

describe('hydration is not sanitized (D3)', () => {
  // AC 18, formulated so it can actually fail: assert the constructor leaves an
  // unstorable character ALONE. Asserting "clean input keeps its reference"
  // would pass even if sanitization were moved into the constructor, since the
  // sanitizer returns the same reference on clean input — the test could never
  // catch the regression it exists to prevent.
  //
  // Constructors serve `rowToEntity`, where data is already clean by
  // construction. Walking a JSON tree there would cost on every single read.
  it('TicketDeliverableEntity constructor does not touch content', () => {
    const raw = dirty('content');
    const now = new Date();
    const entity = new TicketDeliverableEntity(
      'd1', 't1', 'catalyst', 'spec', raw, raw, 1, 'final', null, now, now,
    );

    expect(entity.title).toBe(raw);
    expect(entity.content).toBe(raw);
  });

  it('StepRunEntity constructor does not walk output', () => {
    const output: StepOutput = { schemaFields: { note: dirty('field') }, result: 'ok' };
    const run = new StepRunEntity(
      's1', 'r1', 'step-1', 1, 'completed', 'ok', output, null, null, null, null, new Date(),
    );

    expect(run.output).toBe(output);
    expect(run.output!.schemaFields['note']).toBe(dirty('field'));
  });
});
