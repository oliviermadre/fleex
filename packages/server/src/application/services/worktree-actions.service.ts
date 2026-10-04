import { basename, dirname, join } from 'node:path';
import {
  WORKTREE_START_SLOT,
  WORKTREE_LOGS_SLOT,
  WORKTREE_STOP_SLOT,
  isWorktreeVerb,
  runSlotKey,
  worktreeSourceId,
  endpointEnv,
  parseProbeEndpoints,
  getConfigKey,
  isWorktreeConfigKey,
  setConfigKey,
  type ActionRun,
  type WorktreeActionItem,
  type WorktreeActionsView,
  type WorktreeConfig,
  type WorktreeConfigKey,
  type WorktreeEndpoint,
  type WorktreeHook,
  type WorktreeSettingsResponse,
  type WorktreeSetupSnapshot,
  type WorktreeRunResponse,
  type WorktreeServerSnapshot,
  type WorktreeServerState,
  type WorktreeServerMode,
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
import { buildFleexEnv, interpolateHook, withEnv } from '../../domain/services/worktree-env.js';

/** While starting, look for the port this often… */
export const STARTING_CHECK_MS = 2_000;
/** …and once running, check it is still there this often. */
export const RUNNING_CHECK_MS = 15_000;
const STOP_WAIT_MS = 10_000;
/** A background Start must hand back (`up -d`): past this, its run is cut and the start failed. */
const BACKGROUND_START_TIMEOUT_SEC = 300;
/** Before a removal the stop command gets less time: the HTTP request deleting the ticket waits on it. */
const TEARDOWN_STOP_COMMAND_MS = 30_000;
const PORT_CHECK_TIMEOUT_MS = 5_000;
const PROBE_TIMEOUT_MS = 10_000;
/** A start command that handed back (`up -d`) has this long for its probe to pass. */
export const DETACHED_START_TIMEOUT_MS = 5 * 60_000;

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
  broadcast: (type: 'worktree-server:update' | 'worktree-setup:update', data: WorktreeServerSnapshot | WorktreeSetupSnapshot) => void;
  logger: LoggerPort;
  /** Overlay files and hook scripts of a repo (settings screen, Setup re-runs). */
  overlay?: {
    listOverlayFilesRecursive(org: string, name: string): Promise<string[]>;
    listHookScripts(hooksDir: string): Promise<string[]>;
    ensureOverlayDirs(org: string, name: string): Promise<void>;
  };
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
  /** `server.mode` as configured (undefined = guessed from the probe). */
  mode?: WorktreeServerMode;
  env: Record<string, string>;
  cwd: string;
  nextCheckAt: number;
  lastProbeAt: number;
  /** When the start command was launched: bounds a detached start waiting on its probe. */
  startedAt?: number;
  /** What the last passing probe reported on its stdout (the endpoints contract), if anything. */
  probeEndpoints?: WorktreeEndpoint[];
  checking: boolean;
}

interface Resolved {
  ctx: WorktreeContext;
  merged: MergedWorktree;
  personal: WorktreeConfig;
  shared: WorktreeConfig | null;
  sharedConfigError?: string;
}

/** First port of the reserved ranges, and the size of a range slot. */
export const PORT_RANGE_BASE = 41000;
export const PORT_RANGE_SLOT = 20;
const DEFAULT_HOOK_TIMEOUT_SEC = 60;

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
 *
 * With a probe, the probe is the source of truth and runs in every state: it
 * turns a server started outside Fleex green, and a start command that hands
 * back with 0 (`docker compose up -d`) leaves the state to it instead of
 * meaning stopped. A failing probe means stopped when nothing of ours is
 * alive, error when the start command still runs.
 */
