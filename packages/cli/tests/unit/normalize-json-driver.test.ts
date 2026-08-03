import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { normalizeJsonDriverInWorkspaces } from '../../src/commands/self-update/index.ts';

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleex-json-driver-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function write(name: string, content: unknown): string {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, JSON.stringify(content, null, 2) + '\n', { mode: 0o600 });
  return p;
}

function read(p: string): { workspaces: Array<{ name: string; env: Record<string, string> }> } {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

describe('normalizeJsonDriverInWorkspaces', () => {
  // WHY: the JSON driver was removed, but existing installs still carry
  // `FLEEX_STORAGE_DRIVER: "json"` in workspaces.json. `resolveStorageDriver()`
  // now throws on that value, so without this rewrite `fleex start` would hard-fail
  // after a self-update instead of falling back to the (already default) sqlite.
  it('rewrites a json workspace to sqlite', () => {
    const p = write('json.json', {
      workspaces: [{ name: 'default', is_default: true, env: { FLEEX_STORAGE_DRIVER: 'json' } }],
    });

    normalizeJsonDriverInWorkspaces(p);

    expect(read(p).workspaces[0].env.FLEEX_STORAGE_DRIVER).toBe('sqlite');
  });

  it('leaves non-json drivers untouched', () => {
    const p = write('supabase.json', {
      workspaces: [
        { name: 'a', is_default: true, env: { FLEEX_STORAGE_DRIVER: 'supabase' } },
        { name: 'b', is_default: false, env: { FLEEX_STORAGE_DRIVER: 'sqlite' } },
      ],
    });
    const before = fs.readFileSync(p, 'utf8');

    normalizeJsonDriverInWorkspaces(p);

    expect(fs.readFileSync(p, 'utf8')).toBe(before);
  });

  it('keeps 0600 permissions when it rewrites the file', () => {
    const p = write('perms.json', {
      workspaces: [{ name: 'default', is_default: true, env: { FLEEX_STORAGE_DRIVER: 'json' } }],
    });

    normalizeJsonDriverInWorkspaces(p);

    expect(fs.statSync(p).mode & 0o777).toBe(0o600);
  });

  it('is a no-op on an unreadable or missing file', () => {
    expect(() => normalizeJsonDriverInWorkspaces(path.join(tmpDir, 'nope.json'))).not.toThrow();
  });
});
