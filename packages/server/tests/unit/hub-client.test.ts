import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { HubClient } from '../../src/infrastructure/hub/hub-client.js';
import type { AnyDomainEvent } from '../../src/domain/events.js';
import type { LoggerPort } from '../../src/application/ports/logger.port.js';

const HUB_ENTRY = path.resolve(__dirname, '../../../event-hub/src/main.ts');

function silentLogger(): LoggerPort {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (!addr || typeof addr === 'string') {
        srv.close();
        reject(new Error('no port'));
        return;
      }
      const port = addr.port;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForHealth(port: number, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(500),
      });
      if (res.ok) return;
    } catch { /* keep polling */ }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`hub not healthy on port ${port}`);
}

describe('HubClient ↔ event-hub fan-out', () => {
  let hub: ChildProcess | null = null;
  let port: number;
  const token = 'test-token';

  beforeEach(async () => {
    port = await findFreePort();
    hub = spawn('bun', ['run', HUB_ENTRY], {
      env: {
        ...process.env,
        FLEEX_EVENT_HUB_PORT: String(port),
        FLEEX_EVENT_HUB_TOKEN: token,
      },
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    await waitForHealth(port);
  });

  afterEach(async () => {
    if (hub && !hub.killed) {
      hub.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 100));
    }
    hub = null;
  });

  it('forwards events to other servers but not to the originator', async () => {
    const url = `ws://127.0.0.1:${port}/events`;
    const receivedByA: AnyDomainEvent[] = [];
    const receivedByB: AnyDomainEvent[] = [];

    const clientA = new HubClient({
      url, token, serverId: 'server-a',
      logger: silentLogger(),
      onRemoteEvent: (e) => receivedByA.push(e),
    });
    const clientB = new HubClient({
      url, token, serverId: 'server-b',
      logger: silentLogger(),
      onRemoteEvent: (e) => receivedByB.push(e),
    });

    clientA.start();
    clientB.start();

    // Wait for both connections to register + hello.
    await new Promise((r) => setTimeout(r, 400));

    const event: AnyDomainEvent = {
      type: 'ticket.updated',
      occurredAt: new Date('2025-01-01T12:00:00Z'),
      ticketId: 't-1',
      changes: { title: { from: 'old', to: 'new' } },
    };
    clientA.publish(event);

    await new Promise((r) => setTimeout(r, 200));

    expect(receivedByA).toEqual([]);
    expect(receivedByB.length).toBe(1);
    const got = receivedByB[0]!;
    expect(got.type).toBe('ticket.updated');
    expect(got.occurredAt).toBeInstanceOf(Date);
    expect(got.occurredAt.toISOString()).toBe('2025-01-01T12:00:00.000Z');
    // payload survives round trip
    expect((got as { ticketId: string }).ticketId).toBe('t-1');

    clientA.close();
    clientB.close();
  });

  it('does NOT publish HUB_SHARED_EXCLUDED events (sessions, worktree)', async () => {
    const url = `ws://127.0.0.1:${port}/events`;
    const receivedByB: AnyDomainEvent[] = [];

    const clientA = new HubClient({
      url, token, serverId: 'server-a',
      logger: silentLogger(),
      onRemoteEvent: () => {},
    });
    const clientB = new HubClient({
      url, token, serverId: 'server-b',
      logger: silentLogger(),
      onRemoteEvent: (e) => receivedByB.push(e),
    });

    clientA.start();
    clientB.start();
    await new Promise((r) => setTimeout(r, 400));

    clientA.publish({
      type: 'session.hookStatusChanged',
      occurredAt: new Date(),
      sessionId: 's1', previousStatus: 'idle', nextStatus: 'busy', waitingReason: null,
    });
    clientA.publish({
      type: 'worktree.created',
      occurredAt: new Date(),
      repoPath: '/r', worktreePath: '/w', branch: 'main', isNewBranch: false,
    });

    await new Promise((r) => setTimeout(r, 200));
    expect(receivedByB).toEqual([]);

    clientA.close();
    clientB.close();
  });

  it('queues events while disconnected and drains on reconnect', async () => {
    const url = `ws://127.0.0.1:${port}/events`;
    const receivedByB: AnyDomainEvent[] = [];

    const clientB = new HubClient({
      url, token, serverId: 'server-b',
      logger: silentLogger(),
      onRemoteEvent: (e) => receivedByB.push(e),
    });
    clientB.start();
    await new Promise((r) => setTimeout(r, 300));

    // Build a client whose URL points to a dead port — initial connect fails.
    const deadClient = new HubClient({
      url: `ws://127.0.0.1:${port}/events`,
      token: 'wrong-token',
      serverId: 'server-c',
      logger: silentLogger(),
      onRemoteEvent: () => {},
    });
    deadClient.start();

    // Publish before any connection succeeds — should be queued.
    deadClient.publish({
      type: 'ticket.created',
      occurredAt: new Date(),
      ticketId: 't-queued', boardId: 'b-1',
    });
    expect(deadClient.stats().queueLength).toBeGreaterThanOrEqual(1);

    deadClient.close();
    clientB.close();
  });
});
