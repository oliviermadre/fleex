import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CreateSessionFromTicketUseCase } from '../../src/application/use-cases/create-session-from-ticket.js';
import { TicketEntity } from '../../src/domain/entities/ticket.entity.js';
import { FakeLoggerPort } from '../helpers/fakes.js';

/**
 * Opening a session derives a worktree per linked repo. They share ONE ticket
 * branch, but that branch only exists in the repos whose worktree was already
 * made — so a repo still missing one must have it created, not checked out.
 * Deciding that once for the whole ticket asked the stragglers to check out a
 * branch that lives only in their siblings: `fatal: invalid reference`.
 */

const TICKET_ID = 'd1df20f8-fe14-44cb-ae24-76f1b0389274';
const BRANCH = 'ticket/d1df20-test';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fleex-cwft-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

interface CreateCall {
  name: string;
  branch: string;
  createNewBranch: boolean;
  baseBranch?: string;
}

/**
 * A ticket linked to `repos`. `withWorktree` repos are the ones already derived:
 * they carry a worktree link AND their directory sits on disk, the way a repo
 * attached earlier does.
 */
function harness(repos: string[], withWorktree: string[]) {
  const ticket = TicketEntity.create({
    id: TICKET_ID, boardId: 'b-1', displayId: 584, title: 'test', status: 'doing',
  });
  for (const name of repos) {
    ticket.addLink('repository', `odys-travel/${name}`, `odys-travel/${name}`, null, randomUUID());
  }
  const workspaceId = 'd1df20-test';
  for (const name of withWorktree) {
    const wtPath = join(root, 'workspaces', workspaceId, name);
    mkdirSync(wtPath, { recursive: true });
    ticket.addLink('worktree', wtPath, BRANCH, null, randomUUID());
  }

  const calls: CreateCall[] = [];
  const createWorktree = {
    execute: async (
      _org: string,
      name: string,
      _wtPath: string,
      req: { branch: string; createNewBranch: boolean; baseBranch?: string },
    ) => {
      calls.push({ name, branch: req.branch, createNewBranch: req.createNewBranch, ...(req.baseBranch ? { baseBranch: req.baseBranch } : {}) });
      // Stands in for git: checking out a branch that was never created in this
      // repo is exactly the `fatal: invalid reference` the logs recorded.
      if (!req.createNewBranch && !withWorktree.includes(name)) {
        throw new Error(`Failed to create worktree: fatal: invalid reference: ${req.branch}`);
      }
      return null;
    },
  };

  const ticketStore = {
    getTicketById: async () => ticket,
    saveTicket: async () => {},
    saveActivity: async () => {},
  };
  const createSession = {
    execute: async () => ({ id: 'sess-1', tmuxName: 'fleex_shell_test' }),
  };
  const resolver = {
    workspacePath: (id: string) => join(root, 'workspaces', id),
    workspaceRepoPath: (id: string, name: string) => join(root, 'workspaces', id, name),
    barePath: (org: string, name: string) => join(root, '.bare', org, `${name}.git`),
  };

  const uc = new CreateSessionFromTicketUseCase(
    ticketStore as never,
    createSession as never,
    createWorktree as never,
    {} as never,
    {} as never,
    new FakeLoggerPort(),
    resolver as never,
  );
  return { uc, calls, ticket };
}

describe('CreateSessionFromTicketUseCase — worktree per repo', () => {
  it('creates the branch in a repo that has no worktree yet, even when a sibling already has one', async () => {
    const h = harness(['odys-front', 'agentic-dmc', 'agentic-dmc-2'], ['agentic-dmc', 'agentic-dmc-2']);

    await h.uc.execute(TICKET_ID);

    const front = h.calls.find((c) => c.name === 'odys-front');
    expect(front, 'odys-front was never attempted').toBeDefined();
    expect(front!.createNewBranch, 'odys-front must mint the ticket branch, not check it out').toBe(true);
  });

  it('gives every linked repo a worktree link', async () => {
    const h = harness(['odys-front', 'agentic-dmc', 'agentic-dmc-2'], ['agentic-dmc', 'agentic-dmc-2']);

    await h.uc.execute(TICKET_ID);

    const wtNames = h.ticket.links
      .filter((l) => l.type === 'worktree')
      .map((l) => l.ref.split('/').pop());
    expect(new Set(wtNames)).toEqual(new Set(['odys-front', 'agentic-dmc', 'agentic-dmc-2']));
  });

  it('keeps one worktree link per repo instead of dropping the same one repeatedly', async () => {
    const h = harness(['odys-front', 'agentic-dmc', 'agentic-dmc-2'], ['agentic-dmc', 'agentic-dmc-2']);

    await h.uc.execute(TICKET_ID);

    const wtLinks = h.ticket.links.filter((l) => l.type === 'worktree');
    expect(wtLinks).toHaveLength(3);
  });

  it('mints the branch for every repo when the ticket has no worktree at all', async () => {
    const h = harness(['odys-front', 'agentic-dmc'], []);

    await h.uc.execute(TICKET_ID);

    expect(h.calls.map((c) => c.createNewBranch)).toEqual([true, true]);
  });
});

/**
 * Opening a shell is not the moment to re-derive what is already there. Handing
 * an existing path to create-worktree costs a failed `git worktree add`, a
 * repair, a prune and a second failed add — about a second and a half per repo,
 * which is the whole wait before the tab shows up.
 */
describe('CreateSessionFromTicketUseCase — worktrees already on disk', () => {
  it('leaves git alone for a repo whose worktree is already there', async () => {
    const h = harness(['agentic-dmc', 'agentic-dmc-2'], ['agentic-dmc', 'agentic-dmc-2']);

    await h.uc.execute(TICKET_ID);

    expect(h.calls).toEqual([]);
  });

  it('still derives the repo that is missing one', async () => {
    const h = harness(['odys-front', 'agentic-dmc', 'agentic-dmc-2'], ['agentic-dmc', 'agentic-dmc-2']);

    await h.uc.execute(TICKET_ID);

    expect(h.calls.map((c) => c.name)).toEqual(['odys-front']);
  });

  it('keeps the worktree link of a repo it skips', async () => {
    const h = harness(['agentic-dmc', 'agentic-dmc-2'], ['agentic-dmc', 'agentic-dmc-2']);

    await h.uc.execute(TICKET_ID);

    expect(h.ticket.links.filter((l) => l.type === 'worktree')).toHaveLength(2);
  });

  it('links a worktree that exists on disk but was never linked', async () => {
    const h = harness(['agentic-dmc'], []);
    mkdirSync(join(root, 'workspaces', 'd1df20-test', 'agentic-dmc'), { recursive: true });

    await h.uc.execute(TICKET_ID);

    expect(h.calls).toEqual([]);
    const wt = h.ticket.links.filter((l) => l.type === 'worktree');
    expect(wt).toHaveLength(1);
    expect(wt[0]!.ref).toBe(join(root, 'workspaces', 'd1df20-test', 'agentic-dmc'));
  });
});
