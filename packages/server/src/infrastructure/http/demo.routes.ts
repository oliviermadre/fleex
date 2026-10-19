import type { FastifyInstance } from 'fastify';
import type { Container } from '../container.js';
import {
  DemoNotEmptyError,
  DemoSeedError,
  SeedDemoUseCase,
  type DemoSeed,
} from '../../application/demo/seed-demo.js';

/** The demo routes exist only on an instance started with FLEEX_DEMO_MODE=1 (the `demo` workspace). */
export function isDemoMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.FLEEX_DEMO_MODE === '1';
}

/**
 * POST /api/demo/seed — writes the « Atelier Nova » backlog into an empty
 * instance. Called by `fleex demo reset` right after it recreated the DB.
 * Registered only in demo mode: anywhere else the route does not exist (404).
 */
export function demoRoutes(container: Pick<Container,
  'ticketStore' | 'ticketGroupStore' | 'commentStore' | 'deliverableStore' | 'annotationStore'
  | 'workflowRunStore' | 'stepRunStore' | 'personaStore'>) {
  return async function (app: FastifyInstance) {
    const useCase = new SeedDemoUseCase(container);
    app.post<{ Body: { seed?: DemoSeed; now?: string } }>('/api/demo/seed', async (request, reply) => {
      const seed = request.body?.seed;
      if (!seed || typeof seed !== 'object') return reply.code(400).send({ error: 'body must be { seed: {...} }' });
      const now = request.body?.now ? new Date(request.body.now) : new Date();
      if (Number.isNaN(now.getTime())) return reply.code(400).send({ error: `invalid "now": ${request.body?.now}` });
      try {
        return await useCase.execute(seed, now);
      } catch (e) {
        if (e instanceof DemoNotEmptyError) return reply.code(409).send({ error: e.message });
        if (e instanceof DemoSeedError) return reply.code(400).send({ error: `invalid seed:\n${e.message}` });
        throw e;
      }
    });
  };
}
