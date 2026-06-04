import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { die } from './colors.ts';
import { defaultWorkspaceName } from './workspaces.ts';

export const FLEEX_HOME = process.env.FLEEX_HOME ?? path.join(os.homedir(), '.fleex');
export const DEFAULT_REPO_DIR = path.join(FLEEX_HOME, 'repo');

export interface InstanceContext {
  repoDir: string;
  instanceSlug: string;
  instanceRun: string;
  instanceLog: string;
  portsFile: string;
  /** Active workspace name, or null in legacy (branch-only) mode. */
  workspace: string | null;
  /** Git branch the repo is on (or "default"). */
  branch: string;
}

let cached: InstanceContext | null = null;

/** Slug suitable for filesystem use. */
export function slugify(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]/g, '-');
}

/**
 * Compute the instance slug. When a workspace is active the slug is
 * `workspace@branch` so that the same branch can run under different workspaces
 * (and the same workspace across different worktrees) without colliding on
 * ports/pids/logs. In legacy mode (no workspace) it is just the slugified
 * branch — preserving historical behaviour.
 */
export function instanceSlug(workspace: string | null, branch: string): string {
  const branchSlug = slugify(branch || 'default');
  return workspace ? `${slugify(workspace)}@${branchSlug}` : branchSlug;
}

/**
 * Resolve the current instance context.
 *
 * If CWD is inside a git worktree containing packages/server and packages/web,
 * use that toplevel as the repo. Otherwise fall back to ~/.fleex/repo.
 *
 * The instance slug is derived from the branch name of the resolved repo
 * (or "default" if not on a branch).
 */
export function resolveInstance(): InstanceContext {
  if (cached) return cached;

  let repoDir: string;
  const top = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const gitTop = top.status === 0 ? top.stdout.trim() : '';

  if (
    gitTop &&
    fs.existsSync(path.join(gitTop, 'packages/server')) &&
    fs.existsSync(path.join(gitTop, 'packages/web'))
  ) {
    repoDir = gitTop;
  } else {
    repoDir = DEFAULT_REPO_DIR;
  }

  const branch = spawnSync('git', ['-C', repoDir, 'rev-parse', '--abbrev-ref', 'HEAD'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const branchName = (branch.status === 0 ? branch.stdout.trim() : 'default') || 'default';

  // FLEEX_WORKSPACE is set by activateWorkspace() before the first call here.
  // When it isn't (e.g. read-only commands that never activate a workspace),
  // fall back to the single default workspace so the slug resolves to the
  // running `default@branch` instance instead of the branch-only legacy slug.
  const wsEnv = process.env.FLEEX_WORKSPACE;
  const workspace = wsEnv && wsEnv.trim() !== '' ? wsEnv : defaultWorkspaceName();
  const slug = instanceSlug(workspace, branchName);

  cached = {
    repoDir,
    instanceSlug: slug,
    instanceRun: path.join(FLEEX_HOME, '.run', slug),
    instanceLog: path.join(FLEEX_HOME, '.logs', slug),
    portsFile: path.join(FLEEX_HOME, '.run', slug, 'ports.json'),
    workspace,
    branch: branchName,
  };
  return cached;
}

export function ensureDirs(ctx: InstanceContext = resolveInstance()): void {
  fs.mkdirSync(ctx.instanceRun, { recursive: true });
  fs.mkdirSync(ctx.instanceLog, { recursive: true });
}

export function checkRepo(ctx: InstanceContext = resolveInstance()): void {
  if (!fs.existsSync(path.join(ctx.repoDir, 'packages'))) {
    die(`Repo not found at ${ctx.repoDir}. Run the installer or cd into a worktree.`);
  }
}

export function pidFile(svc: string, ctx: InstanceContext = resolveInstance()): string {
  return path.join(ctx.instanceRun, `${svc}.pid`);
}

export function logFile(svc: string, ctx: InstanceContext = resolveInstance()): string {
  return path.join(ctx.instanceLog, `${svc}.log`);
}

/** Per-instance metadata persisted at start, surfaced by `fleex status`. */
export interface InstanceMeta {
  workspace: string | null;
  branch: string;
  driver: string;
  startedAt: string;
}

export function metaFile(ctx: InstanceContext = resolveInstance()): string {
  return path.join(ctx.instanceRun, 'meta.json');
}

/** Write the instance metadata. Best-effort: never throws. */
export function writeInstanceMeta(meta: InstanceMeta, ctx: InstanceContext = resolveInstance()): void {
  try {
    fs.writeFileSync(metaFile(ctx), JSON.stringify(meta));
  } catch {
    // metadata is advisory; failing to write it must not break `start`.
  }
}

/** Read the instance metadata stored in a given run directory, or null. */
export function readInstanceMetaAt(runDir: string): InstanceMeta | null {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(runDir, 'meta.json'), 'utf8'));
    if (j && typeof j === 'object') return j as InstanceMeta;
    return null;
  } catch {
    return null;
  }
}
