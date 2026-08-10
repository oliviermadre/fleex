import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { RoutineEntity } from '../../src/domain/entities/routine.entity.js';
import { WorkflowTemplateEntity } from '../../src/domain/entities/workflow-template.entity.js';
import { CreateWorkflowRunUseCase } from '../../src/application/use-cases/create-workflow-run.js';
import { RunRoutineUseCase } from '../../src/application/use-cases/run-routine.js';
import { RoutineRunAlreadyActiveError } from '../../src/domain/errors.js';
import { webhookRoutes } from '../../src/infrastructure/http/webhooks.routes.js';
import { mintWebhookSecret } from '../../src/application/services/webhook-secret.js';

const snapshot = {
  name: 'Ingest', emoji: '', entryStepId: 'trigger', edges: [],
  steps: [{ id: 'trigger', name: 'Trigger', executorType: 'trigger' as const, executorRef: '', position: { x: 0, y: 0 } }],
};

const template = WorkflowTemplateEntity.create({
  id: 'tmpl-1', name: 'Ingest', slug: 'ingest', steps: snapshot.steps, edges: [], entryStepId: 'trigger',
});

function makeRoutine(overrides: { enabled?: boolean; webhook?: boolean } = {}) {
  const routine = RoutineEntity.create({
    id: 'r-1', name: 'GitHub ingest', target: { kind: 'workflow' as const, ref: 'tmpl-1' },
    subject: { repos: [], boardId: 'b-1' },
    enabled: overrides.enabled ?? true,
  });
  if (overrides.webhook ?? true) routine.enableWebhook(() => 'sekret-token');
  return routine;
}

describe('RoutineEntity webhook capability', () => {
  it('mints the secret once and keeps it across disable/enable', () => {
    // A sender configures the URL exactly once; toggling the feature off must
    // not force them to re-plumb the external system.
    const routine = makeRoutine({ webhook: false });
    expect(routine.webhookSecret).toBeNull();

    let mints = 0;
    const mint = () => `secret-${++mints}`;
    routine.enableWebhook(mint);
    expect(routine.webhookSecret).toBe('secret-1');

    routine.disableWebhook();
    expect(routine.webhookEnabled).toBe(false);
    expect(routine.webhookSecret).toBe('secret-1');

    routine.enableWebhook(mint);
    expect(routine.webhookSecret).toBe('secret-1');
    expect(mints).toBe(1);
  });

  it('mints URL-safe 256-bit tokens', () => {
    const secret = mintWebhookSecret();
    expect(secret).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(secret.length).toBeGreaterThanOrEqual(43); // 32 bytes in base64url
    expect(mintWebhookSecret()).not.toBe(secret);
  });
});

