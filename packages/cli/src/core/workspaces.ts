import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseDotEnv, applyEnv } from './env.ts';
import { warn, die, err } from './colors.ts';
import { runRules, makeRuleContext } from './workspaces-validation.ts';

/**
 * A workspace is a named, isolated configuration context. Its `env` block is
 * injected into the environment of every service started for that workspace,
 * overriding both the shell and the repo .env.
 *
 * `basePath` is the worktree/repository root for this workspace — first-class
 * (not a secret, so it lives alongside `name`/`is_default`, not in `env`). It is
 * the source of truth for the server's `repositoriesBasePath`: on activation it
 * is injected as `FLEEX_REPOSITORIES_BASE_PATH`, overriding the DB config. Two
 * workspaces must not share the same basePath (else their sessions collide on
 * the cwd-routed hook fan-out).
 */
export interface Workspace {
  name: string;
  is_default: boolean;
  env: Record<string, string>;
  basePath?: string;
}

/** Env var that carries a workspace's basePath to the server (overrides DB config). */
export const BASE_PATH_ENV = 'FLEEX_REPOSITORIES_BASE_PATH';

interface WorkspacesFile {
  workspaces: unknown;
}

/** Resolve ~/.fleex at call time so tests can override FLEEX_HOME. */
function fleexHome(): string {
  return process.env.FLEEX_HOME ?? path.join(os.homedir(), '.fleex');
}

/** Absolute path to the global workspaces config file. */
export function workspacesFilePath(): string {
  return path.join(fleexHome(), 'workspaces.json');
}

/**
 * Read and validate the workspaces config.
 *
 * Returns `null` when the file is absent (legacy mode — the caller falls back
 * to .env + branch-based instance identity). Throws an Error with a
 * human-readable message when the file exists but is corrupt (invalid JSON,
 * missing `workspaces` array, missing name, duplicate name, invalid env).
 */
export function parseWorkspacesFile(filePath: string = workspacesFilePath()): Workspace[] | null {
  if (!fs.existsSync(filePath)) return null;

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    throw new Error(`Cannot read ${filePath}: ${e instanceof Error ? e.message : String(e)}`);
  }

  let data: WorkspacesFile;
  try {
    data = JSON.parse(raw) as WorkspacesFile;
  } catch {
    throw new Error(`${filePath} is not valid JSON.`);
  }

  const list = (data as WorkspacesFile)?.workspaces;
  if (!Array.isArray(list)) {
    throw new Error(`${filePath} must contain a "workspaces" array.`);
  }

  const seen = new Set<string>();
  const result: Workspace[] = [];
  for (const entry of list) {
    const w = entry as Partial<Workspace> & { env?: unknown; basePath?: unknown };
    if (!w || typeof w.name !== 'string' || w.name.trim() === '') {
      throw new Error(`workspaces.json: every workspace needs a non-empty "name".`);
    }
    if (w.env != null && (typeof w.env !== 'object' || Array.isArray(w.env))) {
      throw new Error(`workspaces.json: workspace '${w.name}' has an invalid "env" (must be an object).`);
    }
    if (w.basePath != null && (typeof w.basePath !== 'string' || w.basePath.trim() === '')) {
      throw new Error(`workspaces.json: workspace '${w.name}' has an invalid "basePath" (must be a non-empty string).`);
    }
    if (seen.has(w.name)) {
      throw new Error(`workspaces.json is corrupt: duplicate workspace name '${w.name}'.`);
    }
    seen.add(w.name);
    result.push({
      name: w.name,
      is_default: w.is_default === true,
      env: (w.env ?? {}) as Record<string, string>,
      ...(typeof w.basePath === 'string' ? { basePath: w.basePath } : {}),
    });
  }
  return result;
}

/** Convenience wrapper around {@link parseWorkspacesFile}. */
export function readWorkspaces(filePath?: string): Workspace[] | null {
  return parseWorkspacesFile(filePath);
}

/**
 * Resolve a single workspace from a parsed list.
 *
 * - `name` given → that workspace, or throws if unknown.
 * - no `name` → the workspace flagged `is_default`. Throws if there are zero or
 *   more than one default (the latter being a corrupt config).
 */
export function resolveWorkspace(workspaces: Workspace[], name?: string): Workspace {
  if (name !== undefined) {
    const found = workspaces.find((w) => w.name === name);
    if (!found) {
      const avail = workspaces.map((w) => w.name).join(', ') || '(none)';
      throw new Error(`workspace '${name}' not found — available: ${avail}`);
    }
    return found;
  }

  const defaults = workspaces.filter((w) => w.is_default);
  if (defaults.length > 1) {
    throw new Error(
      `workspaces.json is corrupt: only one default workspace is allowed (found: ${defaults
        .map((w) => w.name)
        .join(', ')}).`,
    );
  }
  if (defaults.length === 0) {
    const avail = workspaces.map((w) => w.name).join(', ') || '(none)';
    throw new Error(
      `No default workspace defined. Pass --workspace <name> or set "is_default": true on one workspace. Available: ${avail}`,
    );
  }
  return defaults[0]!;
}

/**
 * Validate the global workspaces config WITHOUT activating anything.
 *
 * Structural validity is delegated to {@link parseWorkspacesFile} (JSON shape,
 * unique non-empty names, env/basePath types). The higher-level invariants live
 * in the extensible rule engine ({@link runRules}); this runs the `config`-kind
 * rules (at-most-one default, unique basePath, …) and returns the first error so
 * the contract stays `{ ok } | { ok:false, error }` for {@link assertValidWorkspacesConfig}.
 *
 * Returns `{ ok: true }` in legacy mode (no workspaces.json). Never throws,
 * never exits — callers decide what to do.
 */
