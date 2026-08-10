import { describe, it, expect } from 'vitest';
import { parseTemplateBody } from '../../src/infrastructure/http/workflow-template.routes.js';

/**
 * The HTTP body guard sits in front of `WorkflowTemplateEntity.validate`. Its job is
 * to let every executor type the engine can actually dispatch reach the entity, and
 * to stop malformed JSON before it does. It must not become a second, narrower
 * source of truth about what a step may be — that is the bug these tests pin.
 */
describe('parseTemplateBody — native steps', () => {
  const nativeStep = {
    id: 'apply',
    name: 'Apply',
    executorType: 'native',
    executorRef: 'ticket.actions',
    nativeActions: [
      { id: 'a1', operationId: 'ticket.set_status', params: { status: 'done' } },
    ],
    position: { x: 0, y: 0 },
  };

  const body = (steps: unknown[]) => ({
    name: 'WF', slug: 'wf', steps, edges: [], entryStepId: 'apply',
  });

  it('accepts a native step, so a workflow using the native executor is savable', () => {
    const r = parseTemplateBody(body([nativeStep]));
    expect(r.ok).toBe(true);
  });

  it('accepts every executor type the engine can dispatch', () => {
    for (const executorType of ['agent', 'skill', 'panel', 'human_gate', 'native', 'route', 'trigger']) {
      const r = parseTemplateBody(body([{ ...nativeStep, executorType }]));
      expect(r.ok, `executorType "${executorType}" must be accepted`).toBe(true);
    }
  });

  it('still rejects an executor type the engine has no executor for', () => {
    const r = parseTemplateBody(body([{ ...nativeStep, executorType: 'webhook' }]));
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toMatch(/executorType/);
  });

  it('rejects a malformed action, so the entity never plans against garbage params', () => {
    const cases: Array<[unknown, RegExp]> = [
      [{ id: 'a1', operationId: 'ticket.set_status' }, /params/],
      [{ id: 'a1', params: {} }, /operationId/],
      [{ operationId: 'ticket.set_status', params: {} }, /\.id/],
      ['not-an-object', /must be an object/],
    ];
    for (const [action, pattern] of cases) {
      const r = parseTemplateBody(body([{ ...nativeStep, nativeActions: [action] }]));
      expect(r.ok, `${JSON.stringify(action)} must be rejected`).toBe(false);
      if (!r.ok) expect(r.error).toMatch(pattern);
    }
  });

  it('rejects nativeActions that is not an array', () => {
    const r = parseTemplateBody(body([{ ...nativeStep, nativeActions: {} }]));
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toMatch(/nativeActions must be an array/);
  });

  it('leaves nativeActions intact on the parsed step, so the entity receives them', () => {
    const r = parseTemplateBody(body([nativeStep]));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.steps[0]?.nativeActions).toEqual(nativeStep.nativeActions);
  });
});
