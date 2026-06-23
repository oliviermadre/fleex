import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultWorkspace, resolveWorkspace } from '../src/workspaces.ts';

let home: string;
let prevHome: string | undefined;

function writeWorkspaces(content: unknown) {
  fs.writeFileSync(path.join(home, 'workspaces.json'), JSON.stringify(content));
}

beforeEach(() => {
  prevHome = process.env.FLEEX_HOME;
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'fleex-home-'));
  process.env.FLEEX_HOME = home;
});
afterEach(() => {
  if (prevHome === undefined) delete process.env.FLEEX_HOME;
  else process.env.FLEEX_HOME = prevHome;
  fs.rmSync(home, { recursive: true, force: true });
});

describe('defaultWorkspace', () => {
  it('returns the name of the isDefault workspace', () => {
    writeWorkspaces([{ name: 'tada' }, { name: 'default', is_default: true }]);
    expect(defaultWorkspace()).toBe('default');
  });

  it('returns undefined when no workspaces.json exists', () => {
    expect(defaultWorkspace()).toBeUndefined();
  });
});

describe('resolveWorkspace', () => {
  beforeEach(() => {
    writeWorkspaces([{ name: 'tada' }, { name: 'default', is_default: true }]);
  });

  it('maps an empty session workspace to the configured default', () => {
    expect(resolveWorkspace('')).toBe('default');
  });

  it('maps an undefined session workspace to the configured default', () => {
    expect(resolveWorkspace(undefined)).toBe('default');
  });

  it('keeps an explicit session workspace untouched', () => {
    expect(resolveWorkspace('tada')).toBe('tada');
  });

  it('falls back to undefined when there is no default to pin', () => {
    writeWorkspaces([{ name: 'tada' }, { name: 'sqlite' }]);
    expect(resolveWorkspace('')).toBeUndefined();
    expect(resolveWorkspace(undefined)).toBeUndefined();
  });
});
