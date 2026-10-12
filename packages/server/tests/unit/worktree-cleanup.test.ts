/**
 * `fleex worktree cleanup` against REAL git: an origin, bare clones under
 * `<base>/.bare`, and ticket workspaces holding real worktrees — one workspace
 * per guard. Git is the thing these guards protect us from getting wrong (a
 * squash-merged branch, an overlay file, a commit only this disk has), so it is
 * not faked. tmux / lsof / GitHub are, through their ports.
 *
 * The invariant every test leans on: a worktree holding anything that exists
 * nowhere else is never deleted, and the report says why.
 */
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as fsp from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { WorktreeCleanupReport, WorktreeCleanupWorktree } from '@fleex/shared';
import { TicketEntity } from '../../src/domain/entities/ticket.entity.js';
import type { TicketActivityEntity } from '../../src/domain/entities/ticket-activity.entity.js';
import { RepoPathResolver } from '../../src/domain/services/repo-path-resolver.js';
import { GitCliAdapter } from '../../src/infrastructure/adapters/git-cli.adapter.js';
import type { ExecFn, HostFs } from '../../src/infrastructure/host/types.js';
import type { TicketStorePort } from '../../src/application/ports/ticket-store.port.js';
import type { WorkspaceActivityProbe } from '../../src/application/ports/workspace-activity-probe.port.js';
import {
  CleanupInProgressError,
  WorktreeCleanupUseCase,
  type WorktreeCleanupOptions,
} from '../../src/application/use-cases/worktree-cleanup.js';
import { FakeLoggerPort } from '../helpers/fakes.js';

// ── Host adapters: the real thing, locally ──────────────────────────────────

const execFn: ExecFn = (command, args, options) =>
  new Promise((resolve, reject) => {
    execFile(command, args, { cwd: options?.cwd, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(new Error(stderr || err.message), { stdout, stderr }));
      else resolve({ stdout, stderr });
    });
  });

const hostFs: HostFs = {
  readFile: (p) => fsp.readFile(p, 'utf8'),
  writeFile: (p, c) => fsp.writeFile(p, c),
  appendFile: (p, c) => fsp.appendFile(p, c),
  readdir: async (p) => (await fsp.readdir(p, { withFileTypes: true })).map((e) => ({ name: e.name, isFile: e.isFile(), isDirectory: e.isDirectory() })),
  stat: async (p) => { try { const s = await fsp.stat(p); return { size: s.size, mtimeMs: s.mtimeMs }; } catch { return null; } },
  exists: async (p) => existsSync(p),
  mkdir: async (p) => { await fsp.mkdir(p, { recursive: true }); },
  rm: (p, o) => fsp.rm(p, { recursive: o?.recursive, force: true }),
  readTail: async () => '',
};

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

// ── Fakes for the ports that are not git ────────────────────────────────────

/** Hands out copies, like a database: an unsaved mutation must not leak into the store. */
function copy(t: TicketEntity): TicketEntity {
  return Object.assign(Object.create(Object.getPrototypeOf(t)) as TicketEntity, t, { links: t.links.map((l) => ({ ...l })) });
}

class MemoryTicketStore {
  tickets = new Map<string, TicketEntity>();
  activities: TicketActivityEntity[] = [];
  failNextSave = false;
  async getTicketById(id: string) { const t = this.tickets.get(id); return t ? copy(t) : null; }
  async getTicketByDisplayId(n: number) { const t = [...this.tickets.values()].find((x) => x.displayId === n); return t ? copy(t) : null; }
  async getAllTickets() { return [...this.tickets.values()].map(copy); }
  async saveTicket(t: TicketEntity) {
    if (this.failNextSave) { this.failNextSave = false; throw new Error('database unavailable'); }
    this.tickets.set(t.id, copy(t));
  }
  async saveActivity(a: TicketActivityEntity) { this.activities.push(a); }
}

