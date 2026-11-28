import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createOutsideWriteHook, lineDiff, previewWrite, type OutsideWriteDecision, type OutsideWriteRequest } from '../src/outside-write-guard.ts';

let tmp: string;
let dir: string;
beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fleex-guard-')));
  dir = path.join(tmp, 'assistant-1');
  fs.mkdirSync(dir);
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

function hook(answer: OutsideWriteDecision, allowed = false) {
  const asked: OutsideWriteRequest[] = [];
  const h = createOutsideWriteHook({
    workDir: () => dir,
    outsideWritesAllowed: () => allowed,
    ask: async (r) => {
      asked.push(r);
      return answer;
    },
  });
  return { h, asked };
}

describe('outside-write guard', () => {
  it('lets every write inside the folder through without asking', async () => {
    const { h, asked } = hook('deny');
    expect(await h({ tool_name: 'Write', tool_input: { file_path: 'export.ts', content: 'x' } }, 't1')).toEqual({});
    expect(asked).toHaveLength(0);
  });

  it('asks before a write outside, and a refusal denies the call with a reason', async () => {
    const target = path.join(tmp, '.zshrc');
    fs.writeFileSync(target, 'a\n');
    const { h, asked } = hook('deny');
    const out = await h({ tool_name: 'Edit', tool_input: { file_path: target, old_string: 'a', new_string: 'b' } }, 't1');
    expect(asked[0]).toMatchObject({ id: 't1', tool: 'Edit', path: target, isNewFile: false });
    expect(asked[0]!.diff).toContain('-a');
    expect(asked[0]!.diff).toContain('+b');
    expect(out.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(fs.readFileSync(target, 'utf8')).toBe('a\n');
  });

  it('allows without asking once the conversation said "always" (⚡)', async () => {
    const { h, asked } = hook('deny', true);
    const out = await h({ tool_name: 'Write', tool_input: { file_path: path.join(tmp, 'x.txt'), content: 'x' } }, 't1');
    expect(asked).toHaveLength(0);
    expect(out.hookSpecificOutput?.permissionDecision).toBe('allow');
  });

  it('never guards anything but file writes (Bash is free, R3)', async () => {
    const { h, asked } = hook('deny');
    expect(await h({ tool_name: 'Bash', tool_input: { command: 'echo x > ~/x.txt' } }, 't1')).toEqual({});
    expect(asked).toHaveLength(0);
  });
});

describe('previews', () => {
  it('shows a new file as its first lines', () => {
    const p = previewWrite('Write', { content: 'l1\nl2' }, path.join(tmp, 'new.txt'));
    expect(p).toEqual({ diff: '+l1\n+l2', isNewFile: true });
  });

  it('folds unchanged lines beyond the context', () => {
    const before = Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n');
    const after = before.replace('l10', 'L10');
    const d = lineDiff(before, after);
    expect(d).toContain('-l10');
    expect(d).toContain('+L10');
    expect(d).toContain(' l7');
    expect(d).not.toContain(' l2\n');
    expect(d.startsWith('…')).toBe(true);
  });
});
