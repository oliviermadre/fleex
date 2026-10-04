import { basename, dirname, join } from 'node:path';
import {
  WORKTREE_START_SLOT,
  isWorktreeVerb,
  runSlotKey,
  worktreeSourceId,
  type ActionRun,
  type WorktreeActionItem,
  type WorktreeActionsView,
  type WorktreeConfig,
  type WorktreeRunResponse,
  type WorktreeServerSnapshot,
  type WorktreeServerState,
  type WorktreeVerb,
} from '@fleex/shared';
import type { AppConfig, ConfigPort } from '../ports/config.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { HostFs } from '../../infrastructure/host/types.js';
import type { RepoPathResolver } from '../../domain/services/repo-path-resolver.js';
import type { ActionRunService } from '../../domain/services/action-run.service.js';
import {
  detectPackageManager,
  parseComposerJson,
  parseLaunchJson,
  parseMakefile,
  parsePackageJson,
  type DetectedItem,
} from '../../domain/services/worktree-discovery.js';
import { mergeWorktreeConfig, type MergedWorktree } from '../../domain/services/worktree-config-merge.js';
import { buildFleexEnv, withEnv } from '../../domain/services/worktree-env.js';

/** While starting, look for the port this often… */
export const STARTING_CHECK_MS = 2_000;
/** …and once running, check it is still there this often. */
export const RUNNING_CHECK_MS = 15_000;
const STOP_WAIT_MS = 10_000;
const PORT_CHECK_TIMEOUT_MS = 5_000;
const PROBE_TIMEOUT_MS = 10_000;

export const SHARED_CONFIG_FILE = '.fleex/worktree.json';
export const LAUNCH_FILE = '.claude/launch.json';

/** What the service needs of a tmux session. */
export interface WorktreeServerTerminals {
  sessionNameFor(key: string): string;
  inspect(sessionName: string): Promise<{ alive: boolean; dead: boolean; exitStatus?: number; ports: number[] }>;
  close(sessionName: string): Promise<void>;
}

export type WorktreeShell = (command: string, options: { cwd: string; timeoutMs: number }) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

export interface WorktreeActionsDeps {
  hostFs: HostFs;
  getRepoInfo: (path: string) => Promise<{ org: string; name: string; branch: string }>;
  discoverWorktrees: (rootPath: string) => Promise<string[]>;
  config: ConfigPort;
  resolver: RepoPathResolver;
  actionRuns: Pick<ActionRunService, 'start' | 'cancel' | 'get' | 'list'>;
  terminals: WorktreeServerTerminals;
  shell: WorktreeShell;
  broadcast: (type: 'worktree-server:update', data: WorktreeServerSnapshot) => void;
  logger: LoggerPort;
  now?: () => Date;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  sleep?: (ms: number) => Promise<void>;
}

/** A refused request, with the HTTP status it maps to. */
export class WorktreeActionError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
  }
}

interface WorktreeContext {
  path: string;
  repo: string | null;
  org?: string;
  name: string;
  branch: string;
  workspacePath?: string;
  ticketId?: string;
}

interface ServerEntry {
  sourceId: string;
  snapshot: WorktreeServerSnapshot;
  /** launch.json port of the start target: a listener on it counts as "running". */
  launchPort?: number;
  launchUrl?: string;
  urlTemplate?: string;
  probe?: { command: string; intervalSec?: number };
  env: Record<string, string>;
  cwd: string;
  nextCheckAt: number;
  lastProbeAt: number;
  checking: boolean;
}

interface Resolved {
  ctx: WorktreeContext;
  merged: MergedWorktree;
  sharedConfigError?: string;
}

/**
 * The worktree buttons: reads a worktree's four config layers, runs its
 * commands through the action engine (same runs, logs and terminals as the
 * pinned actions) and keeps the state of its dev server.
 *
 * The server's start command runs in a persistent tmux session (no timeout,
 * survives a Fleex restart and is adopted back). Its state is
 * stopped → starting → running | error: running once a port is heard on (in
 * the start command's process tree, or the launch.json port) or the probe
 * passes; error when the command dies with a non-zero code.
 */
export class WorktreeActionsService {
  private readonly entries = new Map<string, ServerEntry>();
  private readonly fileCache = new Map<string, { mtimeMs: number; text: string }>();
  private timer: unknown = null;

  constructor(private readonly deps: WorktreeActionsDeps) {}

  // ─── Reading ───────────────────────────────────────────────────────────────

