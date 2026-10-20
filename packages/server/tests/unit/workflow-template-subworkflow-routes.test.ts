import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import type { WorkflowStep } from '@fleex/shared';
import { workflowTemplateRoutes } from '../../src/infrastructure/http/workflow-template.routes.js';
import { WorkflowTemplateEntity } from '../../src/domain/entities/workflow-template.entity.js';

/**
 * The template routes are where an inclusion cycle is first refused, and where
 * a template other workflows depend on is protected: disabling it silently, or
 * renaming it without following the references, would leave its consumers
 * unable to start — and nobody would find out until the next run.
 */

const step = (id: string, extra: Partial<WorkflowStep> = {}): WorkflowStep => ({
  id, name: id, executorType: 'agent', executorRef: 'p', position: { x: 0, y: 0 }, ...extra,
});
const includes = (slug: string) => step(`inc-${slug}`, { executorType: 'workflow', executorRef: slug });
const body = (slug: string, steps: WorkflowStep[]) => ({ name: slug, slug, steps, edges: [], entryStepId: steps[0]!.id });

async function setup() {
  const templates = new Map<string, WorkflowTemplateEntity>();
  const add = (id: string, slug: string, steps: WorkflowStep[]) => {
    const t = WorkflowTemplateEntity.create({ id, ...body(slug, steps) });
    templates.set(id, t);
    return t;
  };
  const store = {
    getAll: async () => [...templates.values()],
    getEnabled: async () => [...templates.values()].filter((t) => t.enabled),
    getById: async (id: string) => templates.get(id) ?? null,
    getBySlug: async (slug: string) => [...templates.values()].find((t) => t.slug === slug) ?? null,
    save: async (t: WorkflowTemplateEntity) => { templates.set(t.id, t); },
  };
  const app = Fastify();
  await app.register(workflowTemplateRoutes({ templateStore: store as never }));
  return { app, add, templates };
}

describe('sub-workflows on the template routes', () => {
  it('accepts a workflow step pointing at an existing template', async () => {
    const { app, add } = await setup();
    add('b', 'build', [step('impl')]);
    const res = await app.inject({ method: 'POST', url: '/api/workflows/templates', payload: body('full', [includes('build')]) });
    expect(res.statusCode).toBe(201);
  });

  it('refuses a save that would close an inclusion cycle, naming the path', async () => {
    const { app, add } = await setup();
    add('a', 'a', [step('x')]);
    add('b', 'b', [includes('a')]);
    const res = await app.inject({ method: 'PUT', url: '/api/workflows/templates/a', payload: body('a', [includes('b')]) });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/inclusion cycle a → b → a/);
  });

  it('refuses a missing sub-workflow at save time', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'POST', url: '/api/workflows/templates', payload: body('full', [includes('ghost')]) });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/"ghost" not found/);
  });

  it('answers 409 TEMPLATE_IN_USE when disabling an included template, unless forced', async () => {
    const { app, add, templates } = await setup();
    add('b', 'build', [step('impl')]);
    add('f', 'full', [includes('build')]);

    const refused = await app.inject({ method: 'DELETE', url: '/api/workflows/templates/b' });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ error: 'TEMPLATE_IN_USE', consumers: [{ slug: 'full' }] });
    expect(templates.get('b')!.enabled).toBe(true);

    const forced = await app.inject({ method: 'DELETE', url: '/api/workflows/templates/b?force=true' });
    expect(forced.statusCode).toBe(204);
    expect(templates.get('b')!.enabled).toBe(false);
  });

  it('applies the same 409 to a PUT that disables an included template — no back door around the guard', async () => {
    const { app, add, templates } = await setup();
    add('b', 'build', [step('impl')]);
    add('f', 'full', [includes('build')]);
    const disable = { ...body('build', [step('impl')]), enabled: false };

    const refused = await app.inject({ method: 'PUT', url: '/api/workflows/templates/b', payload: disable });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ error: 'TEMPLATE_IN_USE', consumers: [{ slug: 'full' }] });
    expect(templates.get('b')!.enabled).toBe(true);

    const forced = await app.inject({ method: 'PUT', url: '/api/workflows/templates/b?force=true', payload: disable });
    expect(forced.statusCode).toBe(200);
    expect(templates.get('b')!.enabled).toBe(false);
  });

  it('refuses a step id containing "::", which would pass for a step expanded from a sub-workflow', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'POST', url: '/api/workflows/templates', payload: body('x', [step('b::impl')]) });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/must not contain "::"/);
  });

  it('renaming an included template rewrites the references of the workflows including it', async () => {
    const { app, add, templates } = await setup();
    add('b', 'build', [step('impl')]);
    add('f', 'full', [includes('build')]);

    const res = await app.inject({ method: 'PUT', url: '/api/workflows/templates/b', payload: body('build-pr', [step('impl')]) });
    expect(res.statusCode).toBe(200);
    expect(templates.get('f')!.steps[0]!.executorRef).toBe('build-pr');
  });
});
