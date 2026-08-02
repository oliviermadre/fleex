import type { FastifyInstance, RouteOptions } from 'fastify';
import { buildApp } from '../../src/infrastructure/http/build-app.js';
import { WsHeartbeat } from '../../src/infrastructure/ws/ws-heartbeat.js';
import type { ModelService } from '../../src/application/services/model.service.js';
import { createTestContainer, type TestContainerHandle, type TestContainerOptions } from './test-container.js';

export interface TestAppOptions extends TestContainerOptions {
  /** Forwarded to buildApp — see the route-inventory test. */
  onRoute?: (route: RouteOptions) => void;
}

export interface TestAppHandle extends TestContainerHandle {
  app: FastifyInstance;
  /** Stops the heartbeat, closes Fastify, removes the temp home. */
  close(): Promise<void>;
}

/**
 * Boots the real server wiring (`buildApp`) over an isolated json-driver
 * container. `serveStatic` is false so a locally-built `packages/web/dist`
 * can't change 404 behaviour between a dev machine and CI.
 */
export async function createTestApp(opts: TestAppOptions = {}): Promise<TestAppHandle> {
  const handle = await createTestContainer(opts);
  const heartbeat = new WsHeartbeat();

  const modelService = {
    getModels: async () => ({ models: [] }),
  } as unknown as ModelService;

  const app = await buildApp({
    container: handle.container,
    heartbeat,
    modelService,
    serveStatic: false,
    ...(opts.onRoute ? { onRoute: opts.onRoute } : {}),
  });
  await app.ready();

  return {
    ...handle,
    app,
    close: async () => {
      // Order matters: WsHeartbeat starts a setInterval in its constructor and
      // would keep the event loop alive past the end of the suite.
      heartbeat.stop();
      await app.close();
      await handle.dispose();
    },
  };
}
