import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';

import { ModelService } from './application/services/model.service.js';
import { migrateRepositoryPatterns } from './domain/services/repository-pattern-migration.js';
import { createContainer } from './infrastructure/container.js';
import { agentActivityRoutes } from './infrastructure/http/agent-activity.routes.js';
import { agentApiRoutes } from './infrastructure/http/agent-api.routes.js';
import { createAgentAuthHook } from './infrastructure/http/agent-auth.hook.js';
import { agentCommentsRoutes } from './infrastructure/http/agent-comments.routes.js';
import { agentContextRoutes } from './infrastructure/http/agent-context.routes.js';
import { agentDeliverablesRoutes } from './infrastructure/http/agent-deliverables.routes.js';
import { agentEventsRoutes } from './infrastructure/http/agent-events.routes.js';
import { agentMentionsRoutes } from './infrastructure/http/agent-mentions.routes.js';
import { agentTokenRoutes } from './infrastructure/http/agent-tokens.routes.js';
import { agentWorktreesRoutes } from './infrastructure/http/agent-worktrees.routes.js';
import { createAuthMiddleware } from './infrastructure/http/auth-middleware.js';
import { authRoutes } from './infrastructure/http/auth.routes.js';
import { claudeConfigRoutes } from './infrastructure/http/claude-config.routes.js';
import { claudeUsageRoutes } from './infrastructure/http/claude-usage.routes.js';
import { configRoutes } from './infrastructure/http/config.routes.js';
import { dashboardRoutes } from './infrastructure/http/dashboard.routes.js';
import { deliverableTypesRoutes } from './infrastructure/http/deliverable-types.routes.js';
import { domainEventLogRoutes } from './infrastructure/http/domain-event-log.routes.js';
import { registerErrorHandler } from './infrastructure/http/error-handler.js';
import { execRoutes } from './infrastructure/http/exec.routes.js';
import { fileRoutes } from './infrastructure/http/files.routes.js';
import { githubImageProxyRoutes } from './infrastructure/http/github-image-proxy.routes.js';
import { healthRoutes } from './infrastructure/http/health.routes.js';
import { hookRoutes } from './infrastructure/http/hook.routes.js';
import { modelsRoutes } from './infrastructure/http/models.routes.js';
import { overlaySyncRoutes } from './infrastructure/http/overlay-sync.routes.js';
import { panelRoutes } from './infrastructure/http/panel.routes.js';
import { personaRoutes } from './infrastructure/http/persona.routes.js';
import { repositoryRoutes } from './infrastructure/http/repositories.routes.js';
import { scratchpadRoutes } from './infrastructure/http/scratchpad.routes.js';
import { fleexServerFactory } from './infrastructure/http/server-factory.js';
import { sessionRoutes } from './infrastructure/http/sessions.routes.js';
import { skillRoutes } from './infrastructure/http/skill.routes.js';
import { statisticsRoutes } from './infrastructure/http/statistics.routes.js';
import { ticketGroupRoutes } from './infrastructure/http/ticket-groups.routes.js';
import { ticketRoutes } from './infrastructure/http/tickets.routes.js';
import { versionRoutes } from './infrastructure/http/version.routes.js';
import { workflowRunRoutes } from './infrastructure/http/workflow-run.routes.js';
import { workflowTemplateRoutes } from './infrastructure/http/workflow-template.routes.js';
import { agentWsPlugin } from './infrastructure/ws/agent-ws.js';
import { unifiedWsPlugin } from './infrastructure/ws/unified-ws.js';
import { WsHeartbeat } from './infrastructure/ws/ws-heartbeat.js';