  /** Every worktree under `path` (a ticket workspace, or a worktree itself). */
  async list(path: string): Promise<WorktreeActionsView[]> {
    const dirs = await this.deps.discoverWorktrees(path);
    const views = await Promise.all(dirs.map((dir) => this.view(dir)));
    return views.sort((a, b) => (a.repo ?? basename(a.path)).localeCompare(b.repo ?? basename(b.path)) || a.branch.localeCompare(b.branch));
  }

  async view(path: string): Promise<WorktreeActionsView> {
    const { ctx, merged, sharedConfigError } = await this.resolve(path);
    const entry = await this.entryFor(path, merged);
    return {
      path,
      repo: ctx.repo,
      branch: ctx.branch,
      items: merged.items,
      start: merged.start ? { ...(merged.start.id ? { id: merged.start.id } : {}), command: merged.start.command, label: merged.start.label } : null,
      clickByState: merged.clickByState,
      server: { ...entry.snapshot },
      ...(sharedConfigError ? { sharedConfigError } : {}),
    };
  }

  // ─── Running ───────────────────────────────────────────────────────────────

  /** Run a verb, or an item of the menu by id. */
  async run(path: string, target: { id?: string; verb?: string }): Promise<WorktreeRunResponse> {
    if (target.verb !== undefined) {
      if (!isWorktreeVerb(target.verb)) throw new WorktreeActionError(400, `Unknown verb "${target.verb}"`);
      return this.runVerb(path, target.verb);
    }
    const id = target.id?.trim();
    if (!id) throw new WorktreeActionError(400, 'id or verb is required');
    // `start`, `open`… typed as an id (CLI `fleex repo run start`) are the verbs.
    if (isWorktreeVerb(id)) return this.runVerb(path, id);
    const resolved = await this.resolve(path);
    const item = resolved.merged.items.find((i) => i.id === id);
    if (!item) throw new WorktreeActionError(404, `No command "${id}" in this worktree`);
    // A launch.json configuration is a start target (PRD D4): it runs as the server.
    if (item.source === 'launch') return this.start(path, resolved, { id: item.id, command: item.command, label: item.label, item });
    return this.runItem(path, resolved, item);
  }

  private async runVerb(path: string, verb: WorktreeVerb): Promise<WorktreeRunResponse> {
    const resolved = await this.resolve(path);
    switch (verb) {
      case 'start': {
        if (!resolved.merged.start) {
          throw new WorktreeActionError(409, 'No start command configured for this worktree (server.start in .fleex/worktree.json or your Fleex settings)');
        }
        return this.start(path, resolved, resolved.merged.start);
      }
      case 'stop':
        return { server: await this.stop(path, resolved) };
      case 'restart': {
        await this.stop(path, resolved);
        if (!resolved.merged.start) throw new WorktreeActionError(409, 'No start command configured for this worktree');
        return this.start(path, resolved, resolved.merged.start);
      }
      case 'open': {
        const entry = await this.entryFor(path, resolved.merged);
        if (entry.snapshot.state !== 'running' || !entry.snapshot.url) {
          throw new WorktreeActionError(409, `The server is ${entry.snapshot.state}${entry.snapshot.state === 'running' ? ' but its URL is unknown' : ''}`);
        }
        return { url: entry.snapshot.url, server: { ...entry.snapshot } };
      }
      case 'logs': {
        const entry = await this.entryFor(path, resolved.merged);
        const runId = entry.snapshot.runId ?? this.deps.actionRuns.list(entry.sourceId).find((r) => r.slot === WORKTREE_START_SLOT)?.runId;
        return { ...(runId ? { runId } : {}), server: { ...entry.snapshot } };
      }
      case 'status': {
        const entry = await this.entryFor(path, resolved.merged);
        await this.check(entry, true);
        return { server: { ...entry.snapshot } };
      }
    }
  }

