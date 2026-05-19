import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { die } from './colors.ts';

export const FLEEX_HOME = process.env.FLEEX_HOME ?? path.join(os.homedir(), '.fleex');
export const DEFAULT_REPO_DIR = path.join(FLEEX_HOME, 'repo');

export interface InstanceContext {
  repoDir: string;
  instanceSlug: string;
  instanceRun: string;
  instanceLog: string;
  portsFile: string;
}

let cached: InstanceContext | null = null;

/** Lowercase slug suitable for filesystem use. */
function slugify(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]/g, '-');
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
  const branchName = branch.status === 0 ? branch.stdout.trim() : 'default';
  const slug = slugify(branchName || 'default');

  cached = {
    repoDir,
    instanceSlug: slug,
    instanceRun: path.join(FLEEX_HOME, '.run', slug),
    instanceLog: path.join(FLEEX_HOME, '.logs', slug),
    portsFile: path.join(FLEEX_HOME, '.run', slug, 'ports.json'),
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
