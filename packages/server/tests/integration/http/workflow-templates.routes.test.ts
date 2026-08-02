import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestApp, type TestAppHandle } from '../../helpers/test-app.js';

/**
 * `/api/workflows/templates` is the one CRUD surface in the app that validates
 * its body BY HAND (`parseTemplateBody`) instead of with a JSON schema, and
 * that answers its 404s and 409s EXPLICITLY instead of throwing a
 * `DomainError`. Both choices are load-bearing:
 *
 *   - hand-rolled validation means a missing check is a silent 500 from the
 *     entity constructor rather than a 400;
 *   - `WORKFLOW_TEMPLATE_NOT_FOUND` is one of the 12 domain codes absent from
 *     `CODE_TO_STATUS` (see error-handler.test.ts). If any of these handlers
 *     were ever refactored to `throw new WorkflowTemplateNotFoundError(...)`,
 *     the response would flip from 404 to 500 with no other visible change.
 *     The 404 assertions below are what make that refactor fail loudly.
 *
 * The store is `InMemoryWorkflowTemplateStore`, installed by `createTestApp`
 * (`workflowTemplates: true` is the default) because the json driver has no
 * template store. The "no store → routes not registered → 404" case is covered
 * in app-wiring.test.ts and not repeated here.
 */

interface StepOverrides {
  id?: string;
  name?: string;
  executorType?: string;
  executorRef?: string;
  position?: unknown;
}

function step(over: StepOverrides = {}): Record<string, unknown> {
  return {
    id: 'step-1',
    name: 'Draft',
    executorType: 'agent',
    executorRef: 'builder',
    position: { x: 0, y: 0 },
    ...over,
  };
}

/** Smallest body `parseTemplateBody` + `WorkflowTemplateEntity.validate` both accept. */
function templateBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Review flow',
    slug: 'review-flow',
    emoji: '🔍',
    description: 'A minimal one-step flow',
    steps: [step()],
    edges: [],
    entryStepId: 'step-1',
    enabled: true,
    ...over,
  };
}

