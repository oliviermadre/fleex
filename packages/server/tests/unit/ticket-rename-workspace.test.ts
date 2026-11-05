import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { RepoPathResolver } from '../../src/domain/services/repo-path-resolver.js';
import { ticketBranchName, ticketWorkspaceId } from '@fleex/shared';
import { BackfillTicketSlugsUseCase } from '../../src/application/use-cases/backfill-ticket-slugs.js';
import { TicketEntity } from '../../src/domain/entities/ticket.entity.js';
import { ExecuteAgentUseCase } from '../../src/application/use-cases/execute-agent.js';
import { RunPanelUseCase } from '../../src/application/use-cases/run-panel.js';
import { CreateSessionFromTicketUseCase } from '../../src/application/use-cases/create-session-from-ticket.js';
import { ticketRoutes } from '../../src/infrastructure/http/tickets.routes.js';
import { worktreeDiffRoutes } from '../../src/infrastructure/http/worktree-diff.routes.js';
import { FakeLoggerPort } from '../helpers/fakes.js';

/**
 * Renaming a ticket must not move its work.
 *
 * The workspace folder is named `<id6>-<slug(title)>` from the title it had when
 * it was created. It used to be re-derived from the *current* title on every
 * call: after a rename the next run/session/panel got a fresh empty folder, the
 * worktree add failed (branch already checked out in the old folder), a new
 * branch was minted and the work in progress was orphaned — and deleting the
 * ticket cleaned the wrong folder. Branch-level actions (base branch change,
 * repo attached later) derived the branch from the new title too.
 *
 * The ticket now stores a slug, locked at creation: folder and branch derive
 * from it, the title is display only.
 */

const TICKET_ID = 'e3265423-0182-483e-81cd-62fdb54841e9';
const FOO = 'e32654-foo';

let root: string;
let resolver: RepoPathResolver;
let ticket: TicketEntity;
let worktreeCalls: { wtPath: string; branch: string; createNewBranch: boolean }[];

/** A createWorktree that materialises the checkout, like git would. */
const createWorktree = {
  execute: async (_org: string, _name: string, wtPath: string, req: { branch: string; createNewBranch: boolean }) => {
    worktreeCalls.push({ wtPath, branch: req.branch, createNewBranch: req.createNewBranch });
    mkdirSync(wtPath, { recursive: true });
    return null;
  },
};
const ticketStore = {
  getTicketById: async (id: string) => (id === TICKET_ID ? ticket : null),
  saveTicket: async () => {},
  saveActivity: async () => {},
  removeTicket: async () => {},
};

const workspaces = () => readdirSync(join(root, 'workspaces')).sort();

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fleex-rename-'));
  resolver = new RepoPathResolver(root);
  mkdirSync(resolver.barePath('org', 'app'), { recursive: true });
  worktreeCalls = [];
  ticket = TicketEntity.create({ id: TICKET_ID, boardId: 'b1', displayId: 654, title: 'Foo', status: 'doing' });
  ticket.addLink('repository', 'org/app', 'org/app', null, 'l-repo');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function makeAgent() {
  const stub = {} as never;
  const uc = new ExecuteAgentUseCase(
    stub, stub, stub, stub, stub, stub, stub, ticketStore as never, createWorktree as never,
    { get: () => ({}) } as never, new FakeLoggerPort(), stub, stub,
  );
  uc.resolver = resolver;
  return (uc as unknown as { ensureWorkspace(id: string): Promise<string | null> }).ensureWorkspace.bind(uc);
}

function makePanel() {
  const stub = {} as never;
  const uc = new RunPanelUseCase(
    stub, stub, stub, ticketStore as never, stub, stub, stub, createWorktree as never, stub,
    { get: () => ({}) } as never, new FakeLoggerPort(), stub,
  );
  uc.resolver = resolver;
  return (uc as unknown as { ensureWorktree(id: string): Promise<string | null> }).ensureWorktree.bind(uc);
}

function makeSession() {
  const createSession = { execute: vi.fn(async (req: { cwd: string }) => ({ id: 's1', tmuxName: 'fleex_shell_t', cwd: req.cwd })) };
  const uc = new CreateSessionFromTicketUseCase(
    ticketStore as never, createSession as never, createWorktree as never,
    {} as never, {} as never, new FakeLoggerPort(), resolver,
  );
  return { run: () => uc.execute(TICKET_ID), createSession };
}

describe('the slug is locked at creation', () => {
  it('a rename changes the title, never the folder or the branch', () => {
    expect(ticket.slug).toBe('foo');
    ticket.update({ title: 'Bar' });
    expect(ticket.title).toBe('Bar');
    expect(ticketWorkspaceId(ticket)).toBe(FOO);
    expect(ticketBranchName(ticket)).toBe(`ticket/${FOO}`);
    expect(ticket.toDTO().slug).toBe('foo');
  });

  it('a legacy row (no stored slug) derives it from its title, and locks it before its first rename', () => {
    ticket.lockedSlug = null; // as read from a row created before slugs were stored
    expect(ticket.slug).toBe('foo');
    ticket.update({ title: 'Bar' });
    expect(ticket.lockedSlug).toBe('foo');
    expect(ticketWorkspaceId(ticket)).toBe(FOO);
  });

  it('a 40-char cut ending on "-" is kept as is: existing folders and branches were named that way', () => {
    const t = TicketEntity.create({ id: TICKET_ID, boardId: 'b1', displayId: 1, title: `${'a'.repeat(39)} bcd` });
    expect(t.slug).toBe(`${'a'.repeat(39)}-`);
    expect(ticketWorkspaceId(t)).toBe(`e32654-${'a'.repeat(39)}-`);
  });
});