class FakeProbe implements WorkspaceActivityProbe {
  panes: string[] = [];
  processes: { pid: number; command?: string; cwd: string }[] = [];
  processError: Error | null = null;
  /** Panes that appear only after the N-th call (a session opened mid-run). */
  latePanes: { afterCall: number; path: string }[] = [];
  private calls = 0;
  async panePaths() {
    this.calls++;
    return [...this.panes, ...this.latePanes.filter((l) => this.calls > l.afterCall).map((l) => l.path)];
  }
  async processCwds() {
    if (this.processError) throw this.processError;
    return this.processes;
  }
}

// ── Fixture ─────────────────────────────────────────────────────────────────

const DAY = 86_400_000;
const NOW = new Date('2026-10-12T12:00:00Z');

let root: string;
let base: string;
let remotes: string;
let resolver: RepoPathResolver;
let store: MemoryTicketStore;
let probe: FakeProbe;
let prStates: Map<string, string>;
let failingFetch: Set<string>;
let events: { type: string }[];
let displayId = 100;

function originOf(repo: string) { return join(remotes, `${repo}.git`); }
function bareOf(repo: string) { const [o, n] = repo.split('/'); return resolver.barePath(o!, n!); }

/** An origin with a `main`, and our bare clone of it, configured like BareCloneManager does. */
function createRepo(repo: string): void {
  const origin = originOf(repo);
  mkdirSync(origin, { recursive: true });
  git(origin, 'init', '--bare', '-b', 'main');
  const seed = mkdtempSync(join(root, 'seed-'));
  git(seed, 'init', '-b', 'main');
  writeFileSync(join(seed, 'README.md'), 'hello\n');
  writeFileSync(join(seed, '.gitignore'), 'node_modules/\n');
  git(seed, 'add', '.');
  git(seed, 'commit', '-m', 'init');
  git(seed, 'push', origin, 'main');
  const bare = bareOf(repo);
  mkdirSync(join(bare, '..'), { recursive: true });
  git(root, 'clone', '--bare', origin, bare);
  git(bare, 'config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*');
  git(bare, 'fetch', '--prune', 'origin');
  git(bare, 'remote', 'set-head', 'origin', 'main');
}

interface TicketSpec {
  status?: 'done' | 'cancelled' | 'doing';
  closedDaysAgo?: number;
  prs?: number[];
  repo?: string;
}

function makeTicket(slug: string, spec: TicketSpec = {}): { ticket: TicketEntity; ws: string } {
  const id = `${slug}-0000-0000-0000-000000000000`;
  const ticket = TicketEntity.create({ id, boardId: 'b', displayId: ++displayId, title: slug, status: spec.status ?? 'done' });
  ticket.statusChangedAt = new Date(NOW.getTime() - (spec.closedDaysAgo ?? 30) * DAY);
  for (const n of spec.prs ?? []) ticket.addLink('github_pr', `${spec.repo ?? 'acme/app'}#${n}`, `#${n}`, null, `pr-${slug}-${n}`);
  store.tickets.set(id, ticket);
  const ws = join(resolver.workspacesRoot(), `${id.slice(0, 6)}-${slug}`);
  mkdirSync(ws, { recursive: true });
  writeFileSync(join(ws, '.fleex.json'), JSON.stringify({ ticketId: id }, null, 2));
  return { ticket, ws };
}

/** A worktree of `repo` in the ticket's workspace, on a fresh branch off origin/main, linked by path. */
function addWorktree(ticket: TicketEntity, ws: string, opts: { repo?: string; dir?: string; branch?: string } = {}): { path: string; branch: string } {
  const repo = opts.repo ?? 'acme/app';
  const path = join(ws, opts.dir ?? repo.split('/')[1]!);
  const branch = opts.branch ?? `ticket/${ticket.displayId}-${opts.dir ?? 'wt'}`;
  git(bareOf(repo), 'worktree', 'add', '--no-track', '-b', branch, path, 'origin/main');
  ticket.addLink('worktree', path, branch, null, `wt-${ticket.id}-${opts.dir ?? 'wt'}`);
  return { path, branch };
}

function commit(path: string, file: string, content = `${file}\n`): void {
  writeFileSync(join(path, file), content);
  git(path, 'add', file);
  git(path, 'commit', '-m', `add ${file}`);
}

