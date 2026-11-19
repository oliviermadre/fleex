/** A station presented to the workflow step executors as a one-step workflow: what it asks them, and how it reads their answer. */
import { describe, it, expect, vi } from 'vitest';
import { StationRunner } from '../../src/factory/station-runner.js';
import type { StationSpec } from '../../src/factory/types.js';
import type { StepExecutionInput } from '../../src/application/services/step-executors/types.js';

const station = (over: Partial<StationSpec> = {}): StationSpec => ({ id: 's1', kind: 'station', x: 0, y: 0, w: 3, h: 3, name: 'Triage', exec: 'agent', ref: 'sentinel', mode: 'plan', prompt: 'Sort it.', outcomes: ['bug', 'feature'], cap: 8, ...over });

function runner(output: Record<string, unknown> = { result: 'ok', schemaFields: { outcome: 'feature' }, comment: null, deliverable: null }) {
  const seen: StepExecutionInput[] = [];
  const executor = { execute: vi.fn(async (input: StepExecutionInput) => { seen.push(input); input.onExecutionStarted?.('exec-1'); return { output, executionId: 'exec-1' }; }) };
  const r = new StationRunner({
    executors: { agent: executor, skill: executor, panel: executor } as never,
    submitDeliverable: { execute: vi.fn() } as never, postComment: { execute: vi.fn() } as never,
    agentEventStore: { setExecutionOutputs: vi.fn() } as never, eventBus: { emit: vi.fn() } as never,
  });
  return { r, seen };
}

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

  it('falls back to the first outcome when the agent names none of them, and reports a question or a failure as such', async () => {
    expect((await runner({ result: 'ok', schemaFields: { outcome: 'other' } }).r.run(station(), 't1', 'r', {}, () => {})).outcome).toBe('bug');
    expect((await runner({ result: 'needs_review', schemaFields: {}, comment: null }).r.run(station(), 't1', 'r', {}, () => {})).status).toBe('question');
    expect(await runner({ result: 'ko', schemaFields: {} }).r.run(station(), 't1', 'r', {}, () => {})).toMatchObject({ status: 'failed', error: 'The agent returned no usable output' });
  });
});
