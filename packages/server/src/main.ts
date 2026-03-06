import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { createContainer } from './infrastructure/container.js';
import { sessionRoutes } from './infrastructure/http/sessions.routes.js';
import { repositoryRoutes } from './infrastructure/http/repositories.routes.js';
import { healthRoutes } from './infrastructure/http/health.routes.js';
import { configRoutes } from './infrastructure/http/config.routes.js';
import { execRoutes } from './infrastructure/http/exec.routes.js';
import { claudeConfigRoutes } from './infrastructure/http/claude-config.routes.js';
import { scratchpadRoutes } from './infrastructure/http/scratchpad.routes.js';
import { claudeUsageRoutes } from './infrastructure/http/claude-usage.routes.js';
import { agentTokenRoutes } from './infrastructure/http/agent-tokens.routes.js';
import { ticketRoutes } from './infrastructure/http/tickets.routes.js';
import { agentApiRoutes } from './infrastructure/http/agent-api.routes.js';
import { agentCommentsRoutes } from './infrastructure/http/agent-comments.routes.js';
import { agentMentionsRoutes } from './infrastructure/http/agent-mentions.routes.js';
import { agentDeliverablesRoutes } from './infrastructure/http/agent-deliverables.routes.js';
import { agentContextRoutes } from './infrastructure/http/agent-context.routes.js';
import { agentWorktreesRoutes } from './infrastructure/http/agent-worktrees.routes.js';
import { createAgentAuthHook } from './infrastructure/http/agent-auth.hook.js';
import { registerErrorHandler } from './infrastructure/http/error-handler.js';
import { terminalWsPlugin } from './infrastructure/ws/terminal-ws.js';
import { dashboardWsPlugin } from './infrastructure/ws/dashboard-ws.js';
import { repositoryWsPlugin } from './infrastructure/ws/repository-ws.js';
import { ticketWsPlugin } from './infrastructure/ws/ticket-ws.js';
import { agentWsPlugin } from './infrastructure/ws/agent-ws.js';
import { personaWsPlugin } from './infrastructure/ws/persona-ws.js';
import { agentEventsWsPlugin } from './infrastructure/ws/agent-events-ws.js';
import { personaRoutes } from './infrastructure/http/persona.routes.js';
import { agentEventsRoutes } from './infrastructure/http/agent-events.routes.js';
import { authRoutes } from './infrastructure/http/auth.routes.js';
import { createAuthMiddleware } from './infrastructure/http/auth-middleware.js';

async function main() {
  const container = await createContainer();

  // Discover existing fleex_ tmux sessions
  await container.discoverSessions.execute();

  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true, credentials: true });
  await app.register(websocket);

  registerErrorHandler(app);

  // Auth routes (public — no middleware)
  await app.register(authRoutes(container));

  // Auth middleware for all subsequent routes
  const authMiddleware = createAuthMiddleware(container);
  app.addHook('preHandler', authMiddleware);

  // Register HTTP routes
  await app.register(sessionRoutes(container));
  await app.register(repositoryRoutes(container));
  await app.register(healthRoutes(container));
  await app.register(configRoutes(container));
  await app.register(execRoutes(container));
  await app.register(claudeConfigRoutes(container));
  await app.register(scratchpadRoutes(container));
  await app.register(claudeUsageRoutes(container));
  await app.register(agentTokenRoutes(container));
  await app.register(ticketRoutes(container));
  await app.register(personaRoutes(container));
  await app.register(agentEventsRoutes(container));

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
  }, { prefix: '/api/agents/v1' });

  // Register WebSocket handlers
  await app.register(terminalWsPlugin(container));
  await app.register(dashboardWsPlugin(container, container.jsonlFileWatcher));
  await app.register(repositoryWsPlugin(container));
  await app.register(ticketWsPlugin(container));
  await app.register(agentWsPlugin(container));
  await app.register(personaWsPlugin(container));
  await app.register(agentEventsWsPlugin(container));

  // Auto-resolve repository patterns at startup if needed
  {
    const cfg = container.config.get();
    const repos = cfg.repositories;
    const resolved = cfg.resolvedRepositories;
    if (Array.isArray(repos) && repos.length > 0 && (!Array.isArray(resolved) || resolved.length === 0)) {
      try {
        const resolvedRepos = await container.repositoryResolver.resolve(repos);
        await container.config.update({ resolvedRepositories: resolvedRepos, resolvedAt: new Date().toISOString() });
        container.logger.info('Auto-resolved repository patterns', { count: resolvedRepos.length });
      } catch (err) {
        container.logger.warn('Failed to auto-resolve repos at startup', { error: String(err) });
      }
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
    const repoPath = join(container.config.get().basePath, org, name);
    return container.hostFs.exists(repoPath);
  });

  // Wire merge detection for ticket auto-complete
  container.repositoryRefreshScheduler.setOnMergedPRs(async (mergedPRs, repoKey) => {
    const movedIds = await container.detectMerge.execute(mergedPRs, repoKey);
    for (const id of movedIds) {
      const ticket = await container.ticketStore.getTicketById(id);
      if (ticket) container.ticketBroadcast('ticket:moved', ticket.toDTO());
    }
  });

  // Serve frontend static files in production
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const webDistPath = join(__dirname, '../../web/dist');
  if (existsSync(webDistPath)) {
    await app.register(fastifyStatic, { root: webDistPath, prefix: '/' });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/ws') && !req.url.startsWith('/health')) {
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
      container.logger.warn('Gateway returned non-OK status', { gatewayUrl: container.gatewayUrl, status: gwRes.status });
    }
  } catch {
    container.logger.warn('Gateway not reachable at startup', { gatewayUrl: container.gatewayUrl });
  }

  // Graceful shutdown
  const shutdown = async () => {
    container.logger.info('Shutting down server...');

    // Cleanup auto-review workflow
    container.autoReviewWorkflow.cleanup();

    // Stop repository refresh scheduler
    container.repositoryRefreshScheduler.stop();

    // Close Fastify server
    await app.close();

    container.logger.info('Server shutdown complete');
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(console.error);