function useCase(): WorktreeCleanupUseCase {
  return new WorktreeCleanupUseCase({
    basePath: base,
    git: new GitCliAdapter(execFn, new FakeLoggerPort()),
    hostFs,
    execFn,
    resolver,
    ticketStore: store as unknown as TicketStorePort,
    fetchBare: async (org, name) => {
      if (failingFetch.has(`${org}/${name}`)) return false;
      await execFn('git', ['fetch', '--prune', 'origin'], { cwd: resolver.barePath(org, name) });
      return true;
    },
    fetchPRStates: async () => prStates,
    probe,
    emit: (e) => { events.push(e); },
    logger: new FakeLoggerPort(),
    now: () => NOW,
  });
}

const OPTS: WorktreeCleanupOptions = { olderThan: '14d', statuses: ['done', 'cancelled'], size: true };

function findWt(report: WorktreeCleanupReport, path: string): WorktreeCleanupWorktree {
  const wt = report.tickets.flatMap((t) => t.worktrees).find((w) => w.path === path);
  if (!wt) throw new Error(`worktree ${path} not in the report`);
  return wt;
}

function listedWorktrees(repo = 'acme/app'): string[] {
  return git(bareOf(repo), 'worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice(9));
}

function snapshot(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'objects' || e.name === 'logs') continue; // git internals churn on fetch
      const p = join(d, e.name);
      out.push(p);
      if (e.isDirectory()) walk(p);
    }
  };
  walk(dir);
  return out.sort();
}

const savedEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  // Keep the developer's git config (signing, hooks, templates) out of the fixture.
  for (const [k, v] of Object.entries({
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
  })) { savedEnv[k] = process.env[k]; process.env[k] = v; }
});

afterAll(() => {
  for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'wt-cleanup-')));
  base = join(root, 'projects');
  remotes = join(root, 'remotes');
  resolver = new RepoPathResolver(base);
  store = new MemoryTicketStore();
  probe = new FakeProbe();
  prStates = new Map();
  failingFetch = new Set();
  events = [];
  createRepo('acme/app');
  return () => rmSync(root, { recursive: true, force: true });
});

// ── Guards: one workspace per guard ─────────────────────────────────────────

