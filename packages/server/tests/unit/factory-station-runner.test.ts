/** A station presented to the workflow step executors as a one-step workflow: what it asks them, and how it reads their answer. */
import { describe, it, expect, vi } from 'vitest';
import { StationRunner } from '../../src/factory/station-runner.js';
import type { FactoryItemRow, FactoryRunRow, StationSpec } from '../../src/factory/types.js';
import type { StepExecutionInput } from '../../src/application/services/step-executors/types.js';

const station = (over: Partial<StationSpec> = {}): StationSpec => ({ id: 's1', kind: 'station', x: 0, y: 0, w: 3, h: 3, name: 'Triage', exec: 'agent', ref: 'sentinel', mode: 'plan', prompt: 'Sort it.', outcomes: ['bug', 'feature'], cap: 8, ...over });

function runner(output: Record<string, unknown> = { result: 'ok', schemaFields: { outcome: 'feature' }, comment: null, deliverable: null }) {
  const seen: StepExecutionInput[] = [], posted: unknown[] = [], delivered: Record<string, unknown>[] = [];
  const executor = { execute: vi.fn(async (input: StepExecutionInput) => { seen.push(input); input.onExecutionStarted?.('exec-1'); return { output, executionId: 'exec-1' }; }) };
  const r = new StationRunner({
    executors: { agent: executor, skill: executor, panel: executor } as never,
    submitDeliverable: { execute: vi.fn(async (p: Record<string, unknown>) => { delivered.push(p); return { id: 'd1', title: p['title'] }; }) } as never,
    postComment: { execute: vi.fn(async (p: unknown) => { posted.push(p); return { comment: { id: 'c1' } }; }) } as never,
    agentEventStore: { setExecutionOutputs: vi.fn() } as never, eventBus: { emit: vi.fn() } as never,
  });
  return { r, seen, posted, delivered };
}
const item = (over: Partial<FactoryItemRow> = {}): FactoryItemRow => ({
  id: 'i1', floorId: 'default', source: 'slack', sourceKey: 'T/C/1', title: 'Can you look at the cart?', author: 'Ana', excerpt: 'It forgets its items since Monday.',
  url: 'https://x.slack.com/a', tags: ['team:shop'], fields: { channel: '#shop', kind: 'mention', bot: false }, messages: 3, lastActivityAt: '2026-11-20T09:00:00.000Z', intakeId: 'in', machineId: 's1', state: null,
  archivedAt: null, archivedReason: null, createdAt: '2026-11-20T08:00:00.000Z', updatedAt: '2026-11-20T09:00:00.000Z', ...over,
});

describe('StationRunner', () => {
  it('asks the agent for one of the station\'s outcomes and tells it where each leads', async () => {
    const { r, seen } = runner();
    const started: string[] = [];
    const res = await r.run(station(), 't1', 'run-1', { bug: 'Fix line', feature: 'Spec' }, (id) => started.push(id));
    expect(res).toEqual({ status: 'completed', outcome: 'feature', executionId: 'exec-1', error: null });
    expect(started).toEqual(['exec-1']);
    const input = seen[0]!;
    expect(input.step).toMatchObject({ name: 'Triage', executorType: 'agent', executorRef: 'sentinel', mode: 'plan', prompt: 'Sort it.' });
    expect(input.step.outputSchema).toMatchObject({ properties: { outcome: { enum: ['bug', 'feature'] } }, required: ['outcome'] });
    expect(input.workflowContext.outgoingEdges.map((e) => [e.label, e.targetName])).toEqual([['bug', 'Fix line'], ['feature', 'Spec']]);
    /* a long artifact goes to the ticket: the run id names no workflow run */
    expect(input.workflowContext.attachTo).toEqual({ ticketId: 't1', agentName: 'Factory → Triage' });
  });

  it('runs an agent or skill station on its own model when it has one, and on the persona\'s otherwise', async () => {
    const { r, seen } = runner();
    await r.run(station({ model: 'claude-haiku-5-5' }), 't1', 'run-1', {}, () => {});
    await r.run(station(), 't1', 'run-2', {}, () => {});
    await r.run(station({ exec: 'skill', model: 'claude-haiku-5-5' }), 't1', 'run-3', {}, () => {});
    await r.run(station({ exec: 'skill' }), 't1', 'run-4', {}, () => {});
    await r.run(station({ exec: 'panel', model: 'claude-haiku-5-5' }), 't1', 'run-5', {}, () => {});   // a panel runs on its orchestrator's
    expect(seen.map((i) => i.modelOverride)).toEqual(['claude-haiku-5-5', null, 'claude-haiku-5-5', null, null]);
  });

  it('runs on an item with no ticket: the item in words is its brief, what stations said before comes after, and what it writes is handed back', async () => {
    const { r, seen, posted, delivered } = runner({ result: 'ok', schemaFields: { outcome: 'bug' }, comment: 'A bug in the cart: worth a ticket.', deliverable: { type: 'note', title: 'Triage', markdown: '# Why' } });
    const earlier: FactoryRunRow[] = [{ id: 'r0', ticketId: 'i1', floorId: 'default', machineId: 'g', machineName: 'Read', executor: 'agent', status: 'completed', outcome: 'ok', executionId: null, error: null, startedAt: '', finishedAt: '', reply: 'Ana is the shop lead.', deliverableId: null }];
    const res = await r.run(station(), 'i1', 'run-1', { bug: 'Fix line', feature: 'Spec' }, () => {}, { item: item(), earlier });
    expect(seen[0]!.workflowContext.attachTo).toBeNull();                     // an item has no ticket to attach to
    expect(res).toEqual({ status: 'completed', outcome: 'bug', executionId: 'exec-1', error: null, reply: 'A bug in the cart: worth a ticket.', deliverableId: 'd1' });
    const input = seen[0]!;
    expect(input.ticketId).toBeNull();
    expect(input.subject).toMatchObject({ repos: [], heading: 'Factory item from Slack' });
    for (const bit of ['It is not a ticket', '**Title**: Can you look at the cart?', '**From**: Ana', '**Messages**: 3', 'https://x.slack.com/a', 'team:shop', '**Channel**: #shop', '**Kind**: mention', '**From a bot**: no', 'It forgets its items since Monday.', '### Read (left as "ok")', 'Ana is the shop lead.']) expect(input.subject!.brief).toContain(bit);
    expect(input.step.outputSchema).toMatchObject({ properties: { outcome: { description: 'Which way the item leaves this station.' } } });
    /* nothing is posted on a ticket: there is none; the deliverable has no ticket either */
    expect(posted).toEqual([]);
    expect(delivered[0]).toMatchObject({ ticketId: null, title: 'Triage' });
    /* a script station runs on it too: no script runner here, so it says it cannot run */
    expect(await r.run(station({ exec: 'script' }), 'i1', 'run-2', {}, () => {}, { item: item(), earlier: [] })).toMatchObject({ status: 'failed', error: 'Script stations cannot run here' });
  });

  it('falls back to the first outcome when the agent names none of them, and reports a question or a failure as such', async () => {
    expect((await runner({ result: 'ok', schemaFields: { outcome: 'other' } }).r.run(station(), 't1', 'r', {}, () => {})).outcome).toBe('bug');
    expect((await runner({ result: 'needs_review', schemaFields: {}, comment: null }).r.run(station(), 't1', 'r', {}, () => {})).status).toBe('question');
    expect(await runner({ result: 'ko', schemaFields: {} }).r.run(station(), 't1', 'r', {}, () => {})).toMatchObject({ status: 'failed', error: 'The agent returned no usable output' });
  });
});
