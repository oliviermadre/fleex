import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { RepoPathResolver } from '../../src/domain/services/repo-path-resolver.js';
import { ticketBranchName, ticketWorkspaceId } from '@fleex/shared';
import { BackfillTicketNamingUseCase } from '../../src/application/use-cases/backfill-ticket-naming.js';
import { ApplyTicketMutationUseCase } from '../../src/application/use-cases/apply-ticket-mutation.js';
import { TicketEntity } from '../../src/domain/entities/ticket.entity.js';
import { ExecuteAgentUseCase } from '../../src/application/use-cases/execute-agent.js';
import { RunPanelUseCase } from '../../src/application/use-cases/run-panel.js';
import { CreateSessionFromTicketUseCase } from '../../src/application/use-cases/create-session-from-ticket.js';
import { ticketRoutes } from '../../src/infrastructure/http/tickets.routes.js';
import { worktreeDiffRoutes } from '../../src/infrastructure/http/worktree-diff.routes.js';
import { FakeLoggerPort } from '../helpers/fakes.js';

/**
 * A ticket has one technical name, fixed at creation: folder `<n>-<slug>`,
 * branch `fleex/<n>-<slug>` on every linked repo — `n` its display id, `slug`
 * its title at creation, locked.
 *
 * It used to be re-derived from the *current* title on every call: after a
 * rename the next run/session/panel got a fresh empty folder, the worktree add
 * failed (branch already checked out in the old folder), a new branch was
 * minted and the work in progress was orphaned — and deleting the ticket
 * cleaned the wrong folder. An agent run and a session also named the branch
 * differently (`agent/<n>-…` vs `ticket/<id6>-…`).
 *
 * Tickets that already had a folder or a branch under that former naming keep
 * it (tmux sessions, Claude session resume and open PRs depend on it): the
 * boot backfill records it in `workspaceDir` / `branchName`.
 */

const TICKET_ID = 'e3265423-0182-483e-81cd-62fdb54841e9';
const FOO = '654-foo';
const FOO_BRANCH = 'fleex/654-foo';

let root: string;
let resolver: RepoPathResolver;
let ticket: TicketEntity;
let worktreeCalls: { name: string; wtPath: string; branch: string; createNewBranch: boolean }[];

/** A createWorktree that materialises the checkout, like git would. */
const createWorktree = {
  execute: async (_org: string, name: string, wtPath: string, req: { branch: string; createNewBranch: boolean }) => {
    worktreeCalls.push({ name, wtPath, branch: req.branch, createNewBranch: req.createNewBranch });
    mkdirSync(wtPath, { recursive: true });
    return null;
  },
};
const ticketStore = {
  getTicketById: async (id: string) => (id === TICKET_ID ? ticket : null),
  getTicketsWithoutSlug: async () => (ticket.lockedSlug === null ? [ticket] : []),
  saveTicket: vi.fn(async () => {}),
  saveActivity: async () => {},
  removeTicket: async () => {},
};

const workspaces = () => readdirSync(join(root, 'workspaces')).sort();

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fleex-rename-'));
  resolver = new RepoPathResolver(root);
  mkdirSync(resolver.barePath('org', 'app'), { recursive: true });
  mkdirSync(resolver.barePath('org', 'api'), { recursive: true });
  worktreeCalls = [];
  ticketStore.saveTicket.mockClear();
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

