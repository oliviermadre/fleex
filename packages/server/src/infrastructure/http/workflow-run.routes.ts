import type { FastifyInstance } from 'fastify';
import {
  WorkflowRunAlreadyActiveError,
  WorkflowTemplateNotFoundError,
  WorkflowRunNotFoundError,
  StepRunNotFoundError,
  InvalidGateOutcomeError,
  InvalidRouteEdgeError,
  StepNotAwaitingRoutingError,
} from '../../domain/errors.js';
import type { WorkflowRunStorePort } from '../../application/ports/workflow-run-store.port.js';
import type { StepRunStorePort } from '../../application/ports/step-run-store.port.js';
import type { CreateWorkflowRunUseCase } from '../../application/use-cases/create-workflow-run.js';
import type { ResolveHumanGateUseCase } from '../../application/use-cases/resolve-human-gate.js';
import type { ResolveAmbiguousRouteUseCase } from '../../application/use-cases/resolve-ambiguous-route.js';
import type { RetryStepUseCase } from '../../application/use-cases/retry-step.js';
import type { CancelWorkflowRunUseCase } from '../../application/use-cases/cancel-workflow-run.js';
import type { SubmitDeliverableUseCase } from '../../application/use-cases/submit-deliverable.js';
import type { DeliverableStorePort } from '../../application/ports/deliverable-store.port.js';
import type { EventBus } from '../../application/event-bus.js';
import { InvalidDeliverableTypeError } from '../../domain/errors.js';
import type { DeliverableType, DeliverableStatus } from '@fleex/shared';

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

interface ResolveRouteBody {
  edgeId: string;
  notes?: string;
}

