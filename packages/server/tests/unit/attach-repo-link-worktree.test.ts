import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { ticketRoutes } from '../../src/infrastructure/http/tickets.routes.js';
import { TicketEntity } from '../../src/domain/entities/ticket.entity.js';
import { FakeLoggerPort } from '../helpers/fakes.js';

/**
 * Attaching a repo to a ticket derives its worktree. That used to happen only
 * when the ticket's workspace already existed on disk, so attaching a repo to a
 * brand-new ticket stored the link and silently created nothing — not even a
 * log line. Whether it worked depended on some unrelated call having written
 * the workspace manifest first, which is why it looked intermittent.
 */

const TICKET_ID = 'd1df20f8-fe14-44cb-ae24-76f1b0389274';

let root: string;
let app: FastifyInstance;
let base: string;
let ticket: TicketEntity;
let created: { org: string; name: string; wtPath: string }[];

function makeContainer() {
  created = [];
  return {
    ticketStore: {
      getTicketById: async () => ticket,
      saveTicket: async () => {},
      saveActivity: async () => {},
    },
    resolver: {
      workspacePath: (id: string) => join(root, 'workspaces', id),
      workspaceRepoPath: (id: string, name: string) => join(root, 'workspaces', id, name),
      barePath: (org: string, name: string) => join(root, '.bare', org, `${name}.git`),
    },
    createWorktree: {
      execute: async (org: string, name: string, wtPath: string) => {
        created.push({ org, name, wtPath });
        return null;
      },
    },
    git: {
      getDefaultBranch: async () => 'main',
      remoteBranchExists: async () => true,
      listWorktrees: async () => [],
    },
    repositoryCache: { get: () => undefined },
    githubGraphql: { fetchRepoBatch: async () => new Map() },
    eventBus: { emit: () => {} },
    logger: new FakeLoggerPort(),
    ticketBroadcast: () => {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'fleex-attach-'));
  ticket = TicketEntity.create({
    id: TICKET_ID, boardId: 'b-1', displayId: 584, title: 'test', status: 'doing',
  });
  app = Fastify({ logger: false });
  await app.register(ticketRoutes(makeContainer()));
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  base = `http://127.0.0.1:${addr.port}`;
});

afterEach(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

function attach(ref: string) {
  return fetch(`${base}/api/tickets/${TICKET_ID}/links`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'repository', ref, label: ref }),
  });
}

describe('attaching a repository link to a ticket with no workspace yet', () => {
  it('creates the worktree instead of silently storing the link alone', async () => {
    const res = await attach('odys-travel/odys-front');

    expect(res.status).toBe(200);
    expect(created.map((c) => c.name)).toEqual(['odys-front']);
  });

  it('writes the workspace manifest so the worktree resolves back to its ticket', async () => {
    await attach('odys-travel/odys-front');

    const manifest = join(root, 'workspaces', 'd1df20-test', '.fleex.json');
    expect(existsSync(manifest)).toBe(true);
    expect(JSON.parse(readFileSync(manifest, 'utf8'))).toEqual({ ticketId: TICKET_ID });
  });

  it('gives every repo its worktree, whichever order they are attached in', async () => {
    await attach('odys-travel/odys-front');
    await attach('odys-travel/agentic-dmc');
    await attach('odys-travel/agentic-dmc-2');

    expect(created.map((c) => c.name)).toEqual(['odys-front', 'agentic-dmc', 'agentic-dmc-2']);
    expect(ticket.links.filter((l) => l.type === 'worktree')).toHaveLength(3);
  });
});
