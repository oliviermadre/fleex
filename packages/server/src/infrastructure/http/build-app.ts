import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance, type RouteOptions } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import type { Container } from '../container.js';
import type { WsHeartbeat } from '../ws/ws-heartbeat.js';
import type { ModelService } from '../../application/services/model.service.js';
import { sessionRoutes } from './sessions.routes.js';
import { repositoryRoutes } from './repositories.routes.js';
import { healthRoutes } from './health.routes.js';
import { versionRoutes } from './version.routes.js';
import { configRoutes } from './config.routes.js';
import { deliverableTypesRoutes } from './deliverable-types.routes.js';
import { execRoutes } from './exec.routes.js';
import { claudeConfigRoutes } from './claude-config.routes.js';
import { scratchpadRoutes } from './scratchpad.routes.js';
import { claudeUsageRoutes } from './claude-usage.routes.js';
import { agentTokenRoutes } from './agent-tokens.routes.js';
import { ticketRoutes } from './tickets.routes.js';
import { agentApiRoutes } from './agent-api.routes.js';
import { agentCommentsRoutes } from './agent-comments.routes.js';
import { agentMentionsRoutes } from './agent-mentions.routes.js';
import { agentDeliverablesRoutes } from './agent-deliverables.routes.js';
import { agentContextRoutes } from './agent-context.routes.js';
import { agentWorktreesRoutes } from './agent-worktrees.routes.js';
import { agentActivityRoutes } from './agent-activity.routes.js';
import { createAgentAuthHook } from './agent-auth.hook.js';
import { registerErrorHandler } from './error-handler.js';
import { agentWsPlugin } from '../ws/agent-ws.js';
import { unifiedWsPlugin } from '../ws/unified-ws.js';
import { personaRoutes } from './persona.routes.js';
import { skillRoutes } from './skill.routes.js';
import { panelRoutes } from './panel.routes.js';
import { agentEventsRoutes } from './agent-events.routes.js';
import { domainEventLogRoutes } from './domain-event-log.routes.js';
import { statisticsRoutes } from './statistics.routes.js';
import { dashboardRoutes } from './dashboard.routes.js';
import { githubImageProxyRoutes } from './github-image-proxy.routes.js';
import { fileRoutes } from './files.routes.js';
import { ticketGroupRoutes } from './ticket-groups.routes.js';
import { authRoutes } from './auth.routes.js';
import { createAuthMiddleware } from './auth-middleware.js';
import { workflowTemplateRoutes } from './workflow-template.routes.js';
import { workflowRunRoutes } from './workflow-run.routes.js';
import { hookRoutes } from './hook.routes.js';
import { modelsRoutes } from './models.routes.js';
import { overlaySyncRoutes } from './overlay-sync.routes.js';

export interface BuildAppOptions {
  container: Container;
  heartbeat: WsHeartbeat;
  modelService: ModelService;
  /**
   * Serve `packages/web/dist` and install the SPA notFoundHandler.
   * `true` in production. `false` in tests — otherwise a locally-built
   * `web/dist` would make 404 behaviour diverge between a dev machine and CI.
   */
  serveStatic: boolean;
  /**
   * Wired through `app.addHook('onRoute', …)` right after `Fastify()`, hence
   * before any `register`. The only way to observe every registered route.
   * Not supplied in production.
   */
  onRoute?: (route: RouteOptions) => void;
}

/**
 * Builds the fully wired Fastify instance: plugins, error handler, auth, every
 * HTTP route and both WebSocket plugins — in the exact order the server needs.
 *
 * NOTE on the auth middleware: registering `authRoutes` / `hookRoutes` before
 * `app.addHook('preHandler', authMiddleware)` does NOT exempt them. Fastify's
 * `addHook` walks `kChildren` and back-fills already-registered child contexts,
 * so the middleware covers every route regardless of order. The only thing that
 * actually exempts a path is the prefix allow-list inside `createAuthMiddleware`
 * (`/auth/`, `/health`, `/internal/`).
 *
 * Consequence, verified in tests/integration/http/auth-middleware.test.ts:
 * under full SSO (`DATABASE_URL` + OAuth) `POST /api/hook` answers 401. That is
 * a bug — the Claude Code hook ingress is a local curl with no cookie. It is
 * locked as-is here and fixed separately, so the safety net and the fix stay
 * distinguishable.
 */
