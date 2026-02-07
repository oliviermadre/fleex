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
import { registerErrorHandler } from './infrastructure/http/error-handler.js';
import { terminalWsPlugin } from './infrastructure/ws/terminal-ws.js';
import { dashboardWsPlugin } from './infrastructure/ws/dashboard-ws.js';

async function main() {
  const container = createContainer();

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

  // Register WebSocket handlers
  await app.register(terminalWsPlugin(container));
  await app.register(dashboardWsPlugin(container));

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
