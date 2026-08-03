/**
 * Discover the running Fleex server for a workspace, independent of the git
 * branch. Fleex keys instances as `<workspace>@<branch>` under
 * `~/.fleex/.run/`, so we scan for any `<workspace>@*` with a ports.json whose
 * server port is actually listening. Used to read a workspace's theme (and a
 * good basis for branch-agnostic targeting in general).
 */
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { defaultWorkspace } from './workspaces.ts';

export interface RunningInstance {
  slug: string;
  server: number;
}

function runDir(): string {
  const home = process.env.FLEEX_HOME ?? path.join(os.homedir(), '.fleex');
  return path.join(home, '.run');
}

/** Instances with a ports.json whose slug is `<workspace>@…`. */
export function listWorkspaceInstances(
  workspace: string,
  dir: string = runDir(),
): RunningInstance[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const prefix = `${workspace}@`;
  const out: RunningInstance[] = [];
  for (const name of names) {
    if (!name.startsWith(prefix)) continue;
    try {
      const p = JSON.parse(fs.readFileSync(path.join(dir, name, 'ports.json'), 'utf8'));
      if (typeof p.server === 'number') out.push({ slug: name, server: p.server });
    } catch {
      /* skip unreadable/partial */
    }
  }
  return out;
}

function isListening(port: number, timeoutMs = 300): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: '127.0.0.1' });
    const done = (v: boolean) => {
      sock.destroy();
      resolve(v);
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
}

/**
 * Resolve the first live instance for `workspace` (defaults to the is_default
 * workspace). Returns null if none is running. `probe` is injectable for
 * testing.
 */
export async function findRunningInstance(
  workspace?: string,
  probe: (port: number) => Promise<boolean> = isListening,
): Promise<RunningInstance | null> {
  const ws = workspace && workspace.trim() ? workspace : defaultWorkspace();
  if (!ws) return null;
  for (const inst of listWorkspaceInstances(ws)) {
    if (await probe(inst.server)) return inst;
  }
  return null;
}

/** The branch portion of an instance slug `<workspace>@<branch>`. */
export function instanceBranch(slug: string): string {
  const at = slug.indexOf('@');
  return at === -1 ? slug : slug.slice(at + 1);
}

/**
 * Resolve the server port of a live stack for `workspace` (defaults to the
 * is_default workspace). Returns null if none is running. `probe` is injectable
 * for testing.
 */
export async function findWorkspaceServerPort(
  workspace?: string,
  probe: (port: number) => Promise<boolean> = isListening,
): Promise<number | null> {
  return (await findRunningInstance(workspace, probe))?.server ?? null;
}