export function validateWorkspacesConfig(
  filePath: string = workspacesFilePath(),
): { ok: true } | { ok: false; error: string } {
  let workspaces: Workspace[] | null;
  try {
    workspaces = parseWorkspacesFile(filePath);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (workspaces === null) return { ok: true }; // legacy mode — nothing to validate

  const firstError = runRules(makeRuleContext(workspaces), ['config']).find((i) => i.level === 'error');
  return firstError ? { ok: false, error: firstError.message } : { ok: true };
}

/**
 * Name of the single default workspace, WITHOUT activating anything.
 *
 * For callers that only need the default instance identity (the slug) and must
 * not inject env — chiefly {@link resolveInstance}, so every instance-scoped
 * command (ticket/epic/import/export/logs/doctor/stop/remove) targets the
 * default workspace's running stack when no `--workspace` is given.
 *
 * Non-throwing by design: returns `null` in legacy mode, on a read/parse error,
 * or when there isn't exactly one default (0 or >1). Callers then fall back to
 * the branch-only slug; real corruption is surfaced by
 * {@link assertValidWorkspacesConfig} and `fleex doctor`, not here.
 */
export function defaultWorkspaceName(filePath: string = workspacesFilePath()): string | null {
  let workspaces: Workspace[] | null;
  try {
    workspaces = parseWorkspacesFile(filePath);
  } catch {
    return null;
  }
  if (workspaces === null) return null;
  const defaults = workspaces.filter((w) => w.is_default);
  return defaults.length === 1 ? defaults[0]!.name : null;
}

/**
 * CLI guard for state-changing commands (start/restart/stop/desktop/self-update).
 *
 * Call at the very top of a command — before any workspace activation or
 * instance resolution — so a broken global config fails fast with an actionable
 * message instead of a confusing partial failure deeper in (or, worse, silently
 * skipping the broken path). Exits the process via a non-zero code on failure.
 */
export function assertValidWorkspacesConfig(): void {
  const res = validateWorkspacesConfig();
  if (res.ok) return;
  err(`Invalid workspaces config: ${res.error}`);
  err(`Run \`fleex doctor\` to diagnose, then fix ${workspacesFilePath()}.`);
  process.exit(1);
}

/** Warn (once) if the secrets file is readable by group/other. */
function checkPermissions(filePath: string): void {
  try {
    const mode = fs.statSync(filePath).mode & 0o077;
    if (mode !== 0) {
      warn(`${filePath} is group/world accessible — it contains secrets. Tighten with: chmod 600 ${filePath}`);
    }
  } catch {
    // ignore — cannot stat (e.g. permissions); not worth failing the command.
  }
}

/**
 * Activate a workspace for the current process.
 *
 * Resolves the requested (or default) workspace, sets `FLEEX_WORKSPACE` so that
 * instance identity becomes `workspace@branch`, and injects the workspace `env`
 * with override (workspace > shell > .env).
 *
 * Returns `null` in legacy mode (no workspaces.json) so callers preserve the
 * historical branch-based behaviour. Exits the process via `die()` on a corrupt
 * config or an unknown `--workspace`.
 *
 * IMPORTANT: must be called BEFORE the first resolveInstance(), which caches the
 * slug.
 */
export function activateWorkspace(name?: string): Workspace | null {
  const filePath = workspacesFilePath();

  let workspaces: Workspace[] | null;
  try {
    workspaces = parseWorkspacesFile(filePath);
  } catch (e) {
    return die(e instanceof Error ? e.message : String(e));
  }

  if (workspaces === null) {
    // Legacy mode: no workspaces.json. A --workspace flag here is a user error.
    if (name !== undefined) {
      return die(`--workspace '${name}' requested but ${filePath} does not exist.`);
    }
    return null;
  }

  let ws: Workspace;
  try {
    ws = resolveWorkspace(workspaces, name);
  } catch (e) {
    return die(e instanceof Error ? e.message : String(e));
  }

  checkPermissions(filePath);
  process.env.FLEEX_WORKSPACE = ws.name;
  applyEnv(ws.env, { override: true });
  // basePath is the source of truth for the server's repositoriesBasePath —
  // carry it via env so the config adapter overrides the DB value.
  if (ws.basePath) {
    applyEnv({ [BASE_PATH_ENV]: ws.basePath }, { override: true });
  }
  return ws;
}

/**
 * Migration helper: if no workspaces.json exists yet but a repo `.env` does,
 * create a single `default` workspace from its contents (chmod 0600). Returns
 * the created workspace, or `null` if nothing was done.
 */
export function bootstrapWorkspacesFromEnv(repoEnvPath: string): Workspace | null {
  const filePath = workspacesFilePath();
  if (fs.existsSync(filePath)) return null;
  if (!fs.existsSync(repoEnvPath)) return null;

  const env = parseDotEnv(repoEnvPath);
  const workspace: Workspace = { name: 'default', is_default: true, env };
  const file = { workspaces: [workspace] };

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(file, null, 2) + '\n', { mode: 0o600 });
  // writeFileSync mode is masked by umask on creation; enforce 0600 explicitly.
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // ignore — best effort on platforms without POSIX perms.
  }
  return workspace;
}
