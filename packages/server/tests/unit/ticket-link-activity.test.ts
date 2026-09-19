import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { ticketRoutes } from '../../src/infrastructure/http/tickets.routes.js';
import { TicketEntity } from '../../src/domain/entities/ticket.entity.js';
import { FakeLoggerPort } from '../helpers/fakes.js';

/**
 * Detaching a repo wrote an activity carrying only the link's id, while
 * attaching wrote the link itself. The timeline reads the link to name what
 * happened, so a detach resolved to nothing and the row was dropped entirely —
 * three "Repo attached" lines and no "Repo detached" to match them.
 */

const TICKET_ID = 'd1df20f8-fe14-44cb-ae24-76f1b0389274';

let root: string;
let app: FastifyInstance;
let base: string;
let ticket: TicketEntity;
let activities: { action: string; changes: Record<string, unknown> }[];

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'fleex-link-act-'));
  activities = [];
  ticket = TicketEntity.create({
    id: TICKET_ID, boardId: 'b-1', displayId: 588, title: 'test again', status: 'doing',
  });

  const container = {
    ticketStore: {
      getTicketById: async () => ticket,
      saveTicket: async () => {},
      saveActivity: async (a: { toDTO: () => { action: string; changes: Record<string, unknown> } }) => {
        activities.push(a.toDTO());
      },
    },
    resolver: {
      workspacePath: (id: string) => join(root, 'workspaces', id),
      workspaceRepoPath: (id: string, name: string) => join(root, 'workspaces', id, name),
      barePath: (org: string, name: string) => join(root, '.bare', org, `${name}.git`),
    },
    createWorktree: { execute: async () => null },
    git: { getDefaultBranch: async () => 'main', remoteBranchExists: async () => true, listWorktrees: async () => [] },
    repositoryCache: { get: () => undefined },
    githubGraphql: { fetchRepoBatch: async () => new Map() },
    eventBus: { emit: () => {} },
    logger: new FakeLoggerPort(),
    ticketBroadcast: () => {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  app = Fastify({ logger: false });
  await app.register(ticketRoutes(container));
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  base = `http://127.0.0.1:${addr.port}`;
});

afterEach(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

describe('detaching a repo', () => {
  it('records the link that was removed, not just its id', async () => {
    const link = ticket.addLink('repository', 'odys-travel/odys-front', 'odys-travel/odys-front', null, randomUUID());

    const res = await fetch(`${base}/api/tickets/${TICKET_ID}/links/${link.id}`, { method: 'DELETE' });
    expect(res.status).toBe(204);

    const unlinked = activities.find((a) => a.action === 'unlinked');
    expect(unlinked, 'no unlinked activity was written').toBeDefined();
    // What the timeline reads to name the row.
    const change = unlinked!.changes.link as { from?: { type?: string; ref?: string } } | undefined;
    expect(change?.from?.type).toBe('repository');
    expect(change?.from?.ref).toBe('odys-travel/odys-front');
  });

  it('mirrors the shape the attach side writes', async () => {
    const link = ticket.addLink('repository', 'odys-travel/agentic-dmc', 'odys-travel/agentic-dmc', null, randomUUID());
    await fetch(`${base}/api/tickets/${TICKET_ID}/links/${link.id}`, { method: 'DELETE' });

    const unlinked = activities.find((a) => a.action === 'unlinked');
    expect(Object.keys(unlinked!.changes)).toEqual(['link']);
  });
});