describe('naming: `<n>-<slug>` / `fleex/<n>-<slug>`, fixed at creation', () => {
  it('a rename changes the title, never the folder or the branch', () => {
    expect(ticketWorkspaceId(ticket)).toBe(FOO);
    expect(ticketBranchName(ticket)).toBe(FOO_BRANCH);
    ticket.update({ title: 'Bar' });
    expect(ticket.title).toBe('Bar');
    expect(ticketWorkspaceId(ticket)).toBe(FOO);
    expect(ticketBranchName(ticket)).toBe(FOO_BRANCH);
    expect(ticket.toDTO()).toMatchObject({ slug: 'foo', workspaceDir: null, branchName: null });
  });

  it('a ticket not inserted yet (display id 0) has no name: computing one throws instead of making a `0-foo` folder', () => {
    const draft = TicketEntity.create({ id: TICKET_ID, boardId: 'b1', displayId: 0, title: 'Foo' });
    expect(() => ticketWorkspaceId(draft)).toThrow(/display id/);
    expect(() => ticketBranchName(draft)).toThrow(/display id/);
  });

  it('a legacy row (no stored slug) derives it from its title, and locks it before its first rename', () => {
    ticket.lockedSlug = null; // as read from a row created before slugs were stored
    expect(ticket.slug).toBe('foo');
    ticket.update({ title: 'Bar' });
    expect(ticket.lockedSlug).toBe('foo');
    expect(ticketWorkspaceId(ticket)).toBe(FOO);
  });

  it('no write path takes the slug or the overrides', () => {
    ticket.update({ title: 'Bar', slug: 'x', workspaceDir: 'y', branchName: 'z' } as never);
    expect(ticket.toDTO()).toMatchObject({ title: 'Bar', slug: 'foo', workspaceDir: null, branchName: null });
  });
});

