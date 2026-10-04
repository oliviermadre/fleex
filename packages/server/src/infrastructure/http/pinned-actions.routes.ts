import type { FastifyInstance } from 'fastify';
import type { ActionRunCapabilities, ActionRunRequest, ActionSourceKind } from '@fleex/shared';
import type { ActionRunService } from '../../domain/services/action-run.service.js';
import type { PinnedStatusService } from '../../domain/services/pinned-status.service.js';
import { InvalidBinaryNameError, type BinaryDiagnosisService } from '../../domain/services/binary-diagnosis.service.js';

export interface PinnedActionsRouteDeps {
  pinnedStatus: PinnedStatusService;
  actionRuns: ActionRunService;
  binaryDiagnosis?: BinaryDiagnosisService;
  /** What the running gateway supports (live output needs a restarted gateway). */
  actionRunCapabilities?: () => Promise<ActionRunCapabilities>;
  logger: { info: (msg: string, meta?: Record<string, unknown>) => void };
}

const SOURCE_KINDS = new Set<ActionSourceKind>(['pinned', 'workspace', 'worktree']);

/**
 * Status probes and asynchronous action runs for the pinned / workspace action
 * buttons. Takes its two services directly (not the whole container) so the
 * routes can be exercised over real HTTP with fakes.
 */
export function pinnedActionsRoutes(deps: PinnedActionsRouteDeps) {
  return async function (app: FastifyInstance) {
    app.get('/api/pinned-status', async () => deps.pinnedStatus.getSnapshots());

    app.post<{ Params: { iconId: string } }>('/api/pinned-status/:iconId/refresh', async (request, reply) => {
      if (!deps.pinnedStatus.refresh(request.params.iconId)) {
        return reply.code(404).send({ error: 'No status probe for this icon' });
      }
      return reply.code(202).send({ ok: true });
    });

    app.post('/api/pinned-status/refresh', async (_request, reply) => {
      deps.pinnedStatus.refreshAll();
      return reply.code(202).send({ ok: true });
    });

    app.post<{ Body: { command?: string; timeoutSec?: number } }>('/api/pinned-status/test', async (request, reply) => {
      const command = request.body?.command;
      if (!command || typeof command !== 'string' || !command.trim()) {
        return reply.code(400).send({ error: 'command is required' });
      }
      return deps.pinnedStatus.test(command, request.body.timeoutSec);
    });

    app.post<{ Body: Partial<ActionRunRequest> }>('/api/action-runs', async (request, reply) => {
      const body = request.body ?? {};
      if (!body.command || typeof body.command !== 'string' || !body.command.trim()) {
        return reply.code(400).send({ error: 'command is required' });
      }
      if (!body.sourceId || typeof body.sourceId !== 'string') {
        return reply.code(400).send({ error: 'sourceId is required' });
      }
      const sourceKind = SOURCE_KINDS.has(body.sourceKind as ActionSourceKind) ? (body.sourceKind as ActionSourceKind) : 'pinned';

      deps.logger.info('Running action', { sourceId: body.sourceId, command: body.command });
      const result = deps.actionRuns.start({
        sourceId: body.sourceId,
        sourceKind,
        label: typeof body.label === 'string' ? body.label : body.sourceId,
        command: body.command,
        ...(typeof body.cwd === 'string' && body.cwd ? { cwd: body.cwd } : {}),
        ...(typeof body.timeoutSec === 'number' ? { timeoutSec: body.timeoutSec } : {}),
        ...(body.mode === 'terminal' ? { mode: 'terminal' as const } : {}),
        ...(typeof body.slot === 'string' && body.slot ? { slot: body.slot.slice(0, 128) } : {}),
      });
      if (!result.ok) return reply.code(409).send({ runId: result.runningRunId });
      return reply.code(202).send({ runId: result.run.runId, run: result.run });
    });

    // "Command not found": what a background action sees vs what the user's terminal sees.
    app.post<{ Body: { binary?: unknown } }>('/api/action-runs/diagnose', async (request, reply) => {
      if (!deps.binaryDiagnosis) return reply.code(501).send({ error: 'Diagnosis unavailable' });
      try {
        return await deps.binaryDiagnosis.diagnose(request.body?.binary as string);
      } catch (err) {
        if (err instanceof InvalidBinaryNameError) return reply.code(400).send({ error: err.message });
        throw err;
      }
    });

    app.get('/api/action-runs/capabilities', async () =>
      deps.actionRunCapabilities ? deps.actionRunCapabilities() : { liveOutput: false, terminal: false },
    );

    app.post<{ Params: { runId: string } }>('/api/action-runs/:runId/cancel', async (request, reply) => {
      if (!(await deps.actionRuns.cancel(request.params.runId))) {
        return reply.code(404).send({ error: 'No running run with this id' });
      }
      return reply.code(202).send({ ok: true });
    });

    app.post<{ Params: { runId: string } }>('/api/action-runs/:runId/terminal/close', async (request, reply) => {
      if (!(await deps.actionRuns.closeTerminal(request.params.runId))) {
        return reply.code(404).send({ error: 'Not a terminal run' });
      }
      return reply.code(202).send({ ok: true });
    });

    app.get<{ Querystring: { sourceId?: string } }>('/api/action-runs', async (request) =>
      deps.actionRuns.list(request.query.sourceId || undefined),
    );

    app.get<{ Params: { runId: string } }>('/api/action-runs/:runId', async (request, reply) => {
      const run = deps.actionRuns.get(request.params.runId);
      if (!run) return reply.code(404).send({ error: 'Run not found' });
      return run;
    });
  };
}