describe('workflow template routes', () => {
  let h: TestAppHandle;

  beforeEach(async () => {
    h = await createTestApp();
  });

  afterEach(async () => {
    await h.close();
  });

  async function create(over: Record<string, unknown> = {}) {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/workflows/templates',
      payload: templateBody(over),
    });
    expect(res.statusCode).toBe(201);
    return res.json();
  }

  describe('GET /api/workflows/templates', () => {
    it('answers 200 with an empty list on a fresh store', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/api/workflows/templates' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('answers 200 and lists what was created, as DTOs', async () => {
      await create({ slug: 'first', name: 'First' });
      await create({ slug: 'second', name: 'Second' });

      const res = await h.app.inject({ method: 'GET', url: '/api/workflows/templates' });

      expect(res.statusCode).toBe(200);
      expect(res.json().map((t: { slug: string }) => t.slug).sort()).toEqual(['first', 'second']);
    });
  });

  describe('GET /api/workflows/templates/enabled', () => {
    /**
     * Registered before `/:id`, so the literal segment wins in Fastify's radix
     * tree. If the two were ever swapped, `enabled` would be read as an id and
     * this would answer 404 instead of a list.
     */
    it('answers 200 with only the enabled templates', async () => {
      await create({ slug: 'on', name: 'On', enabled: true });
      await create({ slug: 'off', name: 'Off', enabled: false });

      const res = await h.app.inject({ method: 'GET', url: '/api/workflows/templates/enabled' });

      expect(res.statusCode).toBe(200);
      expect(res.json().map((t: { slug: string }) => t.slug)).toEqual(['on']);
    });
  });

  describe('POST /api/workflows/templates', () => {
    it('answers 201 with the created template, id assigned server-side', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/workflows/templates',
        payload: templateBody(),
      });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({
        name: 'Review flow',
        slug: 'review-flow',
        emoji: '🔍',
        entryStepId: 'step-1',
        enabled: true,
      });
      expect(res.json().id).toEqual(expect.any(String));
    });

    it('answers 409 SLUG_TAKEN on a duplicate slug', async () => {
      await create({ slug: 'review-flow' });

      const res = await h.app.inject({
        method: 'POST',
        url: '/api/workflows/templates',
        payload: templateBody({ slug: 'review-flow', name: 'A clone' }),
      });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({
        error: 'SLUG_TAKEN',
        message: 'Slug "review-flow" is already in use',
      });
    });

    it.each([
      ['a missing name', { name: '' }, 'name must be a non-empty string'],
      ['a slug with uppercase', { slug: 'Review-Flow' }, 'slug must match /^[a-z0-9_-]+$/'],
      ['an empty steps array', { steps: [] }, 'steps must be a non-empty array'],
      ['a step with an unknown executorType', { steps: [step({ executorType: 'wizard' })] },
        'steps[0].executorType must be one of agent, skill, panel, human_gate'],
      ['a step with no position', { steps: [step({ position: undefined })] },
        'steps[0].position must be an object'],
      ['an empty entryStepId', { entryStepId: '' }, 'entryStepId must be a non-empty string'],
    ])('answers 400 INVALID_BODY on %s', async (_label, over, message) => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/workflows/templates',
        payload: templateBody(over),
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'INVALID_BODY', message });
    });

    /**
     * `parseTemplateBody` only checks shapes; graph consistency lives in
     * `WorkflowTemplateEntity.validate`, which throws. The route catches that
     * throw and downgrades it to 400 INVALID_TEMPLATE — without the try/catch
     * it would reach the error handler and become a 500.
     */
    it('answers 400 INVALID_TEMPLATE when entryStepId is not one of the steps', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/workflows/templates',
        payload: templateBody({ entryStepId: 'ghost' }),
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({
        error: 'INVALID_TEMPLATE',
        message: 'entryStepId "ghost" not found in steps[]',
      });
    });
  });

  describe('GET /api/workflows/templates/:id', () => {
    it('answers 200 with the template', async () => {
      const created = await create();

      const res = await h.app.inject({ method: 'GET', url: `/api/workflows/templates/${created.id}` });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ id: created.id, slug: 'review-flow' });
    });

    /**
     * The 404 is written by hand here — `return reply.code(404).send(...)`.
     * `WORKFLOW_TEMPLATE_NOT_FOUND` is NOT in `CODE_TO_STATUS`, so the day this
     * handler throws the domain error instead of answering directly, the route
     * silently becomes a 500. That is precisely the regression this assertion
     * exists to catch.
     */
    it('answers 404 for an unknown id — handled explicitly, never via DomainError', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/api/workflows/templates/nope' });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'WORKFLOW_TEMPLATE_NOT_FOUND' });
    });
  });

  describe('PUT /api/workflows/templates/:id', () => {
    it('answers 200 with the updated template', async () => {
      const created = await create();

      const res = await h.app.inject({
        method: 'PUT',
        url: `/api/workflows/templates/${created.id}`,
        payload: templateBody({ name: 'Renamed', description: 'now with more words' }),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ id: created.id, name: 'Renamed', slug: 'review-flow' });
    });

    it('answers 404 for an unknown id — same explicit 404 as the GET', async () => {
      const res = await h.app.inject({
        method: 'PUT',
        url: '/api/workflows/templates/nope',
        payload: templateBody(),
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'WORKFLOW_TEMPLATE_NOT_FOUND' });
    });

    it('answers 409 when renaming onto another template’s slug', async () => {
      await create({ slug: 'taken', name: 'Taken' });
      const mine = await create({ slug: 'mine', name: 'Mine' });

      const res = await h.app.inject({
        method: 'PUT',
        url: `/api/workflows/templates/${mine.id}`,
        payload: templateBody({ slug: 'taken', name: 'Mine' }),
      });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: 'SLUG_TAKEN' });
    });

    it('answers 200 when the slug is unchanged — the collision check skips itself', async () => {
      const mine = await create({ slug: 'mine', name: 'Mine' });

      const res = await h.app.inject({
        method: 'PUT',
        url: `/api/workflows/templates/${mine.id}`,
        payload: templateBody({ slug: 'mine', name: 'Mine v2' }),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ slug: 'mine', name: 'Mine v2' });
    });

    it('answers 400 INVALID_BODY before touching the store', async () => {
      const created = await create();

      const res = await h.app.inject({
        method: 'PUT',
        url: `/api/workflows/templates/${created.id}`,
        payload: templateBody({ slug: 'NOT VALID' }),
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'INVALID_BODY' });
    });
  });

  describe('DELETE /api/workflows/templates/:id', () => {
    it('answers 204 with an empty body and soft-deletes (enabled = false)', async () => {
      const created = await create();

      const res = await h.app.inject({
        method: 'DELETE',
        url: `/api/workflows/templates/${created.id}`,
      });

      expect(res.statusCode).toBe(204);
      expect(res.body).toBe('');

      // Soft delete: the row survives, only `enabled` flips.
      const after = await h.app.inject({ method: 'GET', url: `/api/workflows/templates/${created.id}` });
      expect(after.statusCode).toBe(200);
      expect(after.json()).toMatchObject({ id: created.id, enabled: false });

      const enabled = await h.app.inject({ method: 'GET', url: '/api/workflows/templates/enabled' });
      expect(enabled.statusCode).toBe(200);
      expect(enabled.json()).toEqual([]);
    });

    it('answers 404 for an unknown id', async () => {
      const res = await h.app.inject({ method: 'DELETE', url: '/api/workflows/templates/nope' });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'WORKFLOW_TEMPLATE_NOT_FOUND' });
    });
  });
});