export class WorktreeActionsService {
  private readonly entries = new Map<string, ServerEntry>();
  private readonly fileCache = new Map<string, { mtimeMs: number; text: string }>();
  private readonly setups = new Map<string, WorktreeSetupSnapshot>();
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
    if (merged.ports.reserve) await this.allocatePorts(path);
    const entry = await this.entryFor(path, merged, ctx);
    return {
      path,
      repo: ctx.repo,
      branch: ctx.branch,
      items: merged.items,
      start: merged.start ? { ...(merged.start.id ? { id: merged.start.id } : {}), command: merged.start.command, label: merged.start.label } : null,
      clickByState: merged.clickByState,
      server: { ...entry.snapshot },
      ...(sharedConfigError ? { sharedConfigError } : {}),
      ...(this.setups.get(path) ? { setup: { ...this.setups.get(path)! } } : {}),
      ...(this.deps.config.get().worktreePorts?.[path] ? { reservedPort: this.deps.config.get().worktreePorts![path] } : {}),
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
    return await this.runItem(path, resolved, item);
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
      case 'stop': {
        const res = await this.stop(path, resolved, 120_000, true);
        return res.run ? { runId: res.run.runId, run: res.run, server: res.server } : { server: res.server };
      }
      case 'restart': {
        await this.stop(path, resolved);
        if (!resolved.merged.start) throw new WorktreeActionError(409, 'No start command configured for this worktree');
        return this.start(path, resolved, resolved.merged.start);
      }
      case 'open': {
        const entry = await this.entryFor(path, resolved.merged, resolved.ctx);
        if (entry.snapshot.state !== 'running' || !entry.snapshot.url) {
          throw new WorktreeActionError(409, `The server is ${entry.snapshot.state}${entry.snapshot.state === 'running' ? ' but its URL is unknown' : ''}`);
        }
        return { url: entry.snapshot.url, server: { ...entry.snapshot } };
      }
      case 'logs': {
        const entry = await this.entryFor(path, resolved.merged, resolved.ctx);
        // A logs command (detached servers log elsewhere: docker compose logs -f, fleex logs) wins.
        const logs = resolved.merged.server.logs?.trim();
        if (logs) {
          const res = await this.runItem(path, resolved, { id: WORKTREE_LOGS_SLOT, source: 'action', layer: 'personal', label: 'logs', command: logs, mode: 'terminal', pinned: false });
          return res.run || res.runId ? res : { server: { ...entry.snapshot } };
        }
        const runId = entry.snapshot.runId ?? this.deps.actionRuns.list(entry.sourceId).find((r) => r.slot === WORKTREE_START_SLOT)?.runId;
        return { ...(runId ? { runId } : {}), server: { ...entry.snapshot } };
      }
      case 'status': {
        const entry = await this.entryFor(path, resolved.merged, resolved.ctx);
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
    const entry = await this.entryFor(path, merged, ctx);
    if (entry.snapshot.state === 'starting' || entry.snapshot.state === 'running') {
      return { alreadyRunning: true, ...(entry.snapshot.runId ? { runId: entry.snapshot.runId } : {}), server: { ...entry.snapshot } };
    }
    const item = target.item;
    const env = { ...(await this.envFor(path, ctx, merged, item?.port, item?.autoPort)), ...(item?.env ?? {}) };
    const cwd = item?.cwd ? join(path, item.cwd) : path;
    // Background: no TTY, it hands back and its exit code tells (merge made the server detached).
    // Terminal: a persistent TTY with no timeout, where a foreground server stays.
    const background = merged.server.startIn === 'background';
    const result = this.deps.actionRuns.start(
      {
        sourceId: entry.sourceId,
        sourceKind: 'worktree',
        label: `${ctx.name} · ${target.label}`,
        command: withEnv(target.command, env),
        cwd,
        mode: background ? 'background' : 'terminal',
        slot: WORKTREE_START_SLOT,
        ...(background ? { timeoutSec: BACKGROUND_START_TIMEOUT_SEC } : {}),
      },
      { persistent: !background },
    );
    if (!result.ok) return { alreadyRunning: true, runId: result.runningRunId, server: { ...entry.snapshot } };

    entry.launchPort = item?.port;
    entry.launchUrl = item?.url;
    entry.urlTemplate = merged.server.url;
    entry.probe = merged.server.probe?.command?.trim() ? merged.server.probe : undefined;
    entry.env = env;
    entry.cwd = cwd;
    entry.lastProbeAt = 0;
    entry.startedAt = this.nowMs();
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

  /**
   * Stop: the stop command (if any), then the start command's run is ended.
   * `interactive`: a terminal stop command is handed back at once (the user may
   * have to answer it in its terminal); the rest of the stop follows its end.
   */
  private async stop(path: string, resolved: Resolved, stopCommandWaitMs = 120_000, interactive = false): Promise<{ server: WorktreeServerSnapshot; run?: ActionRun }> {
    const { ctx, merged } = resolved;
    const reserved = await this.envFor(path, ctx, merged);
    const entry = await this.entryFor(path, merged, ctx);
    if (entry.snapshot.state === 'stopped') return { server: { ...entry.snapshot } };

    const stopCommand = merged.server.stop?.trim();
    if (stopCommand && entry.snapshot.state !== 'error') {
      const terminal = merged.server.stopIn === 'terminal';
      const res = this.deps.actionRuns.start({
        sourceId: entry.sourceId,
        sourceKind: 'worktree',
        label: `${ctx.name} · stop`,
        command: withEnv(stopCommand, { ...this.fleexEnv(ctx, entry.snapshot.port), ...reserved, ...(entry.snapshot.url ? { FLEEX_URL: entry.snapshot.url } : {}), ...endpointEnv(entry.snapshot.endpoints) }),
        cwd: path,
        mode: terminal ? 'terminal' : 'background',
        slot: WORKTREE_STOP_SLOT,
        timeoutSec: 120,
      });
      if (res.ok && terminal && interactive) {
        void this.waitForRun(res.run.runId, stopCommandWaitMs)
          .then(() => this.endStartRun(entry))
          .catch((err) => this.deps.logger.warn('Worktree stop failed', { path, error: String(err) }));
        return { server: { ...entry.snapshot }, run: res.run };
      }
      if (res.ok) await this.waitForRun(res.run.runId, stopCommandWaitMs);
    }
    return { server: await this.endStartRun(entry) };
  }

  /** Whatever the stop command did, the start command must not outlive Stop. */
  private async endStartRun(entry: ServerEntry): Promise<WorktreeServerSnapshot> {
    // Whatever the stop command did, the start command must not outlive Stop.
    // A start command that already handed back (`up -d`) only left its terminal behind.
    const runId = entry.snapshot.runId;
    if (runId && (await this.deps.actionRuns.cancel(runId))) {
      await this.waitForRun(runId, STOP_WAIT_MS);
    } else if (entry.snapshot.tmuxSession) {
      await this.deps.terminals.close(entry.snapshot.tmuxSession);
    }
    entry.lastProbeAt = this.nowMs(); // the next probe says whether the stop worked
    this.setState(entry, { state: 'stopped' });
    return { ...entry.snapshot };
  }

  private async runItem(path: string, { ctx, merged }: Resolved, item: WorktreeActionItem): Promise<WorktreeRunResponse> {
    const entry = this.entries.get(path);
    const port = entry?.snapshot.state === 'running' ? entry.snapshot.port : undefined;
    const env = {
      ...(await this.envFor(path, ctx, merged, port, item.autoPort)),
      ...(port && entry?.snapshot.url ? { FLEEX_URL: entry.snapshot.url } : {}),
      ...(entry?.snapshot.state === 'running' ? endpointEnv(entry.snapshot.endpoints) : {}),
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
    if (run.sourceKind === 'worktree' && run.slot === 'hook:setup') {
      const setup = [...this.setups.values()].find((s) => s.runId === run.runId);
      if (setup) {
        const failed = !!run.timedOut || (!run.cancelled && run.exitCode !== 0);
        this.recordSetup({ ...setup, state: failed ? 'failed' : 'ok', finishedAt: run.finishedAt ?? this.now().toISOString(), ...(failed ? { error: (run.stderr || run.stdout).slice(-2000) } : {}) });
      }
      return;
    }
    if (run.sourceKind !== 'worktree' || run.slot !== WORKTREE_START_SLOT) return;
    const entry = [...this.entries.values()].find((e) => e.sourceId === run.sourceId);
    if (!entry || entry.snapshot.runId !== run.runId) return;
    const failed = !run.cancelled && run.exitCode !== 0;
    const detached = entry.mode === 'detached' || (entry.mode === undefined && !!entry.probe);
    if (!failed && !run.cancelled && detached && !entry.probe) {
      // Detached without a probe: Fleex cannot check — it assumes the start worked.
      this.setState(entry, { state: 'running', runId: run.runId, ...(entry.snapshot.tmuxSession ? { tmuxSession: entry.snapshot.tmuxSession } : {}) });
      return;
    }
    if (!failed && !run.cancelled && detached) {
      // Handed back with 0 (`docker compose up -d`): the probe says whether it is up.
      const keep = { runId: run.runId, ...(entry.snapshot.tmuxSession ? { tmuxSession: entry.snapshot.tmuxSession } : {}) };
      this.setState(entry, entry.snapshot.state === 'running' ? { ...entry.snapshot, ...keep } : { state: 'starting', ...keep });
      entry.nextCheckAt = 0;
      this.schedule();
      return;
    }
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


  // ─── Settings: layers, share / keep for me ────────────────────────────────

  /**
   * Everything Settings › Actions et Hooks edits: both layers raw (to show
   * where each element lives), the merged view, the overlay files and the
   * file hooks. `path` null = the repo has no checkout: personal layer only.
   */
  async settings(repo: string, path: string | null): Promise<WorktreeSettingsResponse> {
    const [org, name] = repo.split('/') as [string, string];
    let shared: WorktreeConfig | null = null;
    let sharedConfigError: string | undefined;
    let view: WorktreeActionsView | undefined;
    if (path) {
      const resolved = await this.resolveFor(repo, path);
      shared = resolved.shared;
      sharedConfigError = resolved.sharedConfigError;
      view = await this.view(path);
    }
    const overlay = this.deps.overlay;
    const hooksDir = this.deps.resolver.overlayHooksDir(org, name);
    return {
      repo,
      path,
      personal: this.getPersonal(repo),
      shared,
      ...(sharedConfigError ? { sharedConfigError } : {}),
      ...(view ? { view } : {}),
      overlayFiles: overlay ? await overlay.listOverlayFilesRecursive(org, name) : [],
      fileHooks: {
        global: overlay ? await overlay.listHookScripts(this.deps.resolver.globalOverlayHooksDir()) : [],
        repo: overlay ? await overlay.listHookScripts(hooksDir) : [],
      },
      hooksDir,
      hookTimeoutSeconds: this.deps.config.get().repoConfigs?.[repo]?.hookTimeoutSeconds ?? DEFAULT_HOOK_TIMEOUT_SEC,
    };
  }

  /**
   * Write one key in one layer (undefined removes it). The shared layer is the
   * worktree's `.fleex/worktree.json`: Fleex writes it, never commits it.
   */
  async setKey(repo: string, path: string | null, layer: 'personal' | 'shared', key: WorktreeConfigKey, value: unknown): Promise<WorktreeSettingsResponse> {
    if (!isWorktreeConfigKey(key)) throw new WorktreeActionError(400, `Unknown config key "${key}"`);
    const clean = sanitizeKeyValue(key, value);
    if (layer === 'personal') {
      await this.updatePersonal(repo, (cfg) => setConfigKey(cfg, key, clean));
    } else {
      if (!path) throw new WorktreeActionError(400, 'The shared layer lives in a worktree: pass its path');
      const { shared } = await this.resolveFor(repo, path, true);
      await this.writeShared(path, setConfigKey(shared, key, clean));
    }
    return this.settings(repo, path);
  }

  /** "Partager": move keys from the personal layer into `.fleex/worktree.json`. */
  async share(path: string, keys: WorktreeConfigKey[]): Promise<{ moved: WorktreeConfigKey[]; file: string; settings: WorktreeSettingsResponse }> {
    const { ctx } = await this.resolve(path);
    if (!ctx.repo) throw new WorktreeActionError(400, 'This worktree has no resolvable repository (git remote)');
    const repo = ctx.repo;
    const { shared } = await this.resolveFor(repo, path, true);
    let nextShared = shared;
    let personal = this.getPersonal(repo);
    const moved: WorktreeConfigKey[] = [];
    for (const key of keys) {
      if (!isWorktreeConfigKey(key)) throw new WorktreeActionError(400, `Unknown config key "${key}"`);
      const value = getConfigKey(personal, key);
      if (value === undefined) continue;
      nextShared = setConfigKey(nextShared, key, value);
      personal = setConfigKey(personal, key, undefined);
      moved.push(key);
    }
    if (moved.length === 0) throw new WorktreeActionError(409, 'Nothing personal to share for these keys');
    await this.writeShared(path, nextShared ?? {});
    await this.updatePersonal(repo, () => personal);
    return { moved, file: join(path, SHARED_CONFIG_FILE), settings: await this.settings(repo, path) };
  }

  /**
   * "Garder pour moi": copy keys from `.fleex/worktree.json` into the personal
   * layer. With `removeFromFile` they also leave the file; otherwise the
   * personal copy just masks the team's.
   */
  async unshare(path: string, keys: WorktreeConfigKey[], removeFromFile: boolean): Promise<{ moved: WorktreeConfigKey[]; settings: WorktreeSettingsResponse }> {
    const { ctx } = await this.resolve(path);
    if (!ctx.repo) throw new WorktreeActionError(400, 'This worktree has no resolvable repository (git remote)');
    const repo = ctx.repo;
    const { shared } = await this.resolveFor(repo, path, true);
    let nextShared = shared;
    let personal = this.getPersonal(repo);
    const moved: WorktreeConfigKey[] = [];
    for (const key of keys) {
      if (!isWorktreeConfigKey(key)) throw new WorktreeActionError(400, `Unknown config key "${key}"`);
      const value = getConfigKey(shared, key);
      if (value === undefined) continue;
      personal = setConfigKey(personal, key, value);
      if (removeFromFile) nextShared = setConfigKey(nextShared, key, undefined);
      moved.push(key);
    }
    if (moved.length === 0) throw new WorktreeActionError(409, 'Nothing shared to keep for these keys');
    await this.updatePersonal(repo, () => personal);
    if (removeFromFile) await this.writeShared(path, nextShared ?? {});
    return { moved, settings: await this.settings(repo, path) };
  }

  // ─── Hooks ─────────────────────────────────────────────────────────────────

  /**
   * Run a hook now, in the action engine (output in the logs): "Tester dans le
   * worktree courant" (a draft `command`), or "Relancer le Setup" (file hooks,
   * then the inline script, like at creation).
   */
  async runHook(path: string, hook: WorktreeHook, command?: string): Promise<WorktreeRunResponse & { setup?: WorktreeSetupSnapshot }> {
    const { ctx, merged } = await this.resolve(path);
    const inline = (command ?? merged.hooks[hook] ?? '').trim();
    const parts: string[] = [];
    if (hook === 'setup' && command === undefined && this.deps.overlay && ctx.org) {
      const files = [
        ...(await this.deps.overlay.listHookScripts(this.deps.resolver.globalOverlayHooksDir())),
        ...(await this.deps.overlay.listHookScripts(this.deps.resolver.overlayHooksDir(ctx.org, ctx.name))),
      ];
      // Same as at creation: a failing file hook is reported, the next ones still run.
      for (const f of files) parts.push(`bash ${shellQuote(f)} || echo "hook failed: ${f.replace(/["$`\\]/g, '')}" >&2`);
    }
    if (inline) parts.push(interpolateHook(inline, { org: ctx.org ?? '', repo: ctx.name, branch: ctx.branch, worktreePath: path }));
    if (parts.length === 0) throw new WorktreeActionError(409, `No ${hook} hook configured for this worktree`);
    const env = await this.envFor(path, ctx, merged);
    const timeoutSec = this.hookTimeoutSec({ ctx, merged });
    const result = this.deps.actionRuns.start({
      sourceId: worktreeSourceId(path),
      sourceKind: 'worktree',
      label: `${ctx.name} · ${hook}${command !== undefined ? ' (test)' : ''}`,
      command: withEnv(parts.join('\n'), env),
      cwd: path,
      mode: 'background',
      slot: `hook:${hook}`,
      timeoutSec,
    });
    const server = this.entries.get(path)?.snapshot ?? this.blankSnapshot(path);
    if (!result.ok) return { alreadyRunning: true, runId: result.runningRunId, server: { ...server } };
    let setup: WorktreeSetupSnapshot | undefined;
    if (hook === 'setup') {
      setup = { path, state: 'running', startedAt: result.run.startedAt, runId: result.run.runId };
      this.recordSetup(setup);
    }
    return { runId: result.run.runId, run: result.run, server: { ...server }, ...(setup ? { setup } : {}) };
  }

  /**
   * Before `git worktree remove`: stop the worktree's server, then run its
   * Teardown hook, waiting at most its timeout. Never throws: removal goes on.
   */
  async teardown(path: string): Promise<void> {
    try {
      const resolved = await this.resolve(path);
      // entryFor, not the in-memory map: after a Fleex restart the server's tmux
      // session is only known once adopted, and it must not outlive its folder.
      const entry = await this.entryFor(path, resolved.merged, resolved.ctx);
      if (entry.snapshot.state !== 'stopped') await this.stop(path, resolved, TEARDOWN_STOP_COMMAND_MS).catch(() => {});
      const script = resolved.merged.hooks.teardown?.trim();
      if (script) {
        const res = await this.runHook(path, 'teardown');
        if (res.runId) {
          // Same timeout as the hook run itself (runHook), repo setting included.
          const timeoutSec = this.hookTimeoutSec(resolved);
          await this.waitForRun(res.runId, timeoutSec * 1000 + 2000);
          const run = this.deps.actionRuns.get(res.runId);
          if (run && (run.timedOut || (run.finishedAt && run.exitCode !== 0))) {
            this.deps.logger.warn('Teardown hook failed — removing the worktree anyway', { path, exitCode: run.exitCode, timedOut: run.timedOut });
          } else if (run && !run.finishedAt) {
            this.deps.logger.warn('Teardown hook still running at its timeout — removing the worktree anyway', { path });
            await this.deps.actionRuns.cancel(res.runId);
          }
        }
      }
    } catch (err) {
      this.deps.logger.warn('Teardown failed — removing the worktree anyway', { path, error: err instanceof Error ? err.message : String(err) });
    } finally {
      this.entries.delete(path);
      this.setups.delete(path);
      await this.releasePorts(path).catch(() => {});
    }
  }

  private hookTimeoutSec({ ctx, merged }: Pick<Resolved, 'ctx' | 'merged'>): number {
    return merged.hooks.timeoutSec ?? this.deps.config.get().repoConfigs?.[ctx.repo ?? '']?.hookTimeoutSeconds ?? DEFAULT_HOOK_TIMEOUT_SEC;
  }

  /** The repo's hooks folder (created if needed), opened in the host's file manager. */
  async openHooksDir(repo: string): Promise<{ dir: string }> {
    const [org, name] = repo.split('/') as [string, string];
    await this.deps.overlay?.ensureOverlayDirs(org, name);
    const dir = this.deps.resolver.overlayHooksDir(org, name);
    const q = shellQuote(dir);
    await this.deps.shell(`if command -v open >/dev/null 2>&1; then open ${q}; elif command -v xdg-open >/dev/null 2>&1; then xdg-open ${q}; fi`, { cwd: '/', timeoutMs: 5000 }).catch(() => null);
    return { dir };
  }

  /** OverlayManager's Setup progress at worktree creation. */
  recordSetup(snapshot: WorktreeSetupSnapshot): void {
    this.setups.set(snapshot.path, snapshot);
    this.deps.broadcast('worktree-setup:update', { ...snapshot });
  }

  /** Hook environment of a worktree from its reservation (for OverlayManager's creation-time Setup). */
  async reservedEnv(path: string): Promise<Record<string, string>> {
    try {
      const { ctx, merged } = await this.resolve(path);
      if (!merged.ports.reserve) return {};
      return this.envFor(path, ctx, merged);
    } catch {
      return {};
    }
  }

  // ─── Ports ─────────────────────────────────────────────────────────────────

  /** The worktree's reserved range start, allocated on first need, stable across restarts. */
  private async allocatePorts(path: string): Promise<number> {
    const all = this.deps.config.get().worktreePorts ?? {};
    if (all[path]) return all[path]!;
    const taken = new Set(Object.values(all));
    let base = PORT_RANGE_BASE;
    while (taken.has(base)) base += PORT_RANGE_SLOT;
    await this.deps.config.update({ worktreePorts: { ...all, [path]: base } });
    return base;
  }

  private async releasePorts(path: string): Promise<void> {
    const all = this.deps.config.get().worktreePorts;
    if (!all?.[path]) return;
    const { [path]: _gone, ...rest } = all;
    await this.deps.config.update({ worktreePorts: rest });
  }

  /**
   * FLEEX_* for a command: the reserved range when reservation is on (and
   * `PORT` too for a launch.json configuration with `autoPort`), else the
   * port that is known (detected, or launch.json's).
   */
  private async envFor(path: string, ctx: WorktreeContext, merged: MergedWorktree, knownPort?: number, autoPort?: boolean): Promise<Record<string, string>> {
    if (!merged.ports.reserve) return this.fleexEnv(ctx, knownPort);
    const base = await this.allocatePorts(path);
    return {
      ...buildFleexEnv({ ...this.envContext(ctx), port: base, portCount: merged.ports.count }),
      ...(autoPort ? { PORT: String(base) } : {}),
    };
  }

  private async writeShared(path: string, config: WorktreeConfig): Promise<void> {
    const file = join(path, SHARED_CONFIG_FILE);
    const { version: _v, ...rest } = config;
    await this.deps.hostFs.mkdir(join(path, '.fleex'));
    // Stable formatting, version first: diffs stay readable in review.
    await this.deps.hostFs.writeFile(file, `${JSON.stringify({ version: 1, ...rest }, null, 2)}\n`);
    this.fileCache.delete(file);
    this.deps.logger.info('Wrote shared worktree config', { file });
  }

  /** Resolve a worktree that must belong to `repo`; `strict` refuses a broken shared file (it would be overwritten). */
  private async resolveFor(repo: string, path: string, strict = false): Promise<Resolved> {
    const resolved = await this.resolve(path);
    if (resolved.ctx.repo !== repo) throw new WorktreeActionError(400, `${path} is not a worktree of ${repo}`);
    if (strict && resolved.sharedConfigError) throw new WorktreeActionError(409, `${resolved.sharedConfigError} — fix the file first, Fleex will not overwrite it`);
    return resolved;
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  private async resolve(path: string): Promise<Resolved> {
    const ctx = await this.context(path);
    const personal = (ctx.repo ? this.deps.config.get().worktreeConfigs?.[ctx.repo] : undefined) ?? {};
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
    return { ctx, personal, shared: shared ?? null, merged: mergeWorktreeConfig({ personal, shared, launch, detected }), ...(sharedConfigError ? { sharedConfigError } : {}) };
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

  private envContext(ctx: WorktreeContext) {
    return {
      worktreePath: ctx.path,
      ...(ctx.repo ? { repo: ctx.repo, repoPath: this.deps.resolver.barePath(ctx.org!, ctx.name) } : {}),
      ...(ctx.workspacePath ? { workspacePath: ctx.workspacePath } : {}),
      ...(ctx.branch ? { branch: ctx.branch } : {}),
      ...(ctx.ticketId ? { ticketId: ctx.ticketId } : {}),
    };
  }

  private fleexEnv(ctx: WorktreeContext, port?: number): Record<string, string> {
    return buildFleexEnv({ ...this.envContext(ctx), ...(port ? { port } : {}) });
  }

  /**
   * The worktree's server entry. Created on first sight — and if a start
   * session of a previous Fleex run is still alive, it is adopted as starting
   * (the next check finds its port). Its probe and URL follow the settings, so
   * a probe saved later is picked up on the next read.
   */
  private async entryFor(path: string, merged: MergedWorktree, ctx: WorktreeContext): Promise<ServerEntry> {
    const entry = this.entries.get(path) ?? (await this.createEntry(path, merged));
    const probe = merged.server.probe?.command?.trim() ? merged.server.probe : undefined;
    if (probe?.command !== entry.probe?.command || probe?.intervalSec !== entry.probe?.intervalSec) entry.lastProbeAt = 0;
    entry.probe = probe;
    entry.mode = merged.server.mode;
    entry.urlTemplate = merged.server.url;
    // A server Fleex did not start still gets the worktree's FLEEX_* env in its probe.
    if (probe && Object.keys(entry.env).length === 0) entry.env = await this.envFor(path, ctx, merged);
    this.schedule();
    return entry;
  }

  private async createEntry(path: string, merged: MergedWorktree): Promise<ServerEntry> {
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
      ...(merged.server.mode ? { mode: merged.server.mode } : {}),
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
    const changed = (['state', 'port', 'url', 'runId', 'tmuxSession', 'exitCode'] as const).some((k) => snapshot[k] !== prev[k])
      || JSON.stringify(snapshot.endpoints) !== JSON.stringify(prev.endpoints);
    if (!changed) return;
    snapshot.updatedAt = this.now().toISOString();
    entry.snapshot = snapshot;
    this.deps.broadcast('worktree-server:update', { ...snapshot });
  }

  /**
   * One look at a server: process alive? port? probe? Without a probe only a
   * starting or running server is looked at; with one, every state is.
   */
  private async check(entry: ServerEntry, force = false): Promise<void> {
    const { state, tmuxSession, runId } = entry.snapshot;
    const live = state === 'starting' || state === 'running';
    if (!live && !entry.probe) return;
    if (entry.checking || (!force && this.nowMs() < entry.nextCheckAt)) return;
    entry.checking = true;
    try {
      let ports: number[] = [];
      let processAlive = false;
      if (live && tmuxSession) {
        const seen = await this.deps.terminals.inspect(tmuxSession);
        if (seen.alive && !seen.dead) {
          processAlive = true;
          ports = seen.ports;
        } else if (!entry.probe || (seen.dead && seen.exitStatus)) {
          // With a run in flight, its end is reported by onRunFinished; an adopted one has no run.
          if (!runId) {
            this.setState(entry, seen.dead && seen.exitStatus ? { state: 'error', exitCode: seen.exitStatus, tmuxSession } : { state: 'stopped' });
          }
          return;
        }
        // else: the start command handed back with 0 — the probe decides.
      }
      let port = entry.launchPort && ports.includes(entry.launchPort) ? entry.launchPort : ports[0];
      if (!port && live && entry.launchPort && (await this.listening(entry.launchPort))) port = entry.launchPort;
      let up = !!port;
      const keep = { ...(runId ? { runId } : {}), ...(tmuxSession ? { tmuxSession } : {}) };

      if (entry.probe) {
        const intervalMs = Math.max(5, entry.probe.intervalSec ?? 30) * 1000;
        if (force || state === 'starting' || entry.lastProbeAt === 0 || this.nowMs() - entry.lastProbeAt >= intervalMs) {
          entry.lastProbeAt = this.nowMs();
          const url = this.urlFor(entry, port);
          const res = await this.deps.shell(withEnv(entry.probe.command, { ...entry.env, ...(port ? { FLEEX_PORT: String(port) } : {}), ...(url ? { FLEEX_URL: url } : {}), ...endpointEnv(entry.probeEndpoints) }), { cwd: entry.cwd, timeoutMs: PROBE_TIMEOUT_MS }).catch(() => ({ exitCode: 1, stdout: '' }));
          // Exit code = running or not; stdout may name the endpoints (else ignored, detection stays).
          entry.probeEndpoints = res.exitCode === 0 ? parseProbeEndpoints(res.stdout) : undefined;
          if (res.exitCode === 0) up = true;
          else if (state === 'running') {
            // Still our process: it is unhealthy. Nothing of ours alive: it was stopped.
            this.setState(entry, processAlive ? { state: 'error', ...keep } : { state: 'stopped' });
            return;
          } else if (!live) {
            return; // stopped or error, and still down
          }
        } else if (state === 'running') {
          up = true; // between two probes, a running server stays running
        } else if (!live) {
          return;
        }
      }

      if (up) {
        const endpoints = entry.probe ? entry.probeEndpoints : undefined;
        if (endpoints) {
          // The probe knows better than the process tree (detached servers, several services).
          const primary = endpoints[0]!;
          this.setState(entry, { state: 'running', ...keep, ...(primary.port ? { port: primary.port } : {}), url: primary.url, endpoints });
          return;
        }
        const url = this.urlFor(entry, port);
        this.setState(entry, { state: 'running', ...keep, ...(port ? { port } : {}), ...(url ? { url } : {}) });
      } else if (!processAlive && entry.startedAt !== undefined && this.nowMs() - entry.startedAt >= DETACHED_START_TIMEOUT_MS) {
        this.setState(entry, { state: 'error', ...keep });
      } else {
        this.setState(entry, { state: 'starting', ...keep });
      }
    } finally {
      entry.checking = false;
      const s = entry.snapshot.state;
      entry.nextCheckAt = this.nowMs() + (s === 'running' ? RUNNING_CHECK_MS : s === 'starting' ? STARTING_CHECK_MS : Math.max(5, entry.probe?.intervalSec ?? 30) * 1000);
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

  /** One timer for every watched server: starting, running, or with a probe. */
  private schedule(): void {
    if (this.timer !== null) return;
    const live = [...this.entries.values()].some((e) => e.probe || e.snapshot.state === 'starting' || e.snapshot.state === 'running');
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
 * Move each repo's legacy `postCheckoutHook` into the personal layer's
 * `hooks.setup` (PRD D6): copied when no setup is set yet (even '' wins), then
 * cleared from `repoConfigs` in every case. Clearing it is what keeps a Setup
 * emptied or shared later from being brought back by the next start, or run
 * as a fallback at worktree creation.
 * Returns both maps when something changed, else null.
 */
export function migrateLegacySetupHooks(
  config: Pick<AppConfig, 'repoConfigs' | 'worktreeConfigs'>,
): { worktreeConfigs: NonNullable<AppConfig['worktreeConfigs']>; repoConfigs: NonNullable<AppConfig['repoConfigs']> } | null {
  const worktreeConfigs = { ...(config.worktreeConfigs ?? {}) };
  const repoConfigs = { ...(config.repoConfigs ?? {}) };
  let changed = false;
  for (const [repo, repoConfig] of Object.entries(config.repoConfigs ?? {})) {
    if (!repoConfig || repoConfig.postCheckoutHook === undefined) continue;
    const legacy = repoConfig.postCheckoutHook;
    if (legacy.trim() && worktreeConfigs[repo]?.hooks?.setup === undefined) {
      worktreeConfigs[repo] = { ...(worktreeConfigs[repo] ?? {}), hooks: { ...(worktreeConfigs[repo]?.hooks ?? {}), setup: legacy } };
    }
    const { postCheckoutHook: _dropped, ...rest } = repoConfig;
    repoConfigs[repo] = rest;
    changed = true;
  }
  return changed ? { worktreeConfigs, repoConfigs } : null;
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

const STATES = new Set(['stopped', 'starting', 'running', 'error']);
const SOURCES = new Set(['launch', 'npm', 'make', 'composer']);

/**
 * Validate a value before it is written into a layer: what the settings
 * screen, the CLI or a hand-made request may send. Throws a 400 on junk.
 */
export function sanitizeKeyValue(key: WorktreeConfigKey, value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  const bad = (why: string): never => {
    throw new WorktreeActionError(400, `Invalid value for ${key}: ${why}`);
  };
  const str = (v: unknown, max = 20_000) => (typeof v === 'string' && v.length <= max ? v : bad('expected a string'));
  const [kind] = key.split(':');
  if (kind === 'pin' || kind === 'hide') return value === true ? true : bad('expected true');
  if (kind === 'action') {
    const v = value as Record<string, unknown>;
    if (typeof v !== 'object' || Array.isArray(v)) bad('expected an object');
    const out: Record<string, unknown> = { cmd: str(v['cmd']) };
    if (v['label'] !== undefined) out['label'] = str(v['label'], 200);
    if (v['mode'] !== undefined) out['mode'] = v['mode'] === 'terminal' ? 'terminal' : v['mode'] === 'background' ? 'background' : bad('mode');
    if (v['when'] !== undefined) {
      if (!Array.isArray(v['when']) || !v['when'].every((x) => STATES.has(x as string))) bad('when');
      if ((v['when'] as unknown[]).length) out['when'] = v['when'];
    }
    if (v['hidden'] === true) out['hidden'] = true;
    return out;
  }
  switch (key) {
    case 'hooks.setup':
    case 'hooks.teardown':
      return str(value);
    case 'server.mode':
      return value === 'foreground' || value === 'detached' ? value : bad('expected foreground | detached');
    case 'server.startIn':
    case 'server.stopIn':
      return value === 'background' || value === 'terminal' ? value : bad('expected background | terminal');
    case 'server.start':
    case 'server.logs':
    case 'server.stop':
    case 'server.url': {
      const v = str(value, 4000).trim();
      return v || undefined;
    }
    case 'hooks.timeoutSec': {
      const n = Number(value);
      return Number.isFinite(n) && n > 0 ? Math.min(3600, Math.round(n)) : bad('expected seconds > 0');
    }
    case 'server.probe': {
      const v = value as Record<string, unknown>;
      const command = str(v?.['command'], 4000).trim();
      if (!command) return undefined;
      const interval = Number(v['intervalSec']);
      return { command, ...(Number.isFinite(interval) && interval > 0 ? { intervalSec: Math.max(5, Math.round(interval)) } : {}) };
    }
    case 'server.clickByState': {
      const v = value as Record<string, unknown>;
      if (typeof v !== 'object' || Array.isArray(v)) bad('expected an object');
      const out = Object.fromEntries(Object.entries(v).filter(([s, c]) => STATES.has(s) && typeof c === 'string' && c.length <= 200));
      return Object.keys(out).length ? out : undefined;
    }
    case 'discovery.sources': {
      if (!Array.isArray(value) || !value.every((x) => SOURCES.has(x as string))) bad('expected launch | npm | make | composer');
      return value;
    }
    case 'ports': {
      const v = value as Record<string, unknown>;
      const count = Number(v?.['count']);
      return { reserve: v?.['reserve'] === true, ...(Number.isFinite(count) && count > 0 ? { count: Math.min(20, Math.round(count)) } : {}) };
    }
    default:
      return bad('unknown key');
  }
}