describe('worktree cleanup — guards (each one alone keeps the worktree)', () => {
  it('a merged, clean worktree is eligible and its local branch will be deleted', async () => {
    const { ticket, ws } = makeTicket('merged');
    const wt = addWorktree(ticket, ws);
    commit(wt.path, 'feature.txt');
    git(wt.path, 'push', 'origin', `${wt.branch}:main`);

    const row = findWt(await useCase().plan(OPTS), wt.path);
    expect(row).toMatchObject({ decision: 'eligible', reasons: [], repo: 'acme/app', branch: wt.branch, branchAction: 'delete_local_merged' });
    expect(row.sizeBytes).toBeGreaterThan(0);
  });

  it('uncommitted changes to a tracked file → dirty', async () => {
    const { ticket, ws } = makeTicket('dirty');
    const wt = addWorktree(ticket, ws);
    writeFileSync(join(wt.path, 'README.md'), 'edited\n');
    expect(findWt(await useCase().plan(OPTS), wt.path)).toMatchObject({ decision: 'excluded', reasons: ['dirty'] });
  });

  it('a new file the user created → untracked_files; gitignored files never count', async () => {
    const { ticket, ws } = makeTicket('untracked');
    const wt = addWorktree(ticket, ws);
    mkdirSync(join(wt.path, 'node_modules', 'x'), { recursive: true });
    writeFileSync(join(wt.path, 'node_modules', 'x', 'index.js'), '');
    mkdirSync(join(wt.path, 'notes'));
    writeFileSync(join(wt.path, 'notes', 'draft.md'), 'my thoughts');
    const row = findWt(await useCase().plan(OPTS), wt.path);
    expect(row).toMatchObject({ decision: 'excluded', reasons: ['untracked_files'] });
    expect(row.details.untracked).toEqual(['notes/draft.md']);
  });

  it('an untracked file that Fleex copied in (overlay) is not user work', async () => {
    mkdirSync(join(resolver.overlayFilesDir('acme', 'app'), '.claude'), { recursive: true });
    writeFileSync(join(resolver.overlayFilesDir('acme', 'app'), '.claude', 'settings.local.json'), '{}');
    mkdirSync(resolver.globalOverlayFilesDir(), { recursive: true });
    writeFileSync(join(resolver.globalOverlayFilesDir(), '.env.local'), 'X=1');
    const { ticket, ws } = makeTicket('overlay');
    const wt = addWorktree(ticket, ws);
    mkdirSync(join(wt.path, '.claude'));
    writeFileSync(join(wt.path, '.claude', 'settings.local.json'), '{}');
    writeFileSync(join(wt.path, '.env.local'), 'X=1');
    expect(findWt(await useCase().plan(OPTS), wt.path)).toMatchObject({ decision: 'eligible', reasons: [] });
  });

  it('a commit pushed nowhere → unpushed_commits, and the local branch is kept', async () => {
    const { ticket, ws } = makeTicket('unpushed');
    const wt = addWorktree(ticket, ws);
    commit(wt.path, 'only-here.txt');
    const row = findWt(await useCase().plan(OPTS), wt.path);
    expect(row).toMatchObject({ decision: 'excluded', reasons: ['unpushed_commits'], branchAction: 'keep_local_unmerged' });
    expect(row.details.unpushedCommits).toBe(1);
  });

  it('squash-merged PR (remote branch deleted): commits live on refs/pull/N/head → eligible', async () => {
    const { ticket, ws } = makeTicket('squash', { prs: [7] });
    const wt = addWorktree(ticket, ws);
    commit(wt.path, 'squashed.txt');
    // GitHub keeps the PR head under refs/pull/N/head after the branch is deleted.
    git(wt.path, 'push', 'origin', `HEAD:refs/pull/7/head`);
    prStates.set('acme/app#7', 'MERGED');
    expect(findWt(await useCase().plan(OPTS), wt.path)).toMatchObject({
      decision: 'eligible', reasons: [], branchAction: 'delete_local_merged', details: expect.objectContaining({ prs: [{ number: 7, state: 'MERGED' }] }),
    });
  });

  it('same squash-merge but no PR linked to the ticket: nothing proves the commits exist elsewhere → unpushed_commits', async () => {
    const { ticket, ws } = makeTicket('squash-nopr');
    const wt = addWorktree(ticket, ws);
    commit(wt.path, 'squashed.txt');
    git(wt.path, 'push', 'origin', `HEAD:refs/pull/8/head`);
    expect(findWt(await useCase().plan(OPTS), wt.path)).toMatchObject({ decision: 'excluded', reasons: ['unpushed_commits'] });
  });

  it('a linked PR on this repo still OPEN (drafts included) → pr_open', async () => {
    const { ticket, ws } = makeTicket('pr-open', { prs: [9] });
    const wt = addWorktree(ticket, ws);
    git(wt.path, 'push', 'origin', 'HEAD:refs/pull/9/head');
    prStates.set('acme/app#9', 'OPEN');
    expect(findWt(await useCase().plan(OPTS), wt.path)).toMatchObject({ decision: 'excluded', reasons: ['pr_open'] });
  });

  it('a PR on ANOTHER repo does not hold this worktree', async () => {
    const { ticket, ws } = makeTicket('pr-elsewhere', { prs: [9], repo: 'acme/other' });
    const wt = addWorktree(ticket, ws);
    prStates.set('acme/other#9', 'OPEN');
    expect(findWt(await useCase().plan(OPTS), wt.path)).toMatchObject({ decision: 'eligible' });
  });

  it('GitHub could not tell the PR state → pr_state_unknown (never delete on a doubt)', async () => {
    const { ticket, ws } = makeTicket('pr-unknown', { prs: [10] });
    const wt = addWorktree(ticket, ws);
    git(wt.path, 'push', 'origin', 'HEAD:refs/pull/10/head');
    expect(findWt(await useCase().plan(OPTS), wt.path)).toMatchObject({ decision: 'excluded', reasons: ['pr_state_unknown'] });
  });

  it('the bare clone could not be fetched → fetch_failed (remote refs are not trustworthy)', async () => {
    createRepo('acme/flaky');
    failingFetch.add('acme/flaky');
    const { ticket, ws } = makeTicket('flaky');
    const wt = addWorktree(ticket, ws, { repo: 'acme/flaky' });
    expect(findWt(await useCase().plan(OPTS), wt.path)).toMatchObject({ decision: 'excluded', reasons: ['fetch_failed'] });
  });

  it('a tmux pane inside the worktree, or at its workspace root → tmux_session', async () => {
    const a = makeTicket('tmux-in');
    const inside = addWorktree(a.ticket, a.ws);
    const b = makeTicket('tmux-root');
    const atRoot = addWorktree(b.ticket, b.ws);
    probe.panes = [join(inside.path, 'src'), b.ws];
    const report = await useCase().plan(OPTS);
    expect(findWt(report, inside.path)).toMatchObject({ decision: 'excluded', reasons: ['tmux_session'] });
    expect(findWt(report, atRoot.path)).toMatchObject({ decision: 'excluded', reasons: ['tmux_session'] });
  });

  it('a process (dev server) running in the worktree → process_running', async () => {
    const { ticket, ws } = makeTicket('proc');
    const wt = addWorktree(ticket, ws);
    probe.processes = [{ pid: 4242, command: 'node', cwd: wt.path }, { pid: 1, command: 'launchd', cwd: '/' }];
    const row = findWt(await useCase().plan(OPTS), wt.path);
    expect(row).toMatchObject({ decision: 'excluded', reasons: ['process_running'] });
    expect(row.details.processes).toEqual([{ pid: 4242, command: 'node' }]);
  });

  it('lsof failing → process_check_failed on every worktree', async () => {
    const { ticket, ws } = makeTicket('nolsof');
    const wt = addWorktree(ticket, ws);
    probe.processError = new Error('lsof: command not found');
    expect(findWt(await useCase().plan(OPTS), wt.path)).toMatchObject({ decision: 'excluded', reasons: ['process_check_failed'] });
  });

  it('a standalone clone (.git directory) is not ours to delete → not_a_worktree', async () => {
    const { ws } = makeTicket('clone');
    git(ws, 'clone', '-q', originOf('acme/app'), 'app');
    expect(findWt(await useCase().plan(OPTS), join(ws, 'app'))).toMatchObject({ decision: 'excluded', reasons: ['not_a_worktree'] });
  });

  it('dirty AND unpushed: both reasons are listed (no short-circuit)', async () => {
    const { ticket, ws } = makeTicket('both');
    const wt = addWorktree(ticket, ws);
    commit(wt.path, 'c.txt');
    writeFileSync(join(wt.path, 'README.md'), 'edited\n');
    expect(findWt(await useCase().plan(OPTS), wt.path).reasons).toEqual(['dirty', 'unpushed_commits']);
  });

  it('favorite / blocked tickets are cleaned like any other (not a guard)', async () => {
    const { ticket, ws } = makeTicket('fav');
    ticket.favorite = true;
    ticket.blocked = true;
    const wt = addWorktree(ticket, ws);
    expect(findWt(await useCase().plan(OPTS), wt.path)).toMatchObject({ decision: 'eligible' });
  });
});

