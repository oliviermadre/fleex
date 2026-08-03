import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyInstance } from 'fastify';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { fleexServerFactory } from '../../src/infrastructure/http/server-factory.js';
import { registerTicketBulkQueryRoutes } from '../../src/infrastructure/http/ticket-bulk-queries.routes.js';

// ---------------------------------------------------------------------------
// Regression test for #509 — "Request Header Fields Too Large" on Cockpit/Kanban.
//
// This one goes through the REAL HTTP layer on purpose. The existing store
// tests (ticketActivityStore.test.ts, unreadStore.test.ts) mock the `api`
// module, so they never see the URL and could never have caught this: the 431
// came from llhttp rejecting an oversized request line before any handler ran.
// Anything short of a real socket is blind to it.
// ---------------------------------------------------------------------------

/** Minimal stand-ins — these endpoints only read, so empty stores are enough. */
function makeDeps() {
  return {
    kvStore: {
      listByPrefix: async () => [] as { key: string; value: string }[],
    },
    commentStore: { getByTicketIds: async () => [] },
    deliverableStore: { getByTicketIds: async () => [] },
    agentEventStore: { getAllExecutions: async () => [] },
    mentionStore: { getAll: async () => [] },
    workflowRunStore: { getByStatus: async () => [] },
  } as any;
}

describe('bulk ticket endpoints over real HTTP (#509)', () => {
  let app: FastifyInstance;
  let base: string;
  const ticketIds = Array.from({ length: 1000 }, () => randomUUID());

  beforeAll(async () => {
    app = Fastify({ logger: false, serverFactory: fleexServerFactory });
    registerTicketBulkQueryRoutes(app, makeDeps());
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    if (!addr || typeof addr === 'string') throw new Error('no address');
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /api/tickets/agent-activity handles 1000 ticket IDs', async () => {
    const res = await fetch(`${base}/api/tickets/agent-activity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticketIds }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ticketId: string; activity: string }[];
    // Authoritative response: one entry per requested ID, `idle` included, so
    // the client can drop stale pills instead of leaving them lit forever.
    expect(body).toHaveLength(1000);
    expect(body.map((e) => e.ticketId)).toEqual(ticketIds);
    expect(body.every((e) => e.activity === 'idle')).toBe(true);
  });

  it('POST /api/tickets/unread-counts handles 1000 ticket IDs', async () => {
    const res = await fetch(`${base}/api/tickets/unread-counts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticketIds }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ticketId: string; totalComments: number }[];
    // Every requested ID reports counts, including tickets with no read cursor.
    expect(body).toHaveLength(1000);
    expect(body.map((e) => e.ticketId)).toEqual(ticketIds);
  });

  it('the same 1000 IDs in the query string is what used to 431', async () => {
    // Proves the payload really is oversized, and that the raised maxHeaderSize
    // (AC5) keeps even the legacy GET shape alive rather than dropping the
    // connection. ~37 KB of request line here — over Node's 16 KB default.
    const url = `${base}/api/tickets/agent-activity?ticketIds=${ticketIds.join(',')}`;
    expect(url.length).toBeGreaterThan(32 * 1024);

    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveLength(1000);
  });

  it('GET with a single ID stays supported for the installed CLI', async () => {
    // packages/cli/src/commands/ticket/show/index.ts calls this shape; a CLI
    // binary older than the server must keep working.
    const one = ticketIds[0]!;
    const res = await fetch(
      `${base}/api/tickets/agent-activity?ticketIds=${encodeURIComponent(one)}`,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      expect.objectContaining({ ticketId: one, activity: 'idle' }),
    ]);
  });

  it('survives the CORS preflight the POST switch introduces', async () => {
    // GET with simple headers needed no preflight; POST + application/json
    // does. In `bun run dev` the web app is cross-origin (:5173 → :3000), so a
    // failing OPTIONS would break the fix exactly where it must work.
    const cors = (await import('@fastify/cors')).default;
    const preflighted = Fastify({ logger: false, serverFactory: fleexServerFactory });
    await preflighted.register(cors, { origin: true, credentials: true });
    registerTicketBulkQueryRoutes(preflighted, makeDeps());
    await preflighted.listen({ port: 0, host: '127.0.0.1' });
    const addr = preflighted.server.address();
    if (!addr || typeof addr === 'string') throw new Error('no address');
    const origin = 'http://localhost:5173';

    const res = await fetch(`http://127.0.0.1:${addr.port}/api/tickets/agent-activity`, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });

    expect(res.status).toBeLessThan(300);
    expect(res.headers.get('access-control-allow-origin')).toBe(origin);
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    await preflighted.close();
  });

  it('unread-counts with an empty list falls back to tracked tickets', async () => {
    // Guards the #400 semantics: empty/absent means "tracked tickets only",
    // it must NOT mean "every ticket".
    const res = await fetch(`${base}/api/tickets/unread-counts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticketIds: [] }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});
