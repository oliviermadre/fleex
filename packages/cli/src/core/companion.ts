/**
 * Lifecycle for the side-panel companion (`@fleex/sidepanel-host`) — the local
 * backend the Chrome extension talks to over `ws://localhost:4399`.
 *
 * Unlike the per-instance stack (gateway/server/web), the companion is a
 * **machine-wide singleton**: one process on a fixed port serves *every*
 * workspace (each conversation carries its own `--workspace`). So its PID/log
 * live at the top of `~/.fleex/.run|.logs`, not under an instance slug, and it
 * is started idempotently — never one-per-instance.
 *
 * Source of truth: the companion always runs from `~/.fleex/repo` (the canonical
 * installed sources), not whatever worktree happens to be the cwd, so a singleton
 * shared by all instances can't be pinned to one branch's checkout. Override with
 * FLEEX_COMPANION_REPO for companion development; if the canonical repo isn't
 * installed (pure dev checkout) we fall back to the current repo so it still boots.
 */
import fs from 'node:fs';
import path from 'node:path';
import { FLEEX_HOME, DEFAULT_REPO_DIR, resolveInstance } from './instance.ts';
import { parseDotEnv } from './env.ts';
import { isAlive, killGroup, killTree, killByPort, sleep } from './process.ts';

/** Fixed port the extension hard-codes; overridable for tests/parallel hosts. */
export const COMPANION_PORT = Number(process.env.FLEEX_SIDEPANEL_PORT ?? 4399);

/** dotenv-style config file holding ANTHROPIC_API_KEY (and any other host env). */
export function companionConfigFile(): string {
  return path.join(FLEEX_HOME, 'config');
}

export function companionPidFile(): string {
  return path.join(FLEEX_HOME, '.run', 'companion.pid');
}

export function companionLogFile(): string {
  return path.join(FLEEX_HOME, '.logs', 'companion.log');
}

/**
 * Resolve the repo the companion runs from. Canonical install (`~/.fleex/repo`)
 * wins; FLEEX_COMPANION_REPO overrides; a pure dev checkout (no install) falls
 * back to the current repo so the companion still launches.
 */
export function companionRepoDir(): string {
  const override = process.env.FLEEX_COMPANION_REPO;
  if (override) return override;
  if (fs.existsSync(path.join(DEFAULT_REPO_DIR, 'packages/sidepanel-host'))) {
    return DEFAULT_REPO_DIR;
  }
  return resolveInstance().repoDir;
}

/** Read `~/.fleex/config` (dotenv). Missing file → empty. */
export function loadCompanionConfig(file: string = companionConfigFile()): Record<string, string> {
  return parseDotEnv(file);
}

export interface CompanionLaunch {
  bin: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

export interface CompanionLaunchContext {
  repoDir: string;
  /** Runtime used to launch the server (and, by default, to execute tools). */
  execPath: string;
  /** Live process env (wins over the config file). */
  baseEnv: NodeJS.ProcessEnv;
  /** Parsed `~/.fleex/config` (supplies ANTHROPIC_API_KEY etc. as defaults). */
  configEnv: Record<string, string>;
}

/**
 * Pure builder for the companion launch (env + argv), so the wiring is unit
 * testable without spawning. The config file provides defaults; the live shell
 * env wins over it. Tool execution is pinned to the same repo's CLI so the
 * exposed tool surface and the executed code never drift.
 */
export function buildCompanionLaunch(ctx: CompanionLaunchContext): CompanionLaunch {
  const serverPath = path.join(ctx.repoDir, 'packages/sidepanel-host/src/server.ts');
  const cliEntry = path.join(ctx.repoDir, 'packages/cli/index.ts');

  const env: Record<string, string> = {};
  // config file first (defaults), then the live env overrides it.
  for (const [k, v] of Object.entries(ctx.configEnv)) env[k] = v;
  for (const [k, v] of Object.entries(ctx.baseEnv)) if (v !== undefined) env[k] = v;

  // Re-invoke THIS repo's CLI for every tool call (flag > env > default).
  env.FLEEX_MCP_BIN = ctx.baseEnv.FLEEX_MCP_BIN ?? ctx.execPath;
  env.FLEEX_MCP_PREFIX = ctx.baseEnv.FLEEX_MCP_PREFIX ?? `run ${cliEntry}`;

  return { bin: ctx.execPath, args: [serverPath], cwd: ctx.repoDir, env };
}

/** True if the companion answers /health on `port`. */
export async function isCompanionHealthy(port: number = COMPANION_PORT, timeoutMs = 1500): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`http://localhost:${port}/health`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

export function readCompanionPid(): number | null {
  const p = companionPidFile();
  if (!fs.existsSync(p)) return null;
  try {
    const v = parseInt(fs.readFileSync(p, 'utf8').trim(), 10);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/** Running if a tracked PID is alive, or something is healthy on the port. */
export async function isCompanionRunning(): Promise<boolean> {
  const pid = readCompanionPid();
  if (pid !== null && isAlive(pid)) return true;
  return isCompanionHealthy();
}

/** Stop the singleton companion. Returns true if anything was killed. */
export async function stopCompanion(): Promise<boolean> {
  let stopped = false;
  const pid = readCompanionPid();
  if (pid !== null && isAlive(pid)) {
    killGroup(pid, 'SIGTERM');
    killTree(pid, 'SIGTERM');
    await sleep(200);
    if (isAlive(pid)) {
      killGroup(pid, 'SIGKILL');
      killTree(pid, 'SIGKILL');
    }
    stopped = true;
  }
  // Defense in depth: reap anything still bound to the fixed port.
  const reaped = killByPort(COMPANION_PORT);
  if (reaped.length > 0) stopped = true;
  try {
    fs.unlinkSync(companionPidFile());
  } catch {
    /* ignore */
  }
  return stopped;
}

/** How many fleex stack instances have at least one live service. */
export function countRunningInstances(): number {
  const runBase = path.join(FLEEX_HOME, '.run');
  let count = 0;
  let entries: string[];
  try {
    entries = fs.readdirSync(runBase);
  } catch {
    return 0;
  }
  for (const slug of entries) {
    const dir = path.join(runBase, slug);
    let isDir = false;
    try {
      isDir = fs.statSync(dir).isDirectory();
    } catch {
      isDir = false;
    }
    if (!isDir) continue; // skip companion.pid and other top-level files
    let alive = false;
    for (const svc of ['gateway', 'server', 'web']) {
      const pf = path.join(dir, `${svc}.pid`);
      if (!fs.existsSync(pf)) continue;
      try {
        const p = parseInt(fs.readFileSync(pf, 'utf8').trim(), 10);
        if (Number.isFinite(p) && isAlive(p)) {
          alive = true;
          break;
        }
      } catch {
        /* ignore */
      }
    }
    if (alive) count += 1;
  }
  return count;
}