// ── Scope ───────────────────────────────────────────────────────────────────

describe('worktree cleanup — scope', () => {
  it('only tickets closed for at least --older-than, with a status in --status', async () => {
    const recent = makeTicket('recent', { closedDaysAgo: 13 });
    addWorktree(recent.ticket, recent.ws);
    const active = makeTicket('active', { status: 'doing', closedDaysAgo: 90 });
    addWorktree(active.ticket, active.ws);
    const cancelled = makeTicket('cancelled', { status: 'cancelled', closedDaysAgo: 20 });
    addWorktree(cancelled.ticket, cancelled.ws);

    const def = await useCase().plan(OPTS);
    expect(def.tickets.map((t) => t.title)).toEqual(['cancelled']);
    expect(def.skipped.map((t) => t.title).sort()).toEqual(['active', 'recent']);

    const week = await useCase().plan({ ...OPTS, olderThan: '7d' });
    expect(week.tickets.map((t) => t.title).sort()).toEqual(['cancelled', 'recent']);

    const doneOnly = await useCase().plan({ ...OPTS, olderThan: '7d', statuses: ['done'] });
    expect(doneOnly.tickets.map((t) => t.title)).toEqual(['recent']);
  });

  it('a folder is tied to its ticket by .fleex.json, even after the ticket was renamed', async () => {
    const { ticket, ws } = makeTicket('old-title');
    addWorktree(ticket, ws);
    ticket.title = 'A completely different title';
    const report = await useCase().plan(OPTS);
    expect(report.tickets[0]).toMatchObject({ ticketId: ticket.id, workspacePath: ws });
  });

  it('folders with no manifest, a broken one, a routine run, or a deleted ticket are reported unknown and left alone', async () => {
    const wsRoot = resolver.workspacesRoot();
    mkdirSync(join(wsRoot, 'tmp-experiments'), { recursive: true });
    mkdirSync(join(wsRoot, '7f0e11-broken'));
    writeFileSync(join(wsRoot, '7f0e11-broken', '.fleex.json'), '{nope');
    mkdirSync(join(wsRoot, 'abc123-gone'));
    writeFileSync(join(wsRoot, 'abc123-gone', '.fleex.json'), JSON.stringify({ ticketId: 'deleted-ticket' }));
    mkdirSync(join(wsRoot, 'routine-2fc3af36-00f27f07'));
    writeFileSync(join(wsRoot, 'routine-2fc3af36-00f27f07', '.fleex.json'), JSON.stringify({ routineId: 'r', workflowRunId: 'w' }));

    const report = await useCase().plan(OPTS);
    expect(report.unknown.map((u) => [u.path.split('/').pop(), u.reason])).toEqual([
      ['7f0e11-broken', 'manifest_invalid'],
      ['abc123-gone', 'ticket_not_found'],
      ['routine-2fc3af36-00f27f07', 'routine_workspace'],
      ['tmp-experiments', 'no_manifest'],
    ]);
    await useCase().apply({ ...OPTS });
    for (const d of ['tmp-experiments', '7f0e11-broken', 'abc123-gone', 'routine-2fc3af36-00f27f07']) expect(existsSync(join(wsRoot, d))).toBe(true);
  });

  it('--ticket restricts the run to one ticket (by #displayId)', async () => {
    const a = makeTicket('one');
    addWorktree(a.ticket, a.ws);
    const b = makeTicket('two');
    addWorktree(b.ticket, b.ws);
    const report = await useCase().plan({ ...OPTS, ticket: `#${b.ticket.displayId}` });
    expect(report.tickets.map((t) => t.title)).toEqual(['two']);
  });
});

