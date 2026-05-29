import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
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

function hashToken(token: string): string {
  return 'sha256:' + createHash('sha256').update(token).digest('hex');
}

interface ProvisionedClient { name: string; token: string }

function writeClientsFile(file: string, clients: ProvisionedClient[]): void {
  writeFileSync(file, JSON.stringify({
    version: 1,
    clients: clients.map((c) => ({
      name: c.name,
      tokenHash: hashToken(c.token),
      createdAt: new Date().toISOString(),
    })),
  }, null, 2));
}

describe('HubClient ↔ event-hub fan-out', () => {
  let hub: ChildProcess | null = null;
  let port: number;
  let clientsFile: string;
  let tmpDir: string;
  let tokenA: string;
  let tokenB: string;

  beforeEach(async () => {
    port = await findFreePort();
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'fleex-hub-test-'));
    clientsFile = path.join(tmpDir, 'hub.clients.json');
    tokenA = randomBytes(16).toString('hex');
    tokenB = randomBytes(16).toString('hex');
    writeClientsFile(clientsFile, [
      { name: 'server-a', token: tokenA },
      { name: 'server-b', token: tokenB },
    ]);

    hub = spawn('bun', ['run', HUB_ENTRY], {
      env: {
        ...process.env,
        FLEEX_EVENT_HUB_PORT: String(port),
        FLEEX_HUB_CLIENTS_FILE: clientsFile,
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
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('forwards events to other servers but not to the originator', async () => {
    const url = `ws://127.0.0.1:${port}/events`;
    const receivedByA: AnyDomainEvent[] = [];
    const receivedByB: AnyDomainEvent[] = [];

    const clientA = new HubClient({
      url, token: tokenA, serverId: 'sid-a',
      logger: silentLogger(),
      onRemoteEvent: (e) => receivedByA.push(e),
    });
    const clientB = new HubClient({
      url, token: tokenB, serverId: 'sid-b',
      logger: silentLogger(),
      onRemoteEvent: (e) => receivedByB.push(e),
    });

    clientA.start();
    clientB.start();
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
    expect((got as { ticketId: string }).ticketId).toBe('t-1');

    clientA.close();
    clientB.close();
  });

  it('does NOT publish HUB_SHARED_EXCLUDED events (sessions, worktree)', async () => {
    const url = `ws://127.0.0.1:${port}/events`;
    const receivedByB: AnyDomainEvent[] = [];

    const clientA = new HubClient({
      url, token: tokenA, serverId: 'sid-a',
      logger: silentLogger(), onRemoteEvent: () => {},
    });
    const clientB = new HubClient({
      url, token: tokenB, serverId: 'sid-b',
      logger: silentLogger(), onRemoteEvent: (e) => receivedByB.push(e),
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

  it('rejects unknown tokens with 401', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/events`, {
      headers: { Authorization: 'Bearer not-a-real-token' },
    });
    expect(res.status).toBe(401);
  });

  it('rejects requests without Authorization header', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/events`);
    expect(res.status).toBe(401);
  });

  it('hot-disconnects a client when its entry is revoked', async () => {
    const url = `ws://127.0.0.1:${port}/events`;
    const clientA = new HubClient({
      url, token: tokenA, serverId: 'sid-a',
      logger: silentLogger(), onRemoteEvent: () => {},
    });
    clientA.start();
    await new Promise((r) => setTimeout(r, 400));
    expect(clientA.stats().connected).toBe(true);

    // Remove server-a from the authorized clients file.
    writeClientsFile(clientsFile, [{ name: 'server-b', token: tokenB }]);
    // Wait for fs.watch to fire on the hub side.
    await new Promise((r) => setTimeout(r, 500));

    // Hub should have closed our socket with code 4001. The client will then
    // attempt to reconnect with the (now-invalid) token and get 401'd — its
    // .connected flag will stay false.
    expect(clientA.stats().connected).toBe(false);

    clientA.close();
  });

  it('queues events while disconnected', async () => {
    const deadClient = new HubClient({
      url: `ws://127.0.0.1:${port}/events`,
      token: 'wrong-token',
      serverId: 'sid-x',
      logger: silentLogger(),
      onRemoteEvent: () => {},
    });
    deadClient.start();

    deadClient.publish({
      type: 'ticket.created',
      occurredAt: new Date(),
      ticketId: 't-queued', boardId: 'b-1',
    });
    expect(deadClient.stats().queueLength).toBeGreaterThanOrEqual(1);

    deadClient.close();
  });
});
