import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
import {
  AGENT_BACKFILL_MAX_EVENTS,
  AGENT_STREAM_DEMAND_TTL_MS,
  MAX_AGENT_EVENT_BYTES,
  type AgentEvent,
  type HubAgentEventMessage,
} from '@fleex/shared';
import { HubClient } from '../../src/infrastructure/hub/hub-client.js';
import type { AnyDomainEvent } from '../../src/domain/events.js';
import type { LoggerPort } from '../../src/application/ports/logger.port.js';

const HUB_ENTRY = path.resolve(__dirname, '../../../event-hub/src/main.ts');

const INSTANCE_A = { id: 'host-a:3000', label: 'host-a' };
const INSTANCE_B = { id: 'host-b:3000', label: 'host-b' };

function agentEvent(overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    id: randomBytes(8).toString('hex'),
    executionId: 'exec-1',
    eventType: 'content_block_delta',
    data: { text: 'hello' },
    sequence: 0,
    createdAt: new Date('2025-01-01T12:00:00Z').toISOString(),
    ...overrides,
  };
}

/** Poll until `predicate` holds, so tests don't hard-code relay latency. */
async function until(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('condition not met within timeout');
}

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
      url, token: tokenA, serverId: 'sid-a', instance: INSTANCE_A,
      logger: silentLogger(),
      onRemoteEvent: (e) => receivedByA.push(e),
    });
    const clientB = new HubClient({
      url, token: tokenB, serverId: 'sid-b', instance: INSTANCE_B,
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
      url, token: tokenA, serverId: 'sid-a', instance: INSTANCE_A,
      logger: silentLogger(), onRemoteEvent: () => {},
    });
    const clientB = new HubClient({
      url, token: tokenB, serverId: 'sid-b', instance: INSTANCE_B,
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
      url, token: tokenA, serverId: 'sid-a', instance: INSTANCE_A,
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
      instance: { id: 'host-x:3000', label: 'host-x' },
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

describe('HubClient ↔ event-hub agent event relay', () => {
  let hub: ChildProcess | null = null;
  let port: number;
  let tmpDir: string;
  let tokenA: string;
  let tokenB: string;
  let clientA: HubClient;
  let clientB: HubClient;
  let receivedByB: HubAgentEventMessage[];
  let backfillRequests: { executionId: string; requestId: string }[];

  beforeEach(async () => {
    port = await findFreePort();
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'fleex-hub-agent-test-'));
    const clientsFile = path.join(tmpDir, 'hub.clients.json');
    tokenA = randomBytes(16).toString('hex');
    tokenB = randomBytes(16).toString('hex');
    writeClientsFile(clientsFile, [
      { name: 'server-a', token: tokenA },
      { name: 'server-b', token: tokenB },
    ]);

    hub = spawn('bun', ['run', HUB_ENTRY], {
      env: { ...process.env, FLEEX_EVENT_HUB_PORT: String(port), FLEEX_HUB_CLIENTS_FILE: clientsFile },
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    await waitForHealth(port);

    const url = `ws://127.0.0.1:${port}/events`;
    receivedByB = [];
    backfillRequests = [];

    // A runs the agents; B watches.
    clientA = new HubClient({
      url, token: tokenA, serverId: 'sid-a', instance: INSTANCE_A,
      logger: silentLogger(),
      onRemoteEvent: () => {},
      onAgentBackfillRequest: (msg) => {
        backfillRequests.push({ executionId: msg.executionId, requestId: msg.requestId });
      },
    });
    clientB = new HubClient({
      url, token: tokenB, serverId: 'sid-b', instance: INSTANCE_B,
      logger: silentLogger(),
      onRemoteEvent: () => {},
      onRemoteAgentEvent: (msg) => receivedByB.push(msg),
    });
    clientA.start();
    clientB.start();
    await until(() => clientA.stats().connected && clientB.stats().connected);
  });

  afterEach(async () => {
    clientA?.close();
    clientB?.close();
    if (hub && !hub.killed) {
      hub.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 100));
    }
    hub = null;
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('relays lifecycle events unconditionally and withholds stream payload until demanded', async () => {
    // No demand: B is "on another screen". It must learn the run exists…
    clientA.publishAgentEvent(agentEvent({ eventType: 'execution_start', sequence: 0 }));
    // …but must NOT receive the stream.
    clientA.publishAgentEvent(agentEvent({ eventType: 'content_block_delta', sequence: 1 }));

    await until(() => receivedByB.length >= 1);
    await new Promise((r) => setTimeout(r, 150)); // let a wrongly-relayed delta arrive
    expect(receivedByB.map((m) => m.event.eventType)).toEqual(['execution_start']);
    expect(receivedByB[0]!.originatorInstanceLabel).toBe('host-a');

    // B opens the run: demand is announced, and the stream starts flowing.
    clientB.setAgentStreamDemand(['exec-1']);
    await until(() => clientA.stats().streamDemandIn === 1);

    clientA.publishAgentEvent(agentEvent({ eventType: 'content_block_delta', sequence: 2 }));
    await until(() => receivedByB.length >= 2);
    expect(receivedByB[1]!.event.eventType).toBe('content_block_delta');

    // B closes the run: demand is withdrawn and the stream stops.
    clientB.setAgentStreamDemand([]);
    await until(() => clientA.stats().streamDemandIn === 0);

    clientA.publishAgentEvent(agentEvent({ eventType: 'content_block_delta', sequence: 3 }));
    await new Promise((r) => setTimeout(r, 150));
    expect(receivedByB.length).toBe(2);
  });

  it('demand for one execution does not open the stream of another', async () => {
    clientB.setAgentStreamDemand(['exec-watched']);
    await until(() => clientA.stats().streamDemandIn === 1);

    clientA.publishAgentEvent(agentEvent({ executionId: 'exec-other', sequence: 1 }));
    clientA.publishAgentEvent(agentEvent({ executionId: 'exec-watched', sequence: 1 }));

    await until(() => receivedByB.length >= 1);
    await new Promise((r) => setTimeout(r, 150));
    expect(receivedByB.map((m) => m.event.executionId)).toEqual(['exec-watched']);
  });

  it('never relays stream payload when agent relaying is switched off', async () => {
    const muted = new HubClient({
      url: `ws://127.0.0.1:${port}/events`,
      token: tokenA, serverId: 'sid-muted', instance: INSTANCE_A,
      relayAgentEvents: false,
      logger: silentLogger(), onRemoteEvent: () => {},
    });
    muted.start();
    await until(() => muted.stats().connected);

    clientB.setAgentStreamDemand(['exec-1']);
    await until(() => muted.stats().streamDemandIn === 1);

    muted.publishAgentEvent(agentEvent({ eventType: 'execution_start', sequence: 0 }));
    muted.publishAgentEvent(agentEvent({ eventType: 'content_block_delta', sequence: 1 }));

    await until(() => receivedByB.length >= 1);
    await new Promise((r) => setTimeout(r, 150));
    // Awareness survives; the stream doesn't.
    expect(receivedByB.map((m) => m.event.eventType)).toEqual(['execution_start']);

    muted.close();
  });

  it('replaces an oversized payload with a size stub', async () => {
    clientB.setAgentStreamDemand(['exec-1']);
    await until(() => clientA.stats().streamDemandIn === 1);

    const huge = 'x'.repeat(MAX_AGENT_EVENT_BYTES + 1024);
    clientA.publishAgentEvent(agentEvent({ data: { text: huge }, sequence: 1 }));

    await until(() => receivedByB.length >= 1);
    const msg = receivedByB[0]!;
    expect(msg.truncated).toBe(true);
    expect(msg.event.data).toMatchObject({ truncated: true });
    expect((msg.event.data as { byteSize: number }).byteSize).toBeGreaterThan(MAX_AGENT_EVENT_BYTES);
  });

  it('routes a backfill response only to the requester', async () => {
    // A third instance must not ingest a reply addressed to B.
    const receivedByC: HubAgentEventMessage[] = [];
    const clientC = new HubClient({
      url: `ws://127.0.0.1:${port}/events`,
      token: tokenA, serverId: 'sid-c', instance: { id: 'host-c:3000', label: 'host-c' },
      logger: silentLogger(), onRemoteEvent: () => {},
      onRemoteAgentEvent: (msg) => receivedByC.push(msg),
    });
    clientC.start();
    await until(() => clientC.stats().connected);

    const requestId = clientB.requestAgentBackfill('exec-1');
    expect(requestId).toBeTruthy();
    await until(() => backfillRequests.length >= 1);
    expect(backfillRequests[0]!.executionId).toBe('exec-1');

    // Answering does NOT require demand — the requester asked explicitly.
    clientA.respondAgentBackfill(
      { kind: 'agentBackfillRequest', originatorServerId: 'sid-b', requestId: backfillRequests[0]!.requestId, executionId: 'exec-1' },
      [agentEvent({ sequence: 0 }), agentEvent({ sequence: 1 })],
    );

    await until(() => receivedByB.length >= 2);
    expect(receivedByB).toHaveLength(2);
    expect(receivedByB.every((m) => m.targetServerId === 'sid-b')).toBe(true);
    await new Promise((r) => setTimeout(r, 150));
    expect(receivedByC).toEqual([]);

    clientC.close();
  });

  it('caps a backfill response and reports the elision', async () => {
    const settled: { count: number; elided: boolean }[] = [];
    const watcher = new HubClient({
      url: `ws://127.0.0.1:${port}/events`,
      token: tokenB, serverId: 'sid-w', instance: INSTANCE_B,
      logger: silentLogger(), onRemoteEvent: () => {},
      onRemoteAgentEvent: () => {},
      onAgentBackfillEnd: (msg) => settled.push({ count: msg.count, elided: msg.elided }),
    });
    watcher.start();
    await until(() => watcher.stats().connected);

    const many = Array.from({ length: AGENT_BACKFILL_MAX_EVENTS + 50 }, (_, i) =>
      agentEvent({ sequence: i, data: { i } }),
    );
    clientA.respondAgentBackfill(
      { kind: 'agentBackfillRequest', originatorServerId: 'sid-w', requestId: 'req-1', executionId: 'exec-1' },
      many,
    );

    await until(() => settled.length >= 1, 5000);
    expect(settled[0]!.count).toBe(AGENT_BACKFILL_MAX_EVENTS);
    expect(settled[0]!.elided).toBe(true);

    watcher.close();
  });

  it('drops a sender\'s demand once its heartbeat goes stale', async () => {
    clientB.setAgentStreamDemand(['exec-1']);
    await until(() => clientA.stats().streamDemandIn === 1);

    // Simulate the TTL elapsing without a refresh (a viewer's instance vanishing
    // without a clean unsubscribe). `isStreamDemanded` is what evicts the entry.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + AGENT_STREAM_DEMAND_TTL_MS + 1000);
      expect(clientA.isStreamDemanded('exec-1')).toBe(false);
      expect(clientA.stats().streamDemandIn).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