// ── Links ↔ disk ────────────────────────────────────────────────────────────

describe('worktree cleanup — worktree links vs the disk', () => {
  it('purges links whose LOCAL target is gone, never links from another machine', async () => {
    const { ticket } = makeTicket('links');
    const gone = join(resolver.workspacesRoot(), 'c4d2e0-x', 'app');
    ticket.addLink('worktree', gone, 'b1', null, 'l-gone');
    ticket.addLink('worktree', '/home/ci-runner/projects/workspaces/9e7d10-x/app', 'b2', null, 'l-foreign-path');
    ticket.addLink('worktree', 'acme/app:ticket/ghost', 'ticket/ghost', null, 'l-ghost-branch');
    ticket.addLink('worktree', 'legacy/crm:ticket/112', 'ticket/112', null, 'l-foreign-bare');

    const plan = await useCase().plan(OPTS);
    expect(plan.tickets[0]!.orphanLinks.map((l) => l.linkId).sort()).toEqual(['l-ghost-branch', 'l-gone']);

    const applied = await useCase().apply(OPTS);
    expect(applied.totals.purgedLinks).toBe(2);
    expect(store.tickets.get(ticket.id)!.links.filter((l) => l.type === 'worktree').map((l) => l.id).sort())
      .toEqual(['l-foreign-bare', 'l-foreign-path']);
    expect(store.activities.filter((a) => a.action === 'unlinked')).toHaveLength(2);
  });

  it('finds orphan links of an in-scope ticket whose workspace folder is entirely gone', async () => {
    const { ticket, ws } = makeTicket('no-folder');
    ticket.addLink('worktree', join(ws, 'app'), 'b', null, 'l1');
    rmSync(ws, { recursive: true });
    const plan = await useCase().plan(OPTS);
    expect(plan.tickets[0]).toMatchObject({ ticketId: ticket.id, workspacePath: null, orphanLinks: [expect.objectContaining({ linkId: 'l1' })] });
  });
});

