import type { FastifyInstance } from 'fastify';
import type {
  CreateRoutineInput, UpdateRoutineInput, RoutineTrigger, RoutineOverlapPolicy,
} from '@fleex/shared';
import { normalizeRunSubject } from '@fleex/shared';
import {
  RoutineNotFoundError,
  RoutineSlugConflictError,
  RoutineRunAlreadyActiveError,
  InvalidRoutineTriggerError,
  WorkflowTemplateNotFoundError,
} from '../../domain/errors.js';
import { nextRunTimes } from '../../domain/services/routine-schedule.js';
import type { RoutineStorePort } from '../../application/ports/routine-store.port.js';
import type { WorkflowRunStorePort } from '../../application/ports/workflow-run-store.port.js';
import type { StepRunStorePort } from '../../application/ports/step-run-store.port.js';
import type { DeliverableStorePort } from '../../application/ports/deliverable-store.port.js';
import type { CreateRoutineUseCase } from '../../application/use-cases/create-routine.js';
import type { UpdateRoutineUseCase, DeleteRoutineUseCase } from '../../application/use-cases/update-routine.js';
import type { RunRoutineUseCase } from '../../application/use-cases/run-routine.js';

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Trigger shapes are validated here rather than trusted: an ill-formed cron
 * expression persisted now becomes a routine the future scheduler silently
 * skips. Whether a *kind* is supported at all is the use case's call.
 */
function parseTrigger(raw: unknown): { ok: true; value: RoutineTrigger | undefined } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, value: undefined };
  if (!isObject(raw)) return { ok: false, error: 'trigger must be an object' };
  const kind = raw['kind'];
  if (kind === 'manual') return { ok: true, value: { kind: 'manual' } };
  const timezone = typeof raw['timezone'] === 'string' ? raw['timezone'] : 'Europe/Paris';
  if (kind === 'once') {
    if (typeof raw['runAt'] !== 'string') return { ok: false, error: 'trigger.runAt must be an ISO string' };
    return { ok: true, value: { kind: 'once', runAt: raw['runAt'], timezone } };
  }
  if (kind === 'cron') {
    if (typeof raw['cron'] !== 'string' || raw['cron'].trim().length === 0) {
      return { ok: false, error: 'trigger.cron must be a non-empty string' };
    }
    return { ok: true, value: { kind: 'cron', cron: raw['cron'], timezone } };
  }
  return { ok: false, error: 'trigger.kind must be one of manual | once | cron' };
}

function parseOverlapPolicy(raw: unknown): RoutineOverlapPolicy | undefined {
  return raw === 'skip' || raw === 'queue' ? raw : undefined;
}

/** Maps domain errors to HTTP without repeating the same try/catch six times. */
function sendDomainError(reply: { code: (n: number) => { send: (b: unknown) => unknown } }, err: unknown): unknown {
  if (err instanceof RoutineNotFoundError) return reply.code(404).send({ error: err.code, message: err.message });
  if (err instanceof WorkflowTemplateNotFoundError) return reply.code(404).send({ error: err.code, message: err.message });
  if (err instanceof RoutineSlugConflictError) return reply.code(409).send({ error: err.code, message: err.message });
  if (err instanceof RoutineRunAlreadyActiveError) return reply.code(409).send({ error: err.code, message: err.message });
  if (err instanceof InvalidRoutineTriggerError) return reply.code(422).send({ error: err.code, message: err.message });
  throw err;
}

interface RoutineRouteDeps {
  routineStore: RoutineStorePort;
  runStore: WorkflowRunStorePort;
  stepRunStore: StepRunStorePort;
  deliverableStore: DeliverableStorePort;
  createRoutine: CreateRoutineUseCase;
  updateRoutine: UpdateRoutineUseCase;
  deleteRoutine: DeleteRoutineUseCase;
  runRoutine: RunRoutineUseCase;
  authorNameResolver: () => string;
}

