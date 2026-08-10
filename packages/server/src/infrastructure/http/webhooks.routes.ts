import type { FastifyInstance } from 'fastify';
import { RoutineRunAlreadyActiveError } from '../../domain/errors.js';
import type { RoutineStorePort } from '../../application/ports/routine-store.port.js';
import type { RunRoutineUseCase } from '../../application/use-cases/run-routine.js';

/**
 * Inbound webhook deliveries — the push half of routine firing.
 *
 * `POST /api/hooks/:token` where the token IS the auth: a 256-bit capability
 * secret minted when the routine's webhook was enabled, looked up exact-match
 * on a unique index (never iterated, so timing reveals nothing about near-miss
 * tokens). One universal scheme instead of per-source signature verification —
 * that is what keeps "connect a new source" a zero-code operation.
 *
 * Response contract, designed for senders that retry on non-2xx:
 * - 404 for an unknown token AND for a routine whose webhook is disabled —
 *   indistinguishable on purpose (no token enumeration, and a disabled hook
 *   must look dead, not "try later").
 * - 409 when the routine itself is disabled, or when a run is already active
 *   (one run per routine — the same rule as the scheduler's overlap policy).
 *   Idempotent `ticket.upsert` steps make an eventual re-delivery safe.
 * - 202 with the run id: the run is dispatched, not awaited.
 *
 * The body (JSON, ≤256 KiB — Fastify's bodyLimit answers 413 beyond) is
 * persisted on the run as `triggerPayload` and republished by the template's
 * `trigger` step. An empty body is a legal "poke".
 */
export function webhookRoutes(deps: {
  routineStore: RoutineStorePort;
  runRoutine: RunRoutineUseCase;
}) {
  return async function (app: FastifyInstance) {
    app.post<{ Params: { token: string } }>(
      '/api/hooks/:token',
      { bodyLimit: 256 * 1024 },
      async (request, reply) => {
        const routine = await deps.routineStore.getByWebhookSecret(request.params.token);
        if (!routine || !routine.webhookEnabled) {
          return reply.code(404).send({ error: 'UNKNOWN_HOOK' });
        }
        if (!routine.enabled) {
          return reply.code(409).send({ error: 'ROUTINE_DISABLED' });
        }

        // Fastify parses JSON bodies; a POST without a body arrives as null.
        const payload = request.body ?? {};

        try {
          const run = await deps.runRoutine.execute({
            routineId: routine.id,
            triggeredBy: 'webhook',
            triggeredFrom: 'webhook',
            triggerPayload: payload,
          });
          return reply.code(202).send({ runId: run.id, routineSlug: routine.slug });
        } catch (err) {
          if (err instanceof RoutineRunAlreadyActiveError) {
            return reply.code(409).send({ error: 'RUN_ALREADY_ACTIVE' });
          }
          throw err;
        }
      },
    );
  };
}
