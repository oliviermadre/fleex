/**
 * Lists fleex workspaces from `~/.fleex/workspaces.json` so the side panel can
 * offer a workspace selector. Defensive: tolerates absent/odd files.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface WorkspaceInfo {
  name: string;
  isDefault: boolean;
}

function workspacesFile(): string {
  const home = process.env.FLEEX_HOME ?? path.join(os.homedir(), '.fleex');
  return path.join(home, 'workspaces.json');
}

export function listWorkspaces(): WorkspaceInfo[] {
  try {
    const raw = JSON.parse(fs.readFileSync(workspacesFile(), 'utf8'));
    const arr: unknown[] = Array.isArray(raw) ? raw : Array.isArray(raw?.workspaces) ? raw.workspaces : [];
    return arr
      .map((w): WorkspaceInfo | null => {
        if (!w || typeof w !== 'object') return null;
        const o = w as Record<string, unknown>;
        const name = typeof o.name === 'string' ? o.name : undefined;
        if (!name) return null;
        return { name, isDefault: o.is_default === true || o.isDefault === true };
      })
      .filter((w): w is WorkspaceInfo => w !== null);
  } catch {
    return [];
  }
}

export function defaultWorkspace(): string | undefined {
  return listWorkspaces().find((w) => w.isDefault)?.name;
}
