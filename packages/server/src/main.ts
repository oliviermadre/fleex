import { createContainer } from './infrastructure/container.js';
import { migrateRepositoryPatterns } from './domain/services/repository-pattern-migration.js';
import { buildApp } from './infrastructure/http/build-app.js';
import { WsHeartbeat } from './infrastructure/ws/ws-heartbeat.js';
import { ModelService } from './application/services/model.service.js';

async function main() {
  const container = await createContainer();

  migrateRepositoryPatterns(container.config, container.repositoryResolver, container.logger)
    .catch((err) => container.logger.warn('Repository pattern migration failed', { error: String(err) }));

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

  const heartbeat = new WsHeartbeat();
  const modelService = new ModelService(container.logger);
  const app = await buildApp({ container, heartbeat, modelService, serveStatic: true });

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
      container.eventBus.emit({ type: 'ticket.moved', ticketId: id, fromStatus: '', toStatus: 'done', occurredAt: new Date() });
    }
  });

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
