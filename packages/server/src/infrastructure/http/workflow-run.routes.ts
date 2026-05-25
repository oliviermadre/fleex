import type { FastifyInstance } from 'fastify';
import {
  WorkflowRunAlreadyActiveError,
  WorkflowTemplateNotFoundError,
  WorkflowRunNotFoundError,
  StepRunNotFoundError,
  InvalidGateOutcomeError,
} from '../../domain/errors.js';
import type { WorkflowRunStorePort } from '../../application/ports/workflow-run-store.port.js';
import type { StepRunStorePort } from '../../application/ports/step-run-store.port.js';
import type { CreateWorkflowRunUseCase } from '../../application/use-cases/create-workflow-run.js';
import type { ResolveHumanGateUseCase } from '../../application/use-cases/resolve-human-gate.js';
import type { RetryStepUseCase } from '../../application/use-cases/retry-step.js';
import type { CancelWorkflowRunUseCase } from '../../application/use-cases/cancel-workflow-run.js';

// ── Manual validation helpers ──────────────────────────────────────────────

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ── Body parsers ──────────────────────────────────────────────────────────

interface CreateRunBody {
  ticketId: string;
  templateId: string;
  triggeredFrom?: string;
}

function parseCreateRunBody(body: unknown): { ok: true; data: CreateRunBody } | { ok: false; error: string } {
  if (!isObject(body)) return { ok: false, error: 'body must be an object' };
  if (!isString(body['ticketId']) || body['ticketId'].length === 0) {
    return { ok: false, error: 'ticketId must be a non-empty string' };
  }
  if (!isString(body['templateId']) || body['templateId'].length === 0) {
    return { ok: false, error: 'templateId must be a non-empty string' };
  }
  if (body['triggeredFrom'] !== undefined && !isString(body['triggeredFrom'])) {
    return { ok: false, error: 'triggeredFrom must be a string' };
  }
  return {
    ok: true,
    data: {
      ticketId: body['ticketId'],
      templateId: body['templateId'],
      triggeredFrom: isString(body['triggeredFrom']) ? body['triggeredFrom'] : 'api',
    },
  };
}

interface ResolveGateBody {
  outcome: string;
  notes?: string;
}

function parseResolveGateBody(body: unknown): { ok: true; data: ResolveGateBody } | { ok: false; error: string } {
  if (!isObject(body)) return { ok: false, error: 'body must be an object' };
  if (!isString(body['outcome']) || body['outcome'].length === 0) {
    return { ok: false, error: 'outcome must be a non-empty string' };
  }
  if (body['notes'] !== undefined && !isString(body['notes'])) {
    return { ok: false, error: 'notes must be a string' };
  }
  return {
    ok: true,
    data: {
      outcome: body['outcome'],
      ...(isString(body['notes']) ? { notes: body['notes'] } : {}),
    },
  };
}

// ── Route registration ─────────────────────────────────────────────────────

interface WorkflowRunRouteDeps {
  runStore: WorkflowRunStorePort;
  stepRunStore: StepRunStorePort;
  createWorkflowRun: CreateWorkflowRunUseCase;
  resolveHumanGate: ResolveHumanGateUseCase;
  retryStep: RetryStepUseCase;
  cancelWorkflowRun: CancelWorkflowRunUseCase;
  authorNameResolver: () => string;
}

export function workflowRunRoutes(deps: WorkflowRunRouteDeps) {
  return async function (app: FastifyInstance) {
    // GET /api/workflows/runs?ticketId=X — list runs for a ticket
    app.get<{ Querystring: { ticketId?: string } }>('/api/workflows/runs', async (request, reply) => {
      const { ticketId } = request.query;
      if (!ticketId) return reply.code(400).send({ error: 'MISSING_QUERY_PARAM', message: 'ticketId is required' });
      const runs = await deps.runStore.getByTicket(ticketId);
      return runs.map((r) => r.toDTO());
    });

    // GET /api/workflows/runs/:id — get one run + its step_runs
    app.get<{ Params: { id: string } }>('/api/workflows/runs/:id', async (request, reply) => {
      const run = await deps.runStore.getById(request.params.id);
      if (!run) return reply.code(404).send({ error: 'WORKFLOW_RUN_NOT_FOUND' });
      const stepRuns = await deps.stepRunStore.getByWorkflowRun(run.id);
      return { run: run.toDTO(), stepRuns: stepRuns.map((s) => s.toDTO()) };
    });

    // POST /api/workflows/runs — create a run
    app.post('/api/workflows/runs', async (request, reply) => {
      const parsed = parseCreateRunBody(request.body);
      if (!parsed.ok) return reply.code(400).send({ error: 'INVALID_BODY', message: parsed.error });

      try {
        const run = await deps.createWorkflowRun.execute({
          ticketId: parsed.data.ticketId,
          templateId: parsed.data.templateId,
          triggeredBy: deps.authorNameResolver(),
          triggeredFrom: parsed.data.triggeredFrom ?? 'api',
        });
        return reply.code(201).send(run.toDTO());
      } catch (err) {
        if (err instanceof WorkflowRunAlreadyActiveError) {
          return reply.code(409).send({ error: err.code, message: err.message });
        }
        if (err instanceof WorkflowTemplateNotFoundError) {
          return reply.code(404).send({ error: err.code, message: err.message });
        }
        throw err;
      }
    });

    // DELETE /api/workflows/runs/:id — cancel a run
    app.delete<{ Params: { id: string } }>('/api/workflows/runs/:id', async (request, reply) => {
      try {
        await deps.cancelWorkflowRun.execute(request.params.id);
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof WorkflowRunNotFoundError) {
          return reply.code(404).send({ error: err.code, message: err.message });
        }
        throw err;
      }
    });

    // POST /api/workflows/runs/:id/steps/:stepRunId/resolve — resolve a human_gate
    app.post<{ Params: { id: string; stepRunId: string } }>(
      '/api/workflows/runs/:id/steps/:stepRunId/resolve',
      async (request, reply) => {
        const parsed = parseResolveGateBody(request.body);
        if (!parsed.ok) return reply.code(400).send({ error: 'INVALID_BODY', message: parsed.error });

        try {
          await deps.resolveHumanGate.execute({
            workflowRunId: request.params.id,
            stepRunId: request.params.stepRunId,
            outcome: parsed.data.outcome,
            notes: parsed.data.notes,
          });
          return reply.code(204).send();
        } catch (err) {
          if (err instanceof WorkflowRunNotFoundError || err instanceof StepRunNotFoundError) {
            return reply.code(404).send({ error: (err as WorkflowRunNotFoundError | StepRunNotFoundError).code, message: err.message });
          }
          if (err instanceof InvalidGateOutcomeError) {
            return reply.code(400).send({ error: err.code, message: err.message });
          }
          throw err;
        }
      },
    );

    // POST /api/workflows/runs/:id/steps/:stepRunId/retry — retry a step
    app.post<{ Params: { id: string; stepRunId: string } }>(
      '/api/workflows/runs/:id/steps/:stepRunId/retry',
      async (request, reply) => {
        try {
          await deps.retryStep.execute({
            workflowRunId: request.params.id,
            stepRunId: request.params.stepRunId,
          });
          return reply.code(204).send();
        } catch (err) {
          if (err instanceof WorkflowRunNotFoundError || err instanceof StepRunNotFoundError) {
            return reply.code(404).send({ error: (err as WorkflowRunNotFoundError | StepRunNotFoundError).code, message: err.message });
          }
          throw err;
        }
      },
    );
  };
}