function parseResolveRouteBody(body: unknown): { ok: true; data: ResolveRouteBody } | { ok: false; error: string } {
  if (!isObject(body)) return { ok: false, error: 'body must be an object' };
  if (!isString(body['edgeId']) || body['edgeId'].length === 0) {
    return { ok: false, error: 'edgeId must be a non-empty string' };
  }
  if (body['notes'] !== undefined && !isString(body['notes'])) {
    return { ok: false, error: 'notes must be a string' };
  }
  return {
    ok: true,
    data: {
      edgeId: body['edgeId'],
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
  resolveAmbiguousRoute: ResolveAmbiguousRouteUseCase;
  retryStep: RetryStepUseCase;
  cancelWorkflowRun: CancelWorkflowRunUseCase;
  submitDeliverable: SubmitDeliverableUseCase;
  deliverableStore: DeliverableStorePort;
  eventBus: EventBus;
  authorNameResolver: () => string;
}

interface StepDeliverableBody {
  title: string;
  type: string;
  content: string;
  status?: string;
  agentName?: string;
}

function parseStepDeliverableBody(
  body: unknown,
): { ok: true; data: StepDeliverableBody } | { ok: false; error: string } {
  if (!isObject(body)) return { ok: false, error: 'body must be an object' };
  if (!isString(body['title']) || body['title'].length === 0) {
    return { ok: false, error: 'title must be a non-empty string' };
  }
  if (!isString(body['type']) || body['type'].length === 0) {
    return { ok: false, error: 'type must be a non-empty string' };
  }
  // An empty deliverable is almost always a `--file` that read nothing; failing
  // here is far cheaper to diagnose than an empty artifact in the run graph.
  if (!isString(body['content']) || body['content'].length === 0) {
    return { ok: false, error: 'content must be a non-empty string' };
  }
  if (body['status'] !== undefined && body['status'] !== 'draft' && body['status'] !== 'final') {
    return { ok: false, error: 'status must be "draft" or "final"' };
  }
  if (body['agentName'] !== undefined && !isString(body['agentName'])) {
    return { ok: false, error: 'agentName must be a string' };
  }
  return {
    ok: true,
    data: {
      title: body['title'],
      type: body['type'],
      content: body['content'],
      ...(isString(body['status']) ? { status: body['status'] } : {}),
      ...(isString(body['agentName']) ? { agentName: body['agentName'] } : {}),
    },
  };
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

    // POST /api/workflows/runs/:id/steps/:stepRunId/route — pick the edge to
    // follow when several matched at once
    app.post<{ Params: { id: string; stepRunId: string } }>(
      '/api/workflows/runs/:id/steps/:stepRunId/route',
      async (request, reply) => {
        const parsed = parseResolveRouteBody(request.body);
        if (!parsed.ok) return reply.code(400).send({ error: 'INVALID_BODY', message: parsed.error });

        try {
          await deps.resolveAmbiguousRoute.execute({
            workflowRunId: request.params.id,
            stepRunId: request.params.stepRunId,
            edgeId: parsed.data.edgeId,
            decidedBy: deps.authorNameResolver(),
            notes: parsed.data.notes,
          });
          return reply.code(204).send();
        } catch (err) {
          if (err instanceof WorkflowRunNotFoundError || err instanceof StepRunNotFoundError) {
            return reply.code(404).send({ error: (err as WorkflowRunNotFoundError | StepRunNotFoundError).code, message: err.message });
          }
          // Already routed (or never ambiguous): a second click, or two people
          // deciding at once. 409 rather than 400 — the request was well-formed.
          if (err instanceof StepNotAwaitingRoutingError) {
            return reply.code(409).send({ error: err.code, message: err.message });
          }
          if (err instanceof InvalidRouteEdgeError) {
            return reply.code(400).send({ error: err.code, message: err.message });
          }
          throw err;
        }
      },
    );

    // GET /api/workflows/runs/:id/steps/:stepRunId/deliverables
    app.get<{ Params: { id: string; stepRunId: string } }>(
      '/api/workflows/runs/:id/steps/:stepRunId/deliverables',
      async (request, reply) => {
        const stepRun = await deps.stepRunStore.getById(request.params.stepRunId);
        if (!stepRun || stepRun.workflowRunId !== request.params.id) {
          return reply.code(404).send({ error: 'STEP_RUN_NOT_FOUND' });
        }
        const deliverables = await deps.deliverableStore.getByStepRun(stepRun.id);
        return deliverables.map((d) => d.toDTO());
      },
    );

    // POST /api/workflows/runs/:id/steps/:stepRunId/deliverables — attach an
    // artifact to the step that produced it.
    //
    // This is the escape hatch from the structured-output channel: returning a
    // long deliverable through `structuredOutput` forces the agent to
    // re-serialize the whole content as output tokens, which is slow and can
    // exceed the output limit outright (a full meeting transcript does). Here
    // the content arrives as a plain request body — typically read from a file
    // by the CLI — so it never passes through the model.
    app.post<{ Params: { id: string; stepRunId: string } }>(
      '/api/workflows/runs/:id/steps/:stepRunId/deliverables',
      async (request, reply) => {
        const parsed = parseStepDeliverableBody(request.body);
        if (!parsed.ok) return reply.code(400).send({ error: 'INVALID_BODY', message: parsed.error });

        const run = await deps.runStore.getById(request.params.id);
        if (!run) return reply.code(404).send({ error: 'WORKFLOW_RUN_NOT_FOUND' });
        const stepRun = await deps.stepRunStore.getById(request.params.stepRunId);
        // Cross-run ids are rejected rather than tolerated: a step run that
        // belongs elsewhere would attach the artifact to the wrong graph.
        if (!stepRun || stepRun.workflowRunId !== run.id) {
          return reply.code(404).send({ error: 'STEP_RUN_NOT_FOUND' });
        }

        const agentName = parsed.data.agentName ?? 'cli';
        try {
          const deliverable = await deps.submitDeliverable.execute({
            // Mirrors `persistStepArtifacts`: a ticket run anchors on the ticket,
            // a routine run on the run — and both now also on the step run.
            ticketId: run.ticketId,
            workflowRunId: run.ticketId ? null : run.id,
            stepRunId: stepRun.id,
            agentName,
            type: parsed.data.type as DeliverableType,
            title: parsed.data.title,
            content: parsed.data.content,
            status: parsed.data.status as DeliverableStatus | undefined,
          });

          deps.eventBus.emit({
            type: 'deliverable.created',
            deliverableId: deliverable.id,
            ticketId: run.ticketId,
            workflowRunId: run.ticketId ? null : run.id,
            stepRunId: stepRun.id,
            agentName,
            status: deliverable.status,
            title: deliverable.title,
            occurredAt: new Date(),
          });

          return reply.code(201).send(deliverable.toDTO());
        } catch (err) {
          if (err instanceof InvalidDeliverableTypeError) {
            return reply.code(400).send({ error: err.code, message: err.message });
          }
          throw err;
        }
      },
    );

    // POST /api/workflows/runs/:id/steps/:stepRunId/retry — retry a step
    app.post<{ Params: { id: string; stepRunId: string }; Body: unknown }>(
      '/api/workflows/runs/:id/steps/:stepRunId/retry',
      async (request, reply) => {
        // Optional: the answer the user typed when the step paused on a
        // `waiting_for_info` question. Recorded on the paused attempt so the
        // retry sees it — the only channel that exists on a routine run.
        const body = request.body;
        const humanResponse =
          isObject(body) && isString(body['humanResponse']) ? body['humanResponse'] : undefined;
        try {
          await deps.retryStep.execute({
            workflowRunId: request.params.id,
            stepRunId: request.params.stepRunId,
            ...(humanResponse ? { humanResponse } : {}),
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
