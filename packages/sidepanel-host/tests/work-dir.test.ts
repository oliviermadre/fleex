import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureWorkDir, isInside, removeWorkDir, workDirName, workspacesRootFor, allWorkspacesRoots } from '../src/work-dir.ts';

let tmp: string;
let root: string;
beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fleex-workdir-')));
  root = path.join(tmp, 'workspaces');
  fs.mkdirSync(root);
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const ID = '3f9a12c4-aaaa-bbbb-cccc-1234567890ab';

describe('conversation folder', () => {
  it('lives next to tickets and routines, named after the conversation (D4)', () => {
    const dir = ensureWorkDir(root, ID);
    expect(dir).toBe(path.join(root, 'assistant-3f9a12c4'));
  });

  it('carries a manifest that no tool can take for a ticket\'s (D13)', () => {
    const dir = ensureWorkDir(root, ID);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, '.fleex.json'), 'utf8'));
    expect(manifest).toMatchObject({ kind: 'assistant', conversationId: ID });
    expect(manifest).not.toHaveProperty('ticketId');
  });

  it('takes a longer name when another conversation owns the short one (P9)', () => {
    const other = '3f9a12c4-0000-0000-0000-000000000000';
    ensureWorkDir(root, other);
    expect(ensureWorkDir(root, ID)).toBe(path.join(root, workDirName(ID, 12)));
  });

  it('reads the workspaces root from the workspace\'s basePath', () => {
    const file = path.join(tmp, 'workspaces.json');
    fs.writeFileSync(file, JSON.stringify({ workspaces: [{ name: 'default', basePath: '/p', is_default: true }, { name: 'qa', basePath: '/q' }] }));
    expect(workspacesRootFor('qa', file)).toBe('/q/workspaces');
    expect(workspacesRootFor(undefined, file)).toBe('/p/workspaces');
    expect(workspacesRootFor('nope', file)).toBeUndefined();
    expect(allWorkspacesRoots(file)).toEqual(['/p/workspaces', '/q/workspaces']);
  });
});

describe('isInside', () => {
  it('follows symlinks: a link inside pointing out is outside (CA12)', () => {
    const dir = ensureWorkDir(root, ID);
    const outside = path.join(tmp, 'desktop');
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(dir, 'out'));
    expect(isInside('out/x.txt', dir)).toBe(false);
    expect(isInside('sub/new/file.csv', dir)).toBe(true);
    expect(isInside(path.join(dir, '..', 'x'), dir)).toBe(false);
    expect(isInside(dir + '-evil/x', dir)).toBe(false);
  });
});

describe('removeWorkDir', () => {
  it('deletes the folder, and links inside as links only', () => {
    const dir = ensureWorkDir(root, ID);
    const precious = path.join(tmp, 'precious');
    fs.mkdirSync(precious);
    fs.writeFileSync(path.join(precious, 'keep.txt'), 'x');
    fs.symlinkSync(precious, path.join(dir, 'link'));
    expect(removeWorkDir(dir, [root])).toBeNull();
    expect(fs.existsSync(dir)).toBe(false);
    expect(fs.existsSync(path.join(precious, 'keep.txt'))).toBe(true);
  });

  it('refuses anything that is not an assistant-* folder under a workspaces root', () => {
    const victim = path.join(tmp, 'assistant-victim');
    fs.mkdirSync(victim);
    expect(removeWorkDir(victim, [root])).toMatch(/not deleted/);
    expect(fs.existsSync(victim)).toBe(true);
    const ticket = path.join(root, '2b083b-ticket');
    fs.mkdirSync(ticket);
    expect(removeWorkDir(ticket, [root])).toMatch(/not deleted/);
    expect(fs.existsSync(ticket)).toBe(true);
  });
});