describe('BackfillTicketNamingUseCase: tickets from before the naming was stored', () => {
  const OLD = 'e32654-old';
  const write = (dir: string, manifest: unknown) => {
    mkdirSync(join(root, 'workspaces', dir), { recursive: true });
    if (manifest !== undefined) writeFileSync(join(root, 'workspaces', dir, '.fleex.json'), JSON.stringify(manifest));
  };
  const backfill = (logger = new FakeLoggerPort()) => new BackfillTicketNamingUseCase(ticketStore as never, resolver, logger).execute();

  beforeEach(() => {
    // Created as "Old", renamed "Foo" by an older version: the row has no slug.
    ticket = TicketEntity.create({ id: TICKET_ID, boardId: 'b1', displayId: 654, title: 'Old', status: 'doing' });
    ticket.addLink('repository', 'org/app', 'org/app', null, 'l-repo');
    ticket.update({ title: 'Foo' });
    ticket.lockedSlug = null;
  });

  it('a folder and a worktree link: keeps both, no new folder', async () => {
    write(OLD, { ticketId: TICKET_ID });
    ticket.addLink('worktree', join(root, 'workspaces', OLD, 'app'), `ticket/${OLD}`, null, 'l-wt');
    expect(await backfill()).toEqual({ locked: 1, kept: 1 });
    expect(ticket.slug).toBe('old');
    expect(ticketWorkspaceId(ticket)).toBe(OLD);
    expect(ticketBranchName(ticket)).toBe(`ticket/${OLD}`);
    expect(ticketStore.saveTicket).toHaveBeenCalledOnce();

    // …and the next agent run works in it, on its branch.
    await makeAgent()(TICKET_ID);
    expect(workspaces()).toEqual([OLD]);
  });

  it('a folder and no link: keeps the folder and the `ticket/<folder>` branch it was created with', async () => {
    write(OLD, { ticketId: TICKET_ID });
    await backfill();
    expect(ticketWorkspaceId(ticket)).toBe(OLD);
    expect(ticketBranchName(ticket)).toBe(`ticket/${OLD}`);
  });

  it('a link from an agent run and no folder here: keeps the `agent/` branch, the folder takes the new format', async () => {
    ticket.addLink('worktree', '/elsewhere/workspaces/e32654-old/app', 'agent/654-old', null, 'l-wt');
    await backfill();
    expect(ticketBranchName(ticket)).toBe('agent/654-old');
    expect(ticketWorkspaceId(ticket)).toBe('654-foo');
  });

  it('an `org/repo:branch` link (PR backfill) gives its branch', async () => {
    ticket.addLink('worktree', 'org/app:feature/x', 'feature/x', null, 'l-wt');
    await backfill();
    expect(ticketBranchName(ticket)).toBe('feature/x');
  });

  it('neither folder nor link (never started): moves to the new format, slug from its current title', async () => {
    expect(await backfill()).toEqual({ locked: 1, kept: 0 });
    expect(ticket.lockedSlug).toBe('foo');
    expect(ticketWorkspaceId(ticket)).toBe(FOO);
    expect(ticketBranchName(ticket)).toBe(FOO_BRANCH);
  });

  it('is idempotent: a second run changes nothing', async () => {
    write(OLD, { ticketId: TICKET_ID });
    await backfill();
    ticketStore.saveTicket.mockClear();
    expect(await backfill()).toEqual({ locked: 0, kept: 0 });
    expect(ticketStore.saveTicket).not.toHaveBeenCalled();
    expect(ticketWorkspaceId(ticket)).toBe(OLD);
  });

  it('never touches a slug already stored', async () => {
    write(OLD, { ticketId: TICKET_ID });
    ticket.lockedSlug = 'kept';
    expect(await backfill()).toEqual({ locked: 0, kept: 0 });
    expect(ticket.workspaceDir).toBeNull();
  });

  it('a folder of another ticket sharing the 6-char prefix, or with no manifest, is ignored', async () => {
    write('e32654-x', { ticketId: 'e32654aa-0000-0000-0000-000000000000' });
    write('e32654-y', undefined);
    await backfill();
    expect(ticket.workspaceDir).toBeNull();
    expect(ticketWorkspaceId(ticket)).toBe(FOO);
  });

  it('two folders for one ticket (a rename opened a second one): the oldest, with a warning', async () => {
    write(OLD, { ticketId: TICKET_ID });
    await new Promise((r) => setTimeout(r, 20));
    write('e32654-foo', { ticketId: TICKET_ID });
    const logger = new FakeLoggerPort();
    const warn = vi.spyOn(logger, 'warn');
    await backfill(logger);
    expect(ticketWorkspaceId(ticket)).toBe(OLD);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('no workspaces root yet: still locks the slug', async () => {
    expect(await backfill()).toEqual({ locked: 1, kept: 0 });
  });
});

describe('a new ticket gets one branch, whoever derives it first', () => {
  it('agent run first: `fleex/<n>-<slug>`, not `agent/…`', async () => {
    await makeAgent()(TICKET_ID);
    expect(worktreeCalls).toEqual([expect.objectContaining({ branch: FOO_BRANCH, createNewBranch: true })]);
    expect(workspaces()).toEqual([FOO]);
  });

  it('panel run first: the same', async () => {
    await makePanel()(TICKET_ID);
    expect(worktreeCalls).toEqual([expect.objectContaining({ branch: FOO_BRANCH, createNewBranch: true })]);
  });

  it('session first: the same, and the session is named after the display id', async () => {
    const { run, createSession } = makeSession();
    await run();
    expect(worktreeCalls).toEqual([expect.objectContaining({ branch: FOO_BRANCH, createNewBranch: true })]);
    expect(createSession.execute).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'ticket-654-session' }));
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
    const eventBus = { emit: () => {} };
    const container = {
      ticketStore,
      resolver,
      logger: new FakeLoggerPort(),
      eventBus,
      applyTicketMutation: new ApplyTicketMutationUseCase(ticketStore as never, eventBus as never),
      ticketBroadcast: () => {},
      commentStore: { getByTicket: async () => [] },
      fileStore: { remove: async () => {} },
      fileMetaStore: { remove: async () => {} },
      sessionStore: { getAll: async () => [] },
      killSession: { execute: async () => {} },
      createWorktree,
      repositoryCache: { get: () => undefined },
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

  it('a repo attached after the rename gets the same branch as the first one', async () => {
    const res = await fetch(`${base}/api/tickets/${TICKET_ID}/links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'repository', ref: 'org/api', label: 'org/api' }),
    });
    expect(res.status).toBeLessThan(300);
    expect(worktreeCalls.map((c) => [c.name, c.branch])).toEqual([['app', FOO_BRANCH], ['api', FOO_BRANCH]]);
    expect(workspaces()).toEqual([FOO]);
  });

  it('PATCH ignores the slug and the overrides', async () => {
    const res = await fetch(`${base}/api/tickets/${TICKET_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'x', workspaceDir: '../../etc', branchName: 'main' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ slug: 'foo', workspaceDir: null, branchName: null });
  });

  it('DELETE removes the original folder and its worktree, leaving nothing behind', async () => {
    const res = await fetch(`${base}/api/tickets/${TICKET_ID}`, { method: 'DELETE' });
    expect(res.status).toBe(204);
    expect(removeWorktree).toHaveBeenCalledWith(resolver.barePath('org', 'app'), join(root, 'workspaces', FOO, 'app'));
    expect(workspaces()).toEqual([]);
  });
});