// ── Apply ───────────────────────────────────────────────────────────────────

describe('worktree cleanup — apply', () => {
  it('the dry run writes nothing: disk and tickets are identical before and after', async () => {
    const { ticket, ws } = makeTicket('dry');
    addWorktree(ticket, ws);
    ticket.addLink('worktree', join(ws, 'gone'), 'x', null, 'orphan');
    const linksBefore = JSON.stringify(ticket.links);
    const wsBefore = snapshot(resolver.workspacesRoot());

    await useCase().plan(OPTS);

    expect(snapshot(resolver.workspacesRoot())).toEqual(wsBefore);
    expect(JSON.stringify(store.tickets.get(ticket.id)!.links)).toBe(linksBefore);
    expect(store.activities).toHaveLength(0);
  });

  it('removes eligible worktrees, keeps excluded ones, and leaves the remote untouched', async () => {
    const remoteBefore = git(root, 'ls-remote', originOf('acme/app'));

    // Multi-repo-like ticket: one worktree free to go, one holding unpushed work.
    const multi = makeTicket('multi');
    const free = addWorktree(multi.ticket, multi.ws, { dir: 'app', branch: 'ticket/free' });
    const held = addWorktree(multi.ticket, multi.ws, { dir: 'app-2', branch: 'ticket/held' });
    commit(held.path, 'precious.txt');

    // Unmerged-but-pushed branch: worktree goes, local branch stays.
    const pushed = makeTicket('pushed');
    const p = addWorktree(pushed.ticket, pushed.ws);
    commit(p.path, 'f.txt');
    git(p.path, 'push', 'origin', p.branch);
    const remoteAfterSetup = git(root, 'ls-remote', originOf('acme/app'));

    const report = await useCase().apply(OPTS);

    expect(findWt(report, free.path).result).toBe('removed');
    expect(findWt(report, p.path).result).toBe('removed');
    expect(findWt(report, held.path)).toMatchObject({ decision: 'excluded', reasons: ['unpushed_commits'] });
    expect(findWt(report, held.path).result).toBeUndefined();

    expect(existsSync(free.path)).toBe(false);
    expect(existsSync(held.path)).toBe(true);
    expect(readFileSync(join(held.path, 'precious.txt'), 'utf8')).toBe('precious.txt\n');
    expect(listedWorktrees()).not.toContain(free.path);
    expect(listedWorktrees()).toContain(held.path);

    // Local branches: merged one deleted, unmerged one kept. Remote: untouched.
    const branches = git(bareOf('acme/app'), 'branch', '--format=%(refname:short)').split('\n');
    expect(branches).not.toContain('ticket/free');
    expect(branches).toContain(p.branch);
    expect(branches).toContain('ticket/held');
    expect(git(root, 'ls-remote', originOf('acme/app'))).toBe(remoteAfterSetup);
    expect(remoteAfterSetup).toContain(remoteBefore.split('\n')[0]);

    // Links: the removed worktrees' links are gone (with an activity), the kept one stays.
    const multiLinks = store.tickets.get(multi.ticket.id)!.links.filter((l) => l.type === 'worktree').map((l) => l.ref);
    expect(multiLinks).toEqual([held.path]);
    expect(store.tickets.get(pushed.ticket.id)!.links.filter((l) => l.type === 'worktree')).toEqual([]);
    expect(store.activities.filter((a) => a.action === 'unlinked')).toHaveLength(2);
    expect(events.filter((e) => e.type === 'worktree.deleted')).toHaveLength(2);

    // Workspace folders: gone when only .fleex.json is left, kept otherwise.
    expect(existsSync(pushed.ws)).toBe(false);
    expect(existsSync(multi.ws)).toBe(true);

    expect(report.totals).toMatchObject({ removed: 2, failed: 0, skipped: 0 });
    expect(report.totals.freedBytes).toBeGreaterThan(0);
  });

  it('keeps a workspace folder that still holds a user file', async () => {
    const { ticket, ws } = makeTicket('notes');
    addWorktree(ticket, ws);
    writeFileSync(join(ws, 'NOTES.md'), 'keep me');
    await useCase().apply(OPTS);
    expect(readdirSync(ws).sort()).toEqual(['.fleex.json', 'NOTES.md']);
  });

  it('removes an in-scope workspace folder holding nothing but its manifest', async () => {
    const { ws } = makeTicket('empty');
    const plan = await useCase().plan(OPTS);
    expect(plan.emptyWorkspaces.map((e) => e.path)).toEqual([ws]);
    await useCase().apply(OPTS);
    expect(existsSync(ws)).toBe(false);
  });

  it('is idempotent: a second apply removes nothing and fails nothing', async () => {
    const { ticket, ws } = makeTicket('twice');
    addWorktree(ticket, ws);
    expect((await useCase().apply(OPTS)).totals.removed).toBe(1);
    const second = await useCase().apply(OPTS);
    expect(second.totals).toMatchObject({ removed: 0, failed: 0, purgedLinks: 0 });
  });

  it('a guard that trips between the plan and the deletion → skipped_guard, worktree intact', async () => {
    const { ticket, ws } = makeTicket('late');
    const wt = addWorktree(ticket, ws);
    // A tmux pane opens on the worktree after the plan's probe (call 1), before the re-check.
    probe.latePanes = [{ afterCall: 1, path: wt.path }];
    const report = await useCase().apply(OPTS);
    expect(findWt(report, wt.path)).toMatchObject({ result: 'skipped_guard', reasons: ['tmux_session'] });
    expect(existsSync(wt.path)).toBe(true);
    expect(store.tickets.get(ticket.id)!.links.some((l) => l.ref === wt.path)).toBe(true);
  });

  it('interrupted between the removal and the link update: the next run purges the orphan link', async () => {
    const { ticket, ws } = makeTicket('crash');
    const wt = addWorktree(ticket, ws);
    store.failNextSave = true;

    const first = await useCase().apply(OPTS);
    expect(findWt(first, wt.path).result).toBe('failed');
    expect(existsSync(wt.path)).toBe(false);
    expect(store.tickets.get(ticket.id)!.links.some((l) => l.ref === wt.path)).toBe(true);

    const second = await useCase().apply(OPTS);
    expect(second.tickets[0]!.orphanLinks).toEqual([expect.objectContaining({ ref: wt.path, result: 'purged' })]);
    expect(store.tickets.get(ticket.id)!.links.some((l) => l.ref === wt.path)).toBe(false);
    expect(existsSync(ws)).toBe(false);
    expect(second.totals.failed).toBe(0);
  });

  it('stops between two worktrees when the client goes away', async () => {
    const a = makeTicket('abort-a');
    const wa = addWorktree(a.ticket, a.ws);
    const b = makeTicket('abort-b');
    const wb = addWorktree(b.ticket, b.ws);
    const ac = new AbortController();
    const uc = useCase();
    // Abort as soon as the first worktree is gone.
    events = new Proxy(events, { get: (t, k) => (k === 'push' ? (e: { type: string }) => { if (e.type === 'worktree.deleted') ac.abort(); return t.push(e); } : Reflect.get(t, k)) });
    const report = await uc.apply(OPTS, ac.signal);
    expect(report.interrupted).toBe(true);
    expect([existsSync(wa.path), existsSync(wb.path)].filter(Boolean)).toHaveLength(1);
  });

  it('refuses a second concurrent apply', async () => {
    const { ticket, ws } = makeTicket('concurrent');
    addWorktree(ticket, ws);
    const uc = useCase();
    const first = uc.apply(OPTS);
    await expect(uc.apply(OPTS)).rejects.toBeInstanceOf(CleanupInProgressError);
    await first;
  });
});