  private async start(
    path: string,
    { ctx, merged }: Resolved,
    target: NonNullable<MergedWorktree['start']>,
  ): Promise<WorktreeRunResponse> {
    const entry = await this.entryFor(path, merged);
    if (entry.snapshot.state === 'starting' || entry.snapshot.state === 'running') {
      return { alreadyRunning: true, ...(entry.snapshot.runId ? { runId: entry.snapshot.runId } : {}), server: { ...entry.snapshot } };
    }
    const item = target.item;
    const env = { ...this.fleexEnv(ctx, item?.port), ...(item?.env ?? {}) };
    const cwd = item?.cwd ? join(path, item.cwd) : path;
    const result = this.deps.actionRuns.start(
      {
        sourceId: entry.sourceId,
        sourceKind: 'worktree',
        label: `${ctx.name} · ${target.label}`,
        command: withEnv(target.command, env),
        cwd,
        mode: 'terminal',
        slot: WORKTREE_START_SLOT,
      },
      { persistent: true },
    );
    if (!result.ok) return { alreadyRunning: true, runId: result.runningRunId, server: { ...entry.snapshot } };

    entry.launchPort = item?.port;
    entry.launchUrl = item?.url;
    entry.urlTemplate = merged.server.url;
    entry.probe = merged.server.probe?.command?.trim() ? merged.server.probe : undefined;
    entry.env = env;
    entry.cwd = cwd;
    entry.lastProbeAt = 0;
    this.setState(entry, {
      state: 'starting',
      runId: result.run.runId,
      ...(result.run.tmuxSession ? { tmuxSession: result.run.tmuxSession } : {}),
    });
    entry.nextCheckAt = this.nowMs() + STARTING_CHECK_MS;
    this.schedule();
    this.deps.logger.info('Worktree server starting', { path, command: target.command });
    return { runId: result.run.runId, run: result.run, server: { ...entry.snapshot } };
  }

  private async stop(path: string, { ctx, merged }: Resolved): Promise<WorktreeServerSnapshot> {
    const entry = await this.entryFor(path, merged);
    if (entry.snapshot.state === 'stopped') return { ...entry.snapshot };

    const stopCommand = merged.server.stop?.trim();
    if (stopCommand && entry.snapshot.state !== 'error') {
      const res = this.deps.actionRuns.start({
        sourceId: entry.sourceId,
        sourceKind: 'worktree',
        label: `${ctx.name} · stop`,
        command: withEnv(stopCommand, { ...this.fleexEnv(ctx, entry.snapshot.port), ...(entry.snapshot.url ? { FLEEX_URL: entry.snapshot.url } : {}) }),
        cwd: path,
        mode: 'background',
        slot: 'stop',
        timeoutSec: 120,
      });
      if (res.ok) await this.waitForRun(res.run.runId, 120_000);
    }

    // Whatever the stop command did, the start command must not outlive Stop.
    const runId = entry.snapshot.runId;
    if (runId) {
      await this.deps.actionRuns.cancel(runId);
      await this.waitForRun(runId, STOP_WAIT_MS);
    } else if (entry.snapshot.tmuxSession) {
      await this.deps.terminals.close(entry.snapshot.tmuxSession);
    }
    this.setState(entry, { state: 'stopped' });
    return { ...entry.snapshot };
  }

  private runItem(path: string, { ctx }: Resolved, item: WorktreeActionItem): WorktreeRunResponse {
    const entry = this.entries.get(path);
    const port = entry?.snapshot.state === 'running' ? entry.snapshot.port : undefined;
    const env = {
      ...this.fleexEnv(ctx, port),
      ...(port && entry?.snapshot.url ? { FLEEX_URL: entry.snapshot.url } : {}),
      ...(item.env ?? {}),
    };
    const sourceId = worktreeSourceId(path);
    const result = this.deps.actionRuns.start({
      sourceId,
      sourceKind: 'worktree',
      label: `${ctx.name} · ${item.label}`,
      command: withEnv(item.command, env),
      cwd: item.cwd ? join(path, item.cwd) : path,
      mode: item.mode,
      slot: item.id,
    });
    const server = entry ? { ...entry.snapshot } : this.blankSnapshot(path);
    if (!result.ok) return { alreadyRunning: true, runId: result.runningRunId, server };
    return { runId: result.run.runId, run: result.run, server };
  }

  /** ActionRunService's `onFinished`: the start command ending ends the server. */
  onRunFinished(run: ActionRun): void {
    if (run.sourceKind !== 'worktree' || run.slot !== WORKTREE_START_SLOT) return;
    const entry = [...this.entries.values()].find((e) => e.sourceId === run.sourceId);
    if (!entry || entry.snapshot.runId !== run.runId) return;
    const failed = !run.cancelled && run.exitCode !== 0;
    this.setState(entry, failed
      ? { state: 'error', ...(run.exitCode !== undefined ? { exitCode: run.exitCode } : {}), ...(entry.snapshot.tmuxSession ? { tmuxSession: entry.snapshot.tmuxSession } : {}) }
      : { state: 'stopped' });
  }

  // ─── Pins & personal layer ────────────────────────────────────────────────

