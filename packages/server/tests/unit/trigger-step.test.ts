import { describe, it, expect } from 'vitest';
import type { WorkflowStep, WorkflowEdge, NativeAction } from '@fleex/shared';
import { validateNativeSteps, nativeReferenceSuggestions } from '@fleex/shared';
import { WorkflowTemplateEntity } from '../../src/domain/entities/workflow-template.entity.js';
import { TriggerStepExecutor } from '../../src/application/services/step-executors/trigger-step-executor.js';
import type { StepExecutionInput } from '../../src/application/services/step-executors/types.js';

/**
 * The trigger step is the deterministic answer to "what started this run". Its
 * whole contract is: entry-only placement, payload exposed as an ordinary step
 * output, and meta fields that a webhook sender cannot spoof.
 */

const triggerStep = (id: string, outputSchema?: WorkflowStep['outputSchema']): WorkflowStep => ({
  id,
  name: 'Trigger',
  executorType: 'trigger',
  executorRef: '',
  position: { x: 0, y: 0 },
  ...(outputSchema ? { outputSchema } : {}),
});

const agentStep = (id: string): WorkflowStep => ({
  id, name: id.toUpperCase(), executorType: 'agent', executorRef: 'p1', position: { x: 200, y: 0 },
});

const nativeStep = (id: string, actions: NativeAction[], forEach?: string): WorkflowStep => ({
  id, name: id.toUpperCase(), executorType: 'native', executorRef: 'ticket.actions',
  position: { x: 400, y: 0 }, nativeActions: actions, ...(forEach ? { forEach } : {}),
});

const edge = (id: string, source: string, target: string): WorkflowEdge =>
  ({ id, source, target, isDefault: true });

const save = (steps: WorkflowStep[], edges: WorkflowEdge[], entryStepId = steps[0]?.id ?? 't') =>
  () => WorkflowTemplateEntity.create({
    id: 'w-1', name: 'W', slug: 'w', steps, edges, entryStepId,
  });

describe('trigger step template validation', () => {
  it('accepts a trigger step as the entry', () => {
    expect(save([triggerStep('t'), agentStep('a')], [edge('e1', 't', 'a')], 't')).not.toThrow();
  });

  it('refuses a trigger step that is not the entry', () => {
    // "How this run started" placed mid-graph would be a statement about a run
    // that is already half done.
    expect(save([agentStep('a'), triggerStep('t')], [edge('e1', 'a', 't')], 'a'))
      .toThrow(/must be the workflow's entry step/);
  });

  it('refuses two trigger steps', () => {
    expect(save([triggerStep('t1'), triggerStep('t2')], [], 't1'))
      .toThrow(/at most one trigger step/);
  });

  it('refuses incoming edges on the trigger step', () => {
    expect(save(
      [triggerStep('t'), agentStep('a')],
      [edge('e1', 't', 'a'), edge('e2', 'a', 't')],
      't',
    )).toThrow(/cannot have incoming edges/);
  });
});

describe('trigger step references', () => {
  it('lets downstream steps reference the meta fields without a declared schema', () => {
    // `previousRunAt` & co are published by the executor itself — forcing the
    // author to re-declare them would make the picker and the validator lie.
    const steps = [
      triggerStep('t'),
      nativeStep('n', [{ id: 'a1', operationId: 'ticket.post_comment', params: { body: 'since {{ steps.t.previousRunAt }}' } }]),
    ];
    const { errors } = validateNativeSteps(steps, [edge('e1', 't', 'n')], 't');
    expect(errors).toEqual([]);
  });

  it('allows forEach over a payload array declared on the trigger step', () => {
    const steps = [
      triggerStep('t', {
        type: 'object',
        properties: { items: { type: 'array', items: { type: 'object', properties: { ref: { type: 'string' } } } } },
      }),
      nativeStep('n', [{
        id: 'a1', operationId: 'ticket.upsert',
        params: { externalRef: '{{ item.ref }}', title: 'x', boardId: 'b-1' },
      }], '{{ steps.t.items }}'),
    ];
    const { errors } = validateNativeSteps(steps, [edge('e1', 't', 'n')], 't');
    expect(errors).toEqual([]);
  });

  it('offers the meta fields in the reference picker', () => {
    const steps = [triggerStep('t'), nativeStep('n', [])];
    const suggestions = nativeReferenceSuggestions(steps[1]!, steps, [edge('e1', 't', 'n')], 't');
    const tokens = suggestions.map((s) => s.token);
    expect(tokens).toContain('{{ steps.t.previousRunAt }}');
    expect(tokens).toContain('{{ steps.t.firedVia }}');
  });
});

describe('TriggerStepExecutor', () => {
  const exec = new TriggerStepExecutor();

  const input = (runInfo?: StepExecutionInput['runInfo']): StepExecutionInput => ({
    ticketId: null,
    routineId: 'r-1',
    workflowRunId: 'run-1',
    stepRunId: 'sr-1',
    step: triggerStep('t'),
    ...(runInfo ? { runInfo } : {}),
    workflowContext: {
      workflowName: 'Ingest', stepName: 'Trigger', outgoingEdges: [], previousOutputs: {},
    },
  });

  it('spreads an object payload and publishes the meta fields', async () => {
    const result = await exec.execute(input({
      triggeredFrom: 'webhook',
      startedAt: '2026-08-10T09:00:00.000Z',
      previousRunAt: '2026-08-09T09:00:00.000Z',
      triggerPayload: { items: [{ ref: 'gh:1' }], source: 'github' },
    }));

    expect(result.output.result).toBe('ok');
    expect(result.output.schemaFields).toEqual({
      items: [{ ref: 'gh:1' }],
      source: 'github',
      previousRunAt: '2026-08-09T09:00:00.000Z',
      firedVia: 'webhook',
      firedAt: '2026-08-10T09:00:00.000Z',
    });
  });

  it('never lets the payload spoof the meta fields', async () => {
    const result = await exec.execute(input({
      triggeredFrom: 'webhook',
      startedAt: '2026-08-10T09:00:00.000Z',
      previousRunAt: null,
      triggerPayload: { firedVia: 'schedule', previousRunAt: 'never' },
    }));

    expect(result.output.schemaFields['firedVia']).toBe('webhook');
    expect(result.output.schemaFields['previousRunAt']).toBeNull();
  });

  it('publishes a non-object payload under "payload"', async () => {
    const result = await exec.execute(input({
      triggeredFrom: 'webhook', startedAt: '2026-08-10T09:00:00.000Z', previousRunAt: null,
      triggerPayload: [1, 2, 3],
    }));

    expect(result.output.schemaFields['payload']).toEqual([1, 2, 3]);
  });

  it('degrades to empty payload + meta on a run with no payload (cron, manual, ticket)', async () => {
    const result = await exec.execute(input({
      triggeredFrom: 'schedule', startedAt: '2026-08-10T09:00:00.000Z', previousRunAt: '2026-08-09T09:00:00.000Z',
    }));

    expect(result.output.schemaFields).toEqual({
      previousRunAt: '2026-08-09T09:00:00.000Z',
      firedVia: 'schedule',
      firedAt: '2026-08-10T09:00:00.000Z',
    });
  });
});