describe('BackfillTicketSlugsUseCase: tickets renamed before slugs were stored', () => {
  const write = (dir: string, manifest: unknown) => {
    mkdirSync(join(root, 'workspaces', dir), { recursive: true });
    if (manifest !== undefined) writeFileSync(join(root, 'workspaces', dir, '.fleex.json'), JSON.stringify(manifest));
  };
  const backfill = (logger = new FakeLoggerPort()) => new BackfillTicketSlugsUseCase(ticketStore as never, resolver, logger).execute();

  beforeEach(() => {
    // Created as "Foo", renamed "Bar" by an older version: the row has no slug.
    ticket.update({ title: 'Bar' });
    ticket.lockedSlug = null;
  });

  it('locks the slug from the folder the ticket already has', async () => {
    write(FOO, { ticketId: TICKET_ID });
    expect(await backfill()).toEqual({ locked: 1 });
    expect(ticketWorkspaceId(ticket)).toBe(FOO);
    expect(ticketBranchName(ticket)).toBe(`ticket/${FOO}`);
  });

  it('never touches a slug already stored', async () => {
    write(FOO, { ticketId: TICKET_ID });
    ticket.lockedSlug = 'kept';
    expect(await backfill()).toEqual({ locked: 0 });
    expect(ticket.slug).toBe('kept');
  });

  it('a folder of another ticket sharing the 6-char prefix, or with no manifest, is ignored', async () => {
    write('e32654-x', { ticketId: 'e32654aa-0000-0000-0000-000000000000' });
    write('e32654-y', undefined);
    expect(await backfill()).toEqual({ locked: 0 });
    expect(ticket.lockedSlug).toBeNull();
  });

  it('two folders for one ticket (a rename opened a second one): the oldest, with a warning', async () => {
    write(FOO, { ticketId: TICKET_ID });
    await new Promise((r) => setTimeout(r, 20));
    write('e32654-bar', { ticketId: TICKET_ID });
    const logger = new FakeLoggerPort();
    const warn = vi.spyOn(logger, 'warn');
    await backfill(logger);
    expect(ticket.slug).toBe('foo');
    expect(warn).toHaveBeenCalledOnce();
  });

  it('no workspaces root yet: nothing to do', async () => {
    expect(await backfill()).toEqual({ locked: 0 });
  });
});

describe('rename, then work again on the ticket', () => {
  it('agent run: same folder, no new folder, no new branch', async () => {
    const ensureWorkspace = makeAgent();
    expect(await ensureWorkspace(TICKET_ID)).toBe(join(root, 'workspaces', FOO));
    expect(worktreeCalls).toHaveLength(1);

    ticket.update({ title: 'Bar' });
    expect(await ensureWorkspace(TICKET_ID)).toBe(join(root, 'workspaces', FOO));
    expect(workspaces()).toEqual([FOO]);
    expect(worktreeCalls).toHaveLength(1); // the existing checkout is reused, no branch minted
  });

  it('panel run: same worktree', async () => {
    const ensureWorktree = makePanel();
    const first = await ensureWorktree(TICKET_ID);
    ticket.update({ title: 'Bar' });
    expect(await ensureWorktree(TICKET_ID)).toBe(first);
    expect(first).toContain(FOO);
    expect(workspaces()).toEqual([FOO]);
    expect(worktreeCalls).toHaveLength(1);
  });

  it('session: opens in the same folder', async () => {
    const { run, createSession } = makeSession();
    await run();
    ticket.update({ title: 'Bar' });
    await run();
    const cwds = createSession.execute.mock.calls.map((c) => c[0].cwd);
    expect(cwds[1]).toBe(cwds[0]);
    expect(cwds[0]).toContain(FOO);
    expect(workspaces()).toEqual([FOO]);
    expect(worktreeCalls).toHaveLength(1);
  });
});

describe('routes after a rename', () => {
  let app: FastifyInstance;
  let base: string;
  const removeWorktree = vi.fn(async () => {});

  beforeEach(async () => {
    // The ticket's workspace exists under its original title, with a checkout.
    await makeAgent()(TICKET_ID);
    ticket.update({ title: 'Bar' });
    const container = {
      ticketStore,
      resolver,
      logger: new FakeLoggerPort(),
      eventBus: { emit: () => {} },
      ticketBroadcast: () => {},
      commentStore: { getByTicket: async () => [] },
      fileStore: { remove: async () => {} },
      fileMetaStore: { remove: async () => {} },
      sessionStore: { getAll: async () => [] },
      killSession: { execute: async () => {} },
      git: { listWorktrees: async () => [], removeWorktree },
      hostFs: { exists: async (p: string) => existsSync(p) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    app = Fastify({ logger: false });
    await app.register(ticketRoutes(container));
    await app.register(worktreeDiffRoutes(container));
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    if (!addr || typeof addr === 'string') throw new Error('no address');
    base = `http://127.0.0.1:${addr.port}`;
  });
  afterEach(async () => {
    removeWorktree.mockClear();
    await app.close();
  });

  it('POST /ensure-workspace ensures the original folder, not a new one', async () => {
    const res = await fetch(`${base}/api/tickets/${TICKET_ID}/ensure-workspace`, { method: 'POST' });
    expect(await res.json()).toEqual({ workspacePath: join(root, 'workspaces', FOO) });
    expect(workspaces()).toEqual([FOO]);
  });

  it('DELETE removes the original folder and its worktree, leaving nothing behind', async () => {
    const res = await fetch(`${base}/api/tickets/${TICKET_ID}`, { method: 'DELETE' });
    expect(res.status).toBe(204);
    expect(removeWorktree).toHaveBeenCalledWith(resolver.barePath('org', 'app'), join(root, 'workspaces', FOO, 'app'));
    expect(workspaces()).toEqual([]);
  });
});