export function routineRoutes(deps: RoutineRouteDeps) {
  return async function (app: FastifyInstance) {
    // GET /api/routines — list view. The active run's status is joined in
    // (one indexed lookup per routine) because the nav badge and the list both
    // need to show "this routine is waiting for you", and a routine run has no
    // ticket the cockpit could surface that from.
    app.get('/api/routines', async () => {
      const routines = await deps.routineStore.getAll();
      return Promise.all(routines.map(async (r) => {
        const active = await deps.runStore.getActiveByRoutine(r.id);
        return {
          ...r.toDTO(),
          activeRunId: active?.id ?? null,
          activeRunStatus: active?.status ?? null,
          awaitingAttention: active?.status === 'blocked' || active?.status === 'needs_review',
        };
      }));
    });

    // GET /api/routines/:idOrSlug — detail. Accepts the slug so the URL and the
    // CLI can both address a routine by its permalink.
    app.get<{ Params: { idOrSlug: string } }>('/api/routines/:idOrSlug', async (request, reply) => {
      const { idOrSlug } = request.params;
      const routine = await deps.routineStore.getById(idOrSlug)
        ?? await deps.routineStore.getBySlug(idOrSlug);
      if (!routine) return reply.code(404).send({ error: 'ROUTINE_NOT_FOUND' });
      return routine.toDTO();
    });

    // POST /api/routines/trigger-preview — "when would this actually fire?".
    // The editor must not ask an author to trust a raw `*/15 * * * *`, and the
    // preview is computed by the very code the scheduler uses rather than by a
    // second client-side cron implementation that could drift from it.
    app.post('/api/routines/trigger-preview', async (request, reply) => {
      const body = request.body;
      if (!isObject(body)) return reply.code(400).send({ error: 'INVALID_BODY', message: 'body must be an object' });
      const trigger = parseTrigger(body['trigger']);
      if (!trigger.ok) return reply.code(400).send({ error: 'INVALID_BODY', message: trigger.error });
      if (!trigger.value) return reply.code(400).send({ error: 'INVALID_BODY', message: 'trigger is required' });

      const count = typeof body['count'] === 'number' ? Math.min(Math.max(1, body['count']), 10) : 5;
      try {
        return { nextRuns: nextRunTimes(trigger.value, new Date(), count).map((d) => d.toISOString()) };
      } catch (err) {
        return sendDomainError(reply, err);
      }
    });

    app.post('/api/routines', async (request, reply) => {
      const body = request.body;
      if (!isObject(body)) return reply.code(400).send({ error: 'INVALID_BODY', message: 'body must be an object' });
      if (typeof body['name'] !== 'string' || body['name'].trim().length === 0) {
        return reply.code(400).send({ error: 'INVALID_BODY', message: 'name must be a non-empty string' });
      }
      if (typeof body['templateId'] !== 'string' || body['templateId'].length === 0) {
        return reply.code(400).send({ error: 'INVALID_BODY', message: 'templateId must be a non-empty string' });
      }
      const trigger = parseTrigger(body['trigger']);
      if (!trigger.ok) return reply.code(400).send({ error: 'INVALID_BODY', message: trigger.error });

      const input: CreateRoutineInput = {
        name: body['name'],
        templateId: body['templateId'],
        subject: normalizeRunSubject(body['subject']),
        ...(typeof body['emoji'] === 'string' ? { emoji: body['emoji'] } : {}),
        ...(typeof body['description'] === 'string' ? { description: body['description'] } : {}),
        ...(trigger.value ? { trigger: trigger.value } : {}),
        ...(parseOverlapPolicy(body['overlapPolicy']) ? { overlapPolicy: parseOverlapPolicy(body['overlapPolicy'])! } : {}),
        ...(typeof body['enabled'] === 'boolean' ? { enabled: body['enabled'] } : {}),
      };

      try {
        const routine = await deps.createRoutine.execute(input);
        return reply.code(201).send(routine.toDTO());
      } catch (err) {
        return sendDomainError(reply, err);
      }
    });

    app.patch<{ Params: { id: string } }>('/api/routines/:id', async (request, reply) => {
      const body = request.body;
      if (!isObject(body)) return reply.code(400).send({ error: 'INVALID_BODY', message: 'body must be an object' });
      const trigger = parseTrigger(body['trigger']);
      if (!trigger.ok) return reply.code(400).send({ error: 'INVALID_BODY', message: trigger.error });

      const changes: UpdateRoutineInput = {
        ...(typeof body['name'] === 'string' ? { name: body['name'] } : {}),
        ...(typeof body['emoji'] === 'string' ? { emoji: body['emoji'] } : {}),
        ...(body['description'] === null || typeof body['description'] === 'string'
          ? { description: body['description'] as string | null } : {}),
        ...(typeof body['templateId'] === 'string' ? { templateId: body['templateId'] } : {}),
        ...(body['subject'] !== undefined ? { subject: normalizeRunSubject(body['subject']) } : {}),
        ...(trigger.value ? { trigger: trigger.value } : {}),
        ...(parseOverlapPolicy(body['overlapPolicy']) ? { overlapPolicy: parseOverlapPolicy(body['overlapPolicy'])! } : {}),
        ...(typeof body['enabled'] === 'boolean' ? { enabled: body['enabled'] } : {}),
      };

      try {
        const routine = await deps.updateRoutine.execute(request.params.id, changes);
        return routine.toDTO();
      } catch (err) {
        return sendDomainError(reply, err);
      }
    });

    app.delete<{ Params: { id: string } }>('/api/routines/:id', async (request, reply) => {
      try {
        await deps.deleteRoutine.execute(request.params.id);
        return reply.code(204).send();
      } catch (err) {
        return sendDomainError(reply, err);
      }
    });

    // POST /api/routines/:id/run — the "Lancer" button. 409 when a run is
    // already active: one run per routine, same rule as one run per ticket.
    app.post<{ Params: { id: string } }>('/api/routines/:id/run', async (request, reply) => {
      try {
        const run = await deps.runRoutine.execute({
          routineId: request.params.id,
          triggeredBy: deps.authorNameResolver(),
          triggeredFrom: 'routine',
        });
        return reply.code(201).send(run.toDTO());
      } catch (err) {
        return sendDomainError(reply, err);
      }
    });

    // GET /api/routines/:id/runs — history. Step runs come along so the detail
    // screen can mount the existing WorkflowRunView without a second round-trip
    // per run, and deliverables because a routine run has no ticket to hang
    // them off.
    app.get<{ Params: { id: string } }>('/api/routines/:id/runs', async (request, reply) => {
      const routine = await deps.routineStore.getById(request.params.id);
      if (!routine) return reply.code(404).send({ error: 'ROUTINE_NOT_FOUND' });

      const runs = await deps.runStore.getByRoutine(routine.id);
      const detailed = await Promise.all(runs.map(async (run) => ({
        run: run.toDTO(),
        stepRuns: (await deps.stepRunStore.getByWorkflowRun(run.id)).map((s) => s.toDTO()),
        deliverables: (await deps.deliverableStore.getByWorkflowRun(run.id)).map((d) => d.toDTO()),
      })));
      return detailed;
    });
  };
}
