/**
 * The conversation's working folder: `<workspacesRoot>/assistant-<short id>`.
 *
 * A Fleex workspace like a ticket's or a routine's, so what a conversation
 * produces sits next to the rest of the user's Fleex work. It is the SDK
 * session's `cwd`, the only place the Assistant writes files without asking,
 * and it is deleted with the conversation.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const WORK_DIR_PREFIX = 'assistant-';
export const MANIFEST = '.fleex.json';

/** `.fleex.json` of a conversation folder: no `ticketId`, so nothing takes it for a ticket's. */
export interface AssistantManifest {
  kind: 'assistant';
  conversationId: string;
  createdAt: string;
}

function workspacesFile(): string {
  const home = process.env.FLEEX_HOME ?? path.join(os.homedir(), '.fleex');
  return path.join(home, 'workspaces.json');
}

/**
 * `<basePath>/workspaces` of a Fleex workspace, read from `~/.fleex/workspaces.json`.
 *
 * `basePath` there is the source of truth the CLI injects into the server as
 * its repositories base path, so this is the server's `workspacesRoot()` —
 * known even when no instance is running.
 */
export function workspacesRootFor(workspace: string | undefined, file: string = workspacesFile()): string | undefined {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const list: unknown[] = Array.isArray(raw) ? raw : Array.isArray(raw?.workspaces) ? raw.workspaces : [];
    const entries = list.filter((w): w is Record<string, unknown> => !!w && typeof w === 'object');
    const ws = workspace
      ? entries.find((w) => w.name === workspace)
      : entries.find((w) => w.is_default === true || w.isDefault === true);
    const base = typeof ws?.basePath === 'string' ? ws.basePath : undefined;
    return base ? path.join(base, 'workspaces') : undefined;
  } catch {
    return undefined;
  }
}

/** Folder name for a conversation: 8 hex chars of its id, 12 when 8 collide. */
export function workDirName(conversationId: string, length: 8 | 12 = 8): string {
  return WORK_DIR_PREFIX + conversationId.replace(/-/g, '').slice(0, length).toLowerCase();
}

function readManifest(dir: string): Partial<AssistantManifest> | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Create (or reuse) the conversation's folder under `root` and return its path.
 *
 * A folder of that name already owned by another conversation is a collision:
 * the longer name is used instead. The manifest is (re)written so a folder
 * whose `.fleex.json` was removed is recognised again.
 */
export function ensureWorkDir(root: string, conversationId: string): string {
  let dir = path.join(root, workDirName(conversationId));
  const existing = fs.existsSync(dir) ? readManifest(dir) : null;
  if (existing && existing.conversationId && existing.conversationId !== conversationId) {
    dir = path.join(root, workDirName(conversationId, 12));
  }
  return writeWorkDir(dir, conversationId);
}

/** Create `dir` (if missing) with its manifest. Used as is to recreate a folder removed by hand (RG22). */
export function writeWorkDir(dir: string, conversationId: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const manifestPath = path.join(dir, MANIFEST);
  if (!fs.existsSync(manifestPath)) {
    const manifest: AssistantManifest = { kind: 'assistant', conversationId, createdAt: new Date().toISOString() };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  }
  return dir;
}

/** `<basePath>/workspaces` of every configured Fleex workspace. */
export function allWorkspacesRoots(file: string = workspacesFile()): string[] {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const list: unknown[] = Array.isArray(raw) ? raw : Array.isArray(raw?.workspaces) ? raw.workspaces : [];
    return list
      .map((w) => (w && typeof w === 'object' ? (w as Record<string, unknown>).basePath : undefined))
      .filter((b): b is string => typeof b === 'string' && b.length > 0)
      .map((b) => path.join(b, 'workspaces'));
  } catch {
    return [];
  }
}

/**
 * Absolute, symlink-resolved form of `target` (relative to `cwd`), for a file
 * that may not exist yet: the longest existing ancestor is replaced by its
 * realpath and the missing tail is appended.
 */
export function resolveReal(target: string, cwd: string): string {
  let abs = path.resolve(cwd, target);
  const tail: string[] = [];
  for (;;) {
    try {
      const real = fs.realpathSync(abs);
      return tail.length ? path.join(real, ...tail.reverse()) : real;
    } catch {
      const parent = path.dirname(abs);
      if (parent === abs) return path.join(abs, ...tail.reverse());
      tail.push(path.basename(abs));
      abs = parent;
    }
  }
}

/** True when `target` (resolved against `cwd`, symlinks followed) is `dir` or inside it. */
export function isInside(target: string, dir: string, cwd: string = dir): boolean {
  const real = resolveReal(target, cwd);
  const base = resolveReal(dir, dir);
  return real === base || real.startsWith(base + path.sep);
}

/**
 * Delete a conversation folder — only if it really is one.
 *
 * Refuses (returns an error message, deletes nothing) unless the folder's
 * realpath is a direct child of one of the workspaces `roots` and is named
 * `assistant-*`: a corrupted session file must never point `rm -r` elsewhere.
 * `fs.rmSync` removes symlinks inside the folder as links, never their targets.
 */
export function removeWorkDir(dir: string, roots: string[]): string | null {
  let real: string;
  try {
    real = fs.realpathSync(dir);
  } catch {
    return null; // already gone
  }
  const realRoots = roots.flatMap((r) => {
    try {
      return [fs.realpathSync(r)];
    } catch {
      return [];
    }
  });
  if (!realRoots.includes(path.dirname(real)) || !path.basename(real).startsWith(WORK_DIR_PREFIX)) {
    return `${dir} is not a conversation folder under a Fleex workspaces root, not deleted`;
  }
  try {
    fs.rmSync(real, { recursive: true, force: true });
    return null;
  } catch (e) {
    return `failed to delete ${dir}: ${e instanceof Error ? e.message : String(e)}`;
  }
}
