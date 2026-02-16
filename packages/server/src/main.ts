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
import { createAgentAuthHook } from './infrastructure/http/agent-auth.hook.js';
import { registerErrorHandler } from './infrastructure/http/error-handler.js';
import { terminalWsPlugin } from './infrastructure/ws/terminal-ws.js';
import { dashboardWsPlugin } from './infrastructure/ws/dashboard-ws.js';
import { repositoryWsPlugin } from './infrastructure/ws/repository-ws.js';
import { ticketWsPlugin } from './infrastructure/ws/ticket-ws.js';

async function main() {
  const container = await createContainer();

  // Discover existing asm_ tmux sessions
  await container.discoverSessions.execute();

  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });
  await app.register(websocket);

  registerErrorHandler(app);

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

  // Agent API with auth
  const authHook = createAgentAuthHook(container);
  await app.register(async function (v1) {
    v1.addHook('preHandler', authHook);
    await v1.register(agentApiRoutes(container));
  }, { prefix: '/api/agents/v1' });

  // Register WebSocket handlers
  await app.register(terminalWsPlugin(container));
  await app.register(dashboardWsPlugin(container));
  await app.register(repositoryWsPlugin(container));
  await app.register(ticketWsPlugin(container));

  // Start repository refresh scheduler if configured
  const config = container.config.get() as unknown as Record<string, unknown>;
  const refreshInterval = container.config.get().repositoryRefreshIntervalMs;
  if (refreshInterval > 0) {
    const resolved = config['resolvedRepositories'];
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

  // Wire merge detection for ticket auto-complete
  container.repositoryRefreshScheduler.setOnMergedPRs(async (mergedPRs, repoKey) => {
    const movedIds = await container.detectMerge.execute(mergedPRs, repoKey);
    for (const id of movedIds) {
      const ticket = container.ticketStore.getTicketById(id);
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
  container.logger.info(`ASM server started on port ${port}`);
}

main().catch(console.error);