async function main() {
  const container = await createContainer();

  migrateRepositoryPatterns(container.config, container.repositoryResolver, container.logger).catch(
    (err) => container.logger.warn('Repository pattern migration failed', { error: String(err) }),
  );

  process.on('uncaughtException', (err) => {
    if ((err as NodeJS.ErrnoException).code === 'EPIPE') {
      container.logger.error('Uncaught EPIPE — likely SDK subprocess crash', {
        message: err.message,
        syscall: (err as NodeJS.ErrnoException).syscall,
      });
      return;
    }
    container.logger.error('Uncaught exception', { error: err.message, stack: err.stack });
    throw err;
  });

  // Discover existing fleex_ tmux sessions
  await container.discoverSessions.execute();

  const app = Fastify({ logger: false, serverFactory: fleexServerFactory });
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
  const modelService = new ModelService(container.logger);
  await app.register(modelsRoutes(modelService));

  // Workflow template routes (requires workflowTemplateStore — available on sqlite/supabase)
  if (container.workflowTemplateStore) {
    await app.register(workflowTemplateRoutes({ templateStore: container.workflowTemplateStore }));
  } else {
    container.logger.warn(
      'workflowTemplateStore not available — /api/workflows/templates routes skipped',
    );
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
    await app.register(
      workflowRunRoutes({
        runStore: container.workflowRunStore,
        stepRunStore: container.stepRunStore,
        createWorkflowRun: container.createWorkflowRun,
        resolveHumanGate: container.resolveHumanGate,
        retryStep: container.retryStep,
        cancelWorkflowRun: container.cancelWorkflowRun,
        authorNameResolver: () => 'workflow-trigger',
      }),
    );
  } else {
    container.logger.warn(
      'workflowRunStore or use cases not available — /api/workflows/runs routes skipped',
    );
  }

  // Agent API with auth
  const authHook = createAgentAuthHook(container);
  await app.register(
    async function (v1) {
      v1.addHook('preHandler', authHook);
      await v1.register(agentApiRoutes(container));
      await v1.register(agentCommentsRoutes(container));
      await v1.register(agentMentionsRoutes(container));
      await v1.register(agentDeliverablesRoutes(container));
      await v1.register(agentContextRoutes(container));
      await v1.register(agentWorktreesRoutes(container));
      await v1.register(agentActivityRoutes(container));
    },
    { prefix: '/api/agents/v1' },
  );

  // Register WebSocket handlers
  const heartbeat = new WsHeartbeat();
  await app.register(unifiedWsPlugin(container, container.jsonlFileWatcher, heartbeat));
  await app.register(agentWsPlugin(container, heartbeat));

  // Auto-resolve repository patterns at startup if needed
  {
    const cfg = container.config.get();
    const repos = cfg.repositories;
    const resolved = cfg.resolvedRepositories;
    if (
      Array.isArray(repos) &&
      repos.length > 0 &&
      (!Array.isArray(resolved) || resolved.length === 0)
    ) {
      try {
        const resolvedRepos = await container.repositoryResolver.resolve(repos);
        await container.config.update({
          resolvedRepositories: resolvedRepos,
          resolvedAt: new Date().toISOString(),
        });
        container.logger.info('Auto-resolved repository patterns', { count: resolvedRepos.length });
      } catch (err) {
        container.logger.warn('Failed to auto-resolve repos at startup', { error: String(err) });
      }
    }
  }

  // Sync bare clones with configured repos
  {
    const resolved = container.config.get().resolvedRepositories;
    if (Array.isArray(resolved)) {
      const repos = resolved
        .filter((entry): entry is string => typeof entry === 'string' && entry.includes('/'))
        .map((entry) => {
          const [org, name] = entry.split('/');
          return { org: org!, name: name! };
        });
      container.bareCloneManager.syncWithConfig(repos).catch((err) => {
        container.logger.warn('Failed to sync bare clones at startup', { error: String(err) });
      });
    }
  }

  // Start repository refresh scheduler if configured
  const refreshInterval = container.config.get().repositoryRefreshIntervalMs;
  if (refreshInterval > 0) {
    const resolved = container.config.get().resolvedRepositories;
    if (Array.isArray(resolved)) {
      const repos = resolved
        .filter((entry): entry is string => typeof entry === 'string' && entry.includes('/'))
        .map((entry) => {
          const [org, name] = entry.split('/');
          return { org: org!, name: name! };
        });
      container.repositoryRefreshScheduler.setRepos(repos);
      container.repositoryRefreshScheduler.start(refreshInterval);
    }
  }

  // Wire repo-exists check so refresh summaries include isClonedLocally
  container.repositoryRefreshScheduler.setCheckRepoExists(async (org, name) => {
    const barePath = container.resolver.barePath(org, name);
    return container.hostFs.exists(barePath);
  });

  // Wire merge detection for ticket auto-complete
  container.repositoryRefreshScheduler.setOnMergedPRs(async (mergedPRs, repoKey) => {
    const movedIds = await container.detectMerge.execute(mergedPRs, repoKey);
    for (const id of movedIds) {
      container.eventBus.emit({
        type: 'ticket.moved',
        ticketId: id,
        fromStatus: '',
        toStatus: 'done',
        occurredAt: new Date(),
      });
    }
  });

  // Serve frontend static files in production
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const webDistPath = join(__dirname, '../../web/dist');
  if (existsSync(webDistPath)) {
    await app.register(fastifyStatic, { root: webDistPath, prefix: '/' });
    app.setNotFoundHandler((req, reply) => {
      if (
        req.method === 'GET' &&
        !req.url.startsWith('/api') &&
        !req.url.startsWith('/ws') &&
        !req.url.startsWith('/health')
      ) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'Not found' });
    });
  }

  const port = parseInt(process.env['PORT'] ?? '3000', 10);
  await app.listen({ port, host: '0.0.0.0' });
  container.logger.info(`Fleex server started on port ${port}`);

  // Verify gateway connectivity
  try {
    const gwRes = await fetch(`${container.gatewayUrl}/health`);
    if (gwRes.ok) {
      container.logger.info('Gateway connected', { gatewayUrl: container.gatewayUrl });
    } else {
      container.logger.warn('Gateway returned non-OK status', {
        gatewayUrl: container.gatewayUrl,
        status: gwRes.status,
      });
    }
  } catch {
    container.logger.warn('Gateway not reachable at startup', { gatewayUrl: container.gatewayUrl });
  }

  // Graceful shutdown
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    container.logger.info('Shutting down server...', { signal });

    // Watchdog: if a clean shutdown stalls, force the process out so we never
    // leave an orphaned worker reconnecting to the hub forever.
    const forceExit = setTimeout(() => {
      container.logger.warn('Shutdown timed out — forcing exit');
      process.exit(1);
    }, 5000);
    forceExit.unref();

    try {
      // Stop repository refresh scheduler
      container.repositoryRefreshScheduler.stop();

      // Stop WebSocket heartbeat
      heartbeat.stop();

      // Close the hub client — releases its reconnect + ping timers, which
      // otherwise keep the event loop (and the process) alive indefinitely.
      container.hubClient?.close();

      // Close Fastify server
      await app.close();

      container.logger.info('Server shutdown complete');
    } catch (err) {
      container.logger.error('Error during shutdown', {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      clearTimeout(forceExit);
      // Explicit exit: any lingering handle would otherwise keep us running.
      process.exit(0);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch(console.error);
