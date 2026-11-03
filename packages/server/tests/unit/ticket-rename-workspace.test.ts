import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { RepoPathResolver } from '../../src/domain/services/repo-path-resolver.js';
import { resolveTicketWorkspaceId } from '../../src/domain/services/ticket-workspace-locator.js';
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
 * ticket cleaned the wrong folder. The folder is now found by ticket id.
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

describe('resolveTicketWorkspaceId', () => {
  const write = (dir: string, manifest: unknown) => {
    mkdirSync(join(root, 'workspaces', dir), { recursive: true });
    if (manifest !== undefined) writeFileSync(join(root, 'workspaces', dir, '.fleex.json'), JSON.stringify(manifest));
  };

  it('a ticket with no workspace gets one named after its current title (unchanged)', () => {
    expect(resolveTicketWorkspaceId(resolver, { id: TICKET_ID, title: 'Bar' })).toBe('e32654-bar');
  });

  it('a renamed ticket resolves to the folder it already has', () => {
    write(FOO, { ticketId: TICKET_ID });
    expect(resolveTicketWorkspaceId(resolver, { id: TICKET_ID, title: 'Bar' })).toBe(FOO);
  });

  it('two tickets sharing the 6-char prefix each get their own folder (manifest decides)', () => {
    const other = 'e32654aa-0000-0000-0000-000000000000';
    write('e32654-x', { ticketId: other });
    write('e32654-y', { ticketId: TICKET_ID });
    write('e32654-z', undefined); // no manifest: never claimed
    expect(resolveTicketWorkspaceId(resolver, { id: TICKET_ID, title: 'x' })).toBe('e32654-y');
    expect(resolveTicketWorkspaceId(resolver, { id: other, title: 'y' })).toBe('e32654-x');
  });

  it('several folders of the same ticket: the oldest wins, with a warning', () => {
    write('e32654-b', { ticketId: TICKET_ID });
    write('e32654-a', { ticketId: TICKET_ID });
    const logger = { warn: vi.fn() };
    const chosen = resolveTicketWorkspaceId(resolver, { id: TICKET_ID, title: 'z' }, logger);
    expect(['e32654-a', 'e32654-b']).toContain(chosen);
    expect(logger.warn).toHaveBeenCalledOnce();
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

  it('GET /workspace answers the original folder', async () => {
    const res = await fetch(`${base}/api/tickets/${TICKET_ID}/workspace`);
    expect(await res.json()).toEqual({ workspaceId: FOO, path: join(root, 'workspaces', FOO), exists: true });
  });

  it('POST /ensure-workspace ensures the original folder, not a new one', async () => {
    const res = await fetch(`${base}/api/tickets/${TICKET_ID}/ensure-workspace`, { method: 'POST' });
    expect(await res.json()).toEqual({ workspacePath: join(root, 'workspaces', FOO), workspaceId: FOO });
    expect(workspaces()).toEqual([FOO]);
  });

  it('DELETE removes the original folder and its worktree, leaving nothing behind', async () => {
    const res = await fetch(`${base}/api/tickets/${TICKET_ID}`, { method: 'DELETE' });
    expect(res.status).toBe(204);
    expect(removeWorktree).toHaveBeenCalledWith(resolver.barePath('org', 'app'), join(root, 'workspaces', FOO, 'app'));
    expect(workspaces()).toEqual([]);
  });
});
