import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { die, isJsonMode, c } from './colors.ts';
import { defaultWorkspaceName } from './workspaces.ts';
import { getSelectedWorkspace, type WorkspaceSource } from './workspace-selection.ts';

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
  /** How {@link workspace} was chosen — see {@link resolveWorkspaceSelection}. */
  workspaceSource: WorkspaceSource;
  /** Git branch the repo is on (or "default"). */
  branch: string;
}

let cached: InstanceContext | null = null;

export interface WorkspaceSelection {
  /** The resolved workspace name, or null in legacy mode (no workspaces.json). */
  workspace: string | null;
  source: WorkspaceSource;
}

/**
 * Resolve which workspace this process targets, and how the choice was made.
 *
 * Precedence (documented, MCP/desktop rely on it — like `AWS_PROFILE`):
 *   1. an explicit activation — a `--workspace` flag or a resolved default,
 *      recorded by {@link activateWorkspace} (see workspace-selection.ts);
 *   2. an ambient `FLEEX_WORKSPACE` env var (inherited from the shell / a
 *      parent process such as the MCP server);
 *   3. the single `is_default` workspace from workspaces.json;
 *   4. legacy mode — no workspaces.json — yielding a branch-only slug.
 *
 * Pure (no caching): safe to call for the slug and, separately, for diagnostics.
 */
export function resolveWorkspaceSelection(): WorkspaceSelection {
  const sel = getSelectedWorkspace();
  if (sel) return { workspace: sel.name, source: sel.source };

  const env = process.env.FLEEX_WORKSPACE;
  if (env && env.trim() !== '') return { workspace: env.trim(), source: 'env' };

  const def = defaultWorkspaceName();
  if (def) return { workspace: def, source: 'default' };

  return { workspace: null, source: 'legacy' };
}

/**
 * Breadcrumb text shown (dim, on stderr, human mode only) when the targeted
 * workspace comes from an ambient `FLEEX_WORKSPACE` — *not* a `--workspace` flag
 * — AND differs from the configured default. This makes an inherited env var
 * impossible to miss, even when the command succeeds, so it can never silently
 * steer the CLI to another instance unnoticed. Returns null when there is
 * nothing worth warning about. Pure (returns the string, caller does the I/O).
 */
export function ambientWorkspaceWarning(sel: WorkspaceSelection): string | null {
  if (sel.source !== 'env') return null;
  const def = defaultWorkspaceName();
  if (!def || def === sel.workspace) return null;
  return `[fleex] workspace: ${sel.workspace} (from $FLEEX_WORKSPACE, not the default '${def}') — pass --workspace to override`;
}

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

  // Resolve which workspace this process targets — and how the choice was made —
  // via the single source of truth (see resolveWorkspaceSelection). This honours
  // an explicit --workspace / resolved default first, then an ambient
  // FLEEX_WORKSPACE, then the is_default workspace, then legacy branch-only mode.
  const { workspace, source } = resolveWorkspaceSelection();
  const slug = instanceSlug(workspace, branchName);

  // Breadcrumb (once, human mode only): if the target came from an *inherited*
  // FLEEX_WORKSPACE that differs from the configured default, say so on stderr so
  // a stale env var can never silently steer commands to another instance.
  if (!isJsonMode()) {
    const warning = ambientWorkspaceWarning({ workspace, source });
    if (warning) process.stderr.write(c.dim(warning) + '\n');
  }

  cached = {
    repoDir,
    instanceSlug: slug,
    instanceRun: path.join(FLEEX_HOME, '.run', slug),
    instanceLog: path.join(FLEEX_HOME, '.logs', slug),
    portsFile: path.join(FLEEX_HOME, '.run', slug, 'ports.json'),
    workspace,
    workspaceSource: source,
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