  async setPinned(path: string, id: string, pinned: boolean): Promise<WorktreeActionsView> {
    const { ctx } = await this.resolve(path);
    if (!ctx.repo) throw new WorktreeActionError(400, 'This worktree has no resolvable repository (git remote)');
    await this.updatePersonal(ctx.repo, (cfg) => {
      const pins = new Set(cfg.pins ?? []);
      if (pinned) pins.add(id);
      else pins.delete(id);
      return { ...cfg, pins: [...pins] };
    });
    return this.view(path);
  }

  getPersonal(repo: string): WorktreeConfig {
    return this.deps.config.get().worktreeConfigs?.[repo] ?? {};
  }

  async updatePersonal(repo: string, fn: (cfg: WorktreeConfig) => WorktreeConfig): Promise<WorktreeConfig> {
    const all = this.deps.config.get().worktreeConfigs ?? {};
    const next = fn(all[repo] ?? {});
    await this.deps.config.update({ worktreeConfigs: { ...all, [repo]: next } });
    return next;
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  private async resolve(path: string): Promise<Resolved> {
    const ctx = await this.context(path);
    const personal = ctx.repo ? this.deps.config.get().worktreeConfigs?.[ctx.repo] : undefined;
    const sharedText = await this.readCached(join(path, SHARED_CONFIG_FILE));
    let shared: WorktreeConfig | undefined;
    let sharedConfigError: string | undefined;
    if (sharedText !== null) {
      try {
        const parsed = JSON.parse(sharedText) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) shared = parsed as WorktreeConfig;
        else sharedConfigError = `${SHARED_CONFIG_FILE} is not a JSON object`;
      } catch (err) {
        sharedConfigError = `${SHARED_CONFIG_FILE}: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
    const [launch, detected] = await Promise.all([this.readLaunch(path), this.detect(path)]);
    return { ctx, merged: mergeWorktreeConfig({ personal, shared, launch, detected }), ...(sharedConfigError ? { sharedConfigError } : {}) };
  }

  private async readLaunch(path: string): Promise<DetectedItem[]> {
    const text = await this.readCached(join(path, LAUNCH_FILE));
    return text === null ? [] : parseLaunchJson(text);
  }

  /** Root-level package.json / Makefile / composer.json only (V1). */
  private async detect(path: string): Promise<DetectedItem[]> {
    let names: Set<string>;
    try {
      names = new Set((await this.deps.hostFs.readdir(path)).filter((e) => e.isFile).map((e) => e.name));
    } catch {
      return [];
    }
    const items: DetectedItem[] = [];
    if (names.has('package.json')) {
      const text = await this.readCached(join(path, 'package.json'));
      if (text !== null) items.push(...parsePackageJson(text, detectPackageManager(names)));
    }
    const makefile = ['Makefile', 'makefile', 'GNUmakefile'].find((n) => names.has(n));
    if (makefile) {
      const text = await this.readCached(join(path, makefile));
      if (text !== null) items.push(...parseMakefile(text));
    }
    if (names.has('composer.json')) {
      const text = await this.readCached(join(path, 'composer.json'));
      if (text !== null) items.push(...parseComposerJson(text));
    }
    return items;
  }

  /** File text, re-read only when its mtime changed; null when absent. */
  private async readCached(file: string): Promise<string | null> {
    let stat: { size: number; mtimeMs: number } | null = null;
    try {
      stat = await this.deps.hostFs.stat(file);
    } catch { /* absent, or a host fs without stat: read below */ }
    const cached = this.fileCache.get(file);
    if (stat && cached && cached.mtimeMs === stat.mtimeMs) return cached.text;
    try {
      const text = await this.deps.hostFs.readFile(file);
      if (stat) this.fileCache.set(file, { mtimeMs: stat.mtimeMs, text });
      return text;
    } catch {
      this.fileCache.delete(file);
      return null;
    }
  }

  private async context(path: string): Promise<WorktreeContext> {
    let org: string | undefined;
    let name = basename(path);
    let branch = '';
    try {
      const info = await this.deps.getRepoInfo(path);
      branch = info.branch;
      if (info.org && !info.org.startsWith('_') && info.org !== 'unknown') {
        org = info.org;
        name = info.name;
      }
    } catch { /* no remote: still usable, without personal layer */ }
    const workspacePath = dirname(path);
    let ticketId: string | undefined;
    try {
      const manifest = JSON.parse(await this.deps.hostFs.readFile(join(workspacePath, '.fleex.json'))) as { ticketId?: unknown };
      if (typeof manifest.ticketId === 'string') ticketId = manifest.ticketId;
    } catch { /* not in a ticket workspace */ }
    return {
      path,
      repo: org ? `${org}/${name}` : null,
      ...(org ? { org } : {}),
      name,
      branch,
      ...(ticketId ? { workspacePath, ticketId } : {}),
    };
  }

  private fleexEnv(ctx: WorktreeContext, port?: number): Record<string, string> {
    return buildFleexEnv({
      worktreePath: ctx.path,
      ...(ctx.repo ? { repo: ctx.repo, repoPath: this.deps.resolver.barePath(ctx.org!, ctx.name) } : {}),
      ...(ctx.workspacePath ? { workspacePath: ctx.workspacePath } : {}),
      ...(ctx.branch ? { branch: ctx.branch } : {}),
      ...(ctx.ticketId ? { ticketId: ctx.ticketId } : {}),
      ...(port ? { port } : {}),
    });
  }

  /**
   * The worktree's server entry. Created on first sight — and if a start
   * session of a previous Fleex run is still alive, it is adopted as starting
   * (the next check finds its port).
   */
  private async entryFor(path: string, merged: MergedWorktree): Promise<ServerEntry> {
    const existing = this.entries.get(path);
    if (existing) return existing;
    const sourceId = worktreeSourceId(path);
    const entry: ServerEntry = {
      sourceId,
      snapshot: this.blankSnapshot(path),
      env: {},
      cwd: path,
      nextCheckAt: 0,
      lastProbeAt: 0,
      checking: false,
      ...(merged.start?.item?.port ? { launchPort: merged.start.item.port } : {}),
      ...(merged.start?.item?.url ? { launchUrl: merged.start.item.url } : {}),
      ...(merged.server.url ? { urlTemplate: merged.server.url } : {}),
      ...(merged.server.probe?.command?.trim() ? { probe: merged.server.probe } : {}),
    };
    this.entries.set(path, entry);
    const session = this.deps.terminals.sessionNameFor(runSlotKey(sourceId, WORKTREE_START_SLOT));
    try {
      const seen = await this.deps.terminals.inspect(session);
      if (seen.alive && !seen.dead) {
        entry.snapshot = { ...entry.snapshot, state: 'starting', tmuxSession: session };
        await this.check(entry, true);
        this.schedule();
      }
    } catch { /* no tmux: nothing to adopt */ }
    return entry;
  }

  private blankSnapshot(path: string): WorktreeServerSnapshot {
    return { path, state: 'stopped', updatedAt: this.now().toISOString() };
  }

  private setState(entry: ServerEntry, next: Partial<WorktreeServerSnapshot> & { state: WorktreeServerState }): void {
    const prev = entry.snapshot;
    // Fields not restated are dropped: a stopped server has no port, run or session.
    const snapshot: WorktreeServerSnapshot = { path: prev.path, updatedAt: prev.updatedAt, ...next };
    const changed = (['state', 'port', 'url', 'runId', 'tmuxSession', 'exitCode'] as const).some((k) => snapshot[k] !== prev[k]);
    if (!changed) return;
    snapshot.updatedAt = this.now().toISOString();
    entry.snapshot = snapshot;
    this.deps.broadcast('worktree-server:update', { ...snapshot });
  }

  /** One look at a live server: process alive? port? probe? */
  private async check(entry: ServerEntry, force = false): Promise<void> {
    const { state, tmuxSession, runId } = entry.snapshot;
    if (state !== 'starting' && state !== 'running') return;
    if (entry.checking || (!force && this.nowMs() < entry.nextCheckAt)) return;
    entry.checking = true;
    try {
      let ports: number[] = [];
      if (tmuxSession) {
        const seen = await this.deps.terminals.inspect(tmuxSession);
        // With a run in flight, its end is reported by onRunFinished; an adopted one has no run.
        if (!seen.alive) {
          if (!runId) this.setState(entry, { state: 'stopped' });
          return;
        }
        if (seen.dead) {
          if (!runId) this.setState(entry, seen.exitStatus ? { state: 'error', exitCode: seen.exitStatus, tmuxSession } : { state: 'stopped' });
          return;
        }
        ports = seen.ports;
      }
      let port = entry.launchPort && ports.includes(entry.launchPort) ? entry.launchPort : ports[0];
      if (!port && entry.launchPort && (await this.listening(entry.launchPort))) port = entry.launchPort;
      let up = !!port;

      if (entry.probe) {
        const intervalMs = Math.max(5, entry.probe.intervalSec ?? 30) * 1000;
        if (force || state === 'starting' || this.nowMs() - entry.lastProbeAt >= intervalMs) {
          entry.lastProbeAt = this.nowMs();
          const url = this.urlFor(entry, port);
          const res = await this.deps.shell(withEnv(entry.probe.command, { ...entry.env, ...(port ? { FLEEX_PORT: String(port) } : {}), ...(url ? { FLEEX_URL: url } : {}) }), { cwd: entry.cwd, timeoutMs: PROBE_TIMEOUT_MS }).catch(() => ({ exitCode: 1 }));
          if (res.exitCode === 0) up = true;
          else if (state === 'running') {
            this.setState(entry, { state: 'error', ...(runId ? { runId } : {}), ...(tmuxSession ? { tmuxSession } : {}) });
            return;
          }
        } else if (state === 'running') {
          up = true; // between two probes, a running server stays running
        }
      }

      const keep = { ...(runId ? { runId } : {}), ...(tmuxSession ? { tmuxSession } : {}) };
      if (up) {
        const url = this.urlFor(entry, port);
        this.setState(entry, { state: 'running', ...keep, ...(port ? { port } : {}), ...(url ? { url } : {}) });
      } else {
        this.setState(entry, { state: 'starting', ...keep });
      }
    } finally {
      entry.checking = false;
      entry.nextCheckAt = this.nowMs() + (entry.snapshot.state === 'running' ? RUNNING_CHECK_MS : STARTING_CHECK_MS);
    }
  }

  private urlFor(entry: ServerEntry, port: number | undefined): string | undefined {
    if (entry.urlTemplate) {
      if (entry.urlTemplate.includes('${port}')) return port ? entry.urlTemplate.replace(/\$\{port\}/g, String(port)) : undefined;
      return entry.urlTemplate;
    }
    if (entry.launchUrl) return entry.launchUrl;
    return port ? `http://localhost:${port}` : undefined;
  }

  private async listening(port: number): Promise<boolean> {
    const res = await this.deps.shell(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`, { cwd: '/', timeoutMs: PORT_CHECK_TIMEOUT_MS }).catch(() => null);
    return !!res && res.exitCode === 0 && res.stdout.trim().length > 0;
  }

  private async waitForRun(runId: string, timeoutMs: number): Promise<void> {
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const deadline = this.nowMs() + timeoutMs;
    while (this.nowMs() < deadline) {
      const run = this.deps.actionRuns.get(runId);
      if (!run || run.finishedAt) return;
      await sleep(250);
    }
  }

  /** One timer for every live server, ticking while any is starting or running. */
  private schedule(): void {
    if (this.timer !== null) return;
    const live = [...this.entries.values()].some((e) => e.snapshot.state === 'starting' || e.snapshot.state === 'running');
    if (!live) return;
    this.timer = (this.deps.setTimer ?? setTimeout)(() => {
      this.timer = null;
      void this.tick();
    }, STARTING_CHECK_MS);
  }

  private async tick(): Promise<void> {
    await Promise.all([...this.entries.values()].map((e) => this.check(e).catch((err) => {
      this.deps.logger.warn('Worktree server check failed', { path: e.snapshot.path, error: err instanceof Error ? err.message : String(err) });
    })));
    this.schedule();
  }

  /** Test seam: run one round of checks now. */
  async tickForTest(): Promise<void> {
    await this.tick();
  }

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }

  private nowMs(): number {
    return this.now().getTime();
  }
}

/**
 * Copy each repo's legacy `postCheckoutHook` into the personal layer's
 * `hooks.setup` (PRD D6), once: a setup already set — even to '' — wins.
 * Returns the new `worktreeConfigs`, or null when nothing changed.
 */
export function migrateLegacySetupHooks(config: Pick<AppConfig, 'repoConfigs' | 'worktreeConfigs'>): AppConfig['worktreeConfigs'] | null {
  const next = { ...(config.worktreeConfigs ?? {}) };
  let changed = false;
  for (const [repo, repoConfig] of Object.entries(config.repoConfigs ?? {})) {
    const legacy = repoConfig?.postCheckoutHook;
    if (!legacy?.trim() || next[repo]?.hooks?.setup !== undefined) continue;
    next[repo] = { ...(next[repo] ?? {}), hooks: { ...(next[repo]?.hooks ?? {}), setup: legacy } };
    changed = true;
  }
  return changed ? next : null;
}