export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const { container, heartbeat, modelService, serveStatic } = opts;

  const app = Fastify({ logger: false });
  if (opts.onRoute) app.addHook('onRoute', opts.onRoute);

  await app.register(cors, { origin: true, credentials: true });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });
  await app.register(websocket);

  registerErrorHandler(app);

  // Auth routes (public — no middleware)
  await app.register(authRoutes(container));

  // Claude Code hook ingress — public (localhost-only enforced inside the route)
  await app.register(hookRoutes(container));

  // Auth middleware for all subsequent routes
  const authMiddleware = createAuthMiddleware(container);
  app.addHook('preHandler', authMiddleware);

  // Register HTTP routes
  await app.register(sessionRoutes(container));
  await app.register(repositoryRoutes(container));
  await app.register(healthRoutes(container));
  await app.register(versionRoutes());
  await app.register(configRoutes(container));
  await app.register(deliverableTypesRoutes(container));
  await app.register(execRoutes(container));
  await app.register(claudeConfigRoutes(container));
  await app.register(scratchpadRoutes(container));
  await app.register(claudeUsageRoutes(container));
  await app.register(agentTokenRoutes(container));
  await app.register(ticketRoutes(container));
  await app.register(personaRoutes(container));
  await app.register(skillRoutes(container));
  await app.register(panelRoutes(container));
  await app.register(agentEventsRoutes(container));
  await app.register(domainEventLogRoutes(container));
  await app.register(statisticsRoutes(container));
  await app.register(dashboardRoutes(container));
  await app.register(githubImageProxyRoutes(container));
  await app.register(fileRoutes(container));
  await app.register(ticketGroupRoutes(container));
  await app.register(overlaySyncRoutes(container));

  // Anthropic model discovery (cached server-side)
  await app.register(modelsRoutes(modelService));

  // Workflow template routes (requires workflowTemplateStore — available on sqlite/supabase)
  if (container.workflowTemplateStore) {
    await app.register(workflowTemplateRoutes({ templateStore: container.workflowTemplateStore }));
  } else {
    container.logger.warn('workflowTemplateStore not available — /api/workflows/templates routes skipped');
  }

  // Workflow run routes (requires run/step stores + all use cases)
  if (
    container.workflowRunStore &&
    container.stepRunStore &&
    container.createWorkflowRun &&
    container.resolveHumanGate &&
    container.retryStep &&
    container.cancelWorkflowRun
  ) {
    await app.register(workflowRunRoutes({
      runStore: container.workflowRunStore,
      stepRunStore: container.stepRunStore,
      createWorkflowRun: container.createWorkflowRun,
      resolveHumanGate: container.resolveHumanGate,
      retryStep: container.retryStep,
      cancelWorkflowRun: container.cancelWorkflowRun,
      authorNameResolver: () => 'workflow-trigger',
    }));
  } else {
    container.logger.warn('workflowRunStore or use cases not available — /api/workflows/runs routes skipped');
  }

  // Agent API with auth
  const authHook = createAgentAuthHook(container);
  await app.register(async function (v1) {
    v1.addHook('preHandler', authHook);
    await v1.register(agentApiRoutes(container));
    await v1.register(agentCommentsRoutes(container));
    await v1.register(agentMentionsRoutes(container));
    await v1.register(agentDeliverablesRoutes(container));
    await v1.register(agentContextRoutes(container));
    await v1.register(agentWorktreesRoutes(container));
    await v1.register(agentActivityRoutes(container));
  }, { prefix: '/api/agents/v1' });

  // Register WebSocket handlers
  await app.register(unifiedWsPlugin(container, container.jsonlFileWatcher, heartbeat));
  await app.register(agentWsPlugin(container, heartbeat));

  // Serve frontend static files in production
  if (serveStatic) {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const webDistPath = join(__dirname, '../../../../web/dist');
    if (existsSync(webDistPath)) {
      await app.register(fastifyStatic, { root: webDistPath, prefix: '/' });
      app.setNotFoundHandler((req, reply) => {
        if (req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/ws') && !req.url.startsWith('/health')) {
          return reply.sendFile('index.html');
        }
        return reply.code(404).send({ error: 'Not found' });
      });
    }
  }

  return app;
}
