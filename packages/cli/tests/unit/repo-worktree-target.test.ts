import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { worktreeTarget } from '../../src/commands/repo/_worktree.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function workspace(): { ws: string; wt: string } {
  const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fx-ws-')));
  dirs.push(ws);
  const wt = path.join(ws, 'fleex');
  fs.mkdirSync(path.join(wt, 'packages', 'web'), { recursive: true });
  fs.writeFileSync(path.join(wt, '.git'), 'gitdir: /base/.bare/o/fleex.git/worktrees/x\n'); // linked worktree marker
  return { ws, wt };
}

describe('worktreeTarget', () => {
  it('finds the worktree from any folder inside it, like `fleex repo run start` from packages/web', () => {
    // WHY: agents and humans run the CLI from deep inside a repo; the command must act on that worktree.
    const { wt } = workspace();
    expect(worktreeTarget(undefined, path.join(wt, 'packages', 'web'))).toBe(wt);
  });

  it('stays on a ticket workspace (several worktrees) and honours --worktree', () => {
    const { ws, wt } = workspace();
    expect(worktreeTarget(undefined, ws)).toBe(ws);
    expect(worktreeTarget('fleex', ws)).toBe(wt);
  });
});