describe('payload channel', () => {
  function deps(activeRun: unknown = null, routine = makeRoutine()) {
    const routineStore = {
      getById: vi.fn().mockResolvedValue(routine),
      getByWebhookSecret: vi.fn(async (secret: string) =>
        routine.webhookSecret === secret ? routine : null),
      save: vi.fn(),
    };
    const runStore = {
      getActiveByTicket: vi.fn().mockResolvedValue(null),
      getActiveByRoutine: vi.fn().mockResolvedValue(activeRun),
      save: vi.fn(),
    };
    const eventBus = { emit: vi.fn() };
    const createRun = new CreateWorkflowRunUseCase(
      { getById: vi.fn().mockResolvedValue(template) } as never,
      runStore as never,
      { runStep: vi.fn() } as never,
      { emit: vi.fn() } as never,
      { execute: vi.fn() } as never,
    );
    const runRoutine = new RunRoutineUseCase(routineStore as never, createRun, eventBus as never);
    return { routine, routineStore, runStore, eventBus, runRoutine };
  }

  it('persists the webhook body on the run and reports triggerKind webhook', async () => {
    const { runRoutine, eventBus } = deps();
    const run = await runRoutine.execute({
      routineId: 'r-1', triggeredBy: 'webhook', triggeredFrom: 'webhook',
      triggerPayload: { items: [{ ref: 'gh:1' }] },
    });

    expect(run.triggerPayload).toEqual({ items: [{ ref: 'gh:1' }] });
    expect(run.triggeredFrom).toBe('webhook');
    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
      type: 'routine.run_started', triggerKind: 'webhook',
    }));
  });

  it('leaves the payload null for launches with none (scheduler, Launch button)', async () => {
    const { runRoutine } = deps();
    const run = await runRoutine.execute({
      routineId: 'r-1', triggeredBy: 'routine-scheduler', triggeredFrom: 'schedule',
    });
    expect(run.triggerPayload).toBeNull();
  });

  describe('POST /api/hooks/:token', () => {
    async function app(activeRun: unknown = null, routine = makeRoutine()) {
      const d = deps(activeRun, routine);
      const fastify = Fastify();
      await fastify.register(webhookRoutes({
        routineStore: d.routineStore as never,
        runRoutine: d.runRoutine,
      }));
      return { fastify, ...d };
    }

    it('202s a delivery and threads the payload into the run', async () => {
      const { fastify, runStore } = await app();
      const res = await fastify.inject({
        method: 'POST', url: '/api/hooks/sekret-token',
        payload: { items: [1, 2] },
      });

      expect(res.statusCode).toBe(202);
      expect(res.json()).toMatchObject({ routineSlug: 'github-ingest' });
      const saved = runStore.save.mock.calls[0]?.[0] as { triggerPayload: unknown };
      expect(saved.triggerPayload).toEqual({ items: [1, 2] });
    });

    it('treats an empty body as a legal poke', async () => {
      const { fastify, runStore } = await app();
      const res = await fastify.inject({ method: 'POST', url: '/api/hooks/sekret-token' });

      expect(res.statusCode).toBe(202);
      const saved = runStore.save.mock.calls[0]?.[0] as { triggerPayload: unknown };
      expect(saved.triggerPayload).toEqual({});
    });

    it('404s an unknown token — indistinguishable from a disabled hook', async () => {
      const { fastify } = await app();
      const res = await fastify.inject({ method: 'POST', url: '/api/hooks/wrong-token', payload: {} });
      expect(res.statusCode).toBe(404);
    });

    it('404s a routine whose webhook was turned off, even with the right token', async () => {
      // The secret stays stored (dormant) — but the door must read as dead.
      const routine = makeRoutine();
      routine.disableWebhook();
      const { fastify } = await app(null, routine);
      const res = await fastify.inject({ method: 'POST', url: '/api/hooks/sekret-token', payload: {} });
      expect(res.statusCode).toBe(404);
    });

    it('409s a disabled routine — the hook exists but must not fire', async () => {
      const { fastify } = await app(null, makeRoutine({ enabled: false }));
      const res = await fastify.inject({ method: 'POST', url: '/api/hooks/sekret-token', payload: {} });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: 'ROUTINE_DISABLED' });
    });

    it('409s while a run is active — one run per routine, webhook or not', async () => {
      const { fastify } = await app({ id: 'run-active' });
      const res = await fastify.inject({ method: 'POST', url: '/api/hooks/sekret-token', payload: {} });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: 'RUN_ALREADY_ACTIVE' });
    });

    it('413s a body over the 256 KiB limit', async () => {
      const { fastify } = await app();
      const res = await fastify.inject({
        method: 'POST', url: '/api/hooks/sekret-token',
        payload: { blob: 'x'.repeat(300 * 1024) },
      });
      expect(res.statusCode).toBe(413);
    });
  });
});

describe('scheduler stays webhook-agnostic', () => {
  it('a webhook-enabled manual routine is never armed', () => {
    // Additive means additive: enabling the webhook must not sneak the routine
    // into the scheduler's due query.
    const routine = makeRoutine();
    expect(routine.trigger.kind).toBe('manual');
    expect(routine.nextRunAt).toBeNull();
  });
});

// Referenced so a rename of the error class breaks this file loudly rather
// than silently degrading the 409 branch into a 500.
void RoutineRunAlreadyActiveError;
