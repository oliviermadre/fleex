import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { reconstructTranscript } from '../../src/application/utils/cli-session-ingest.js';

let dir: string;

/** Write JSONL: one object per line. */
function writeJsonl(path: string, objects: unknown[]) {
  writeFileSync(path, objects.map((o) => JSON.stringify(o)).join('\n') + '\n');
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'fleex-reconstruct-'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('reconstructTranscript', () => {
  it('returns ordered user/assistant text turns, stripping tool_use and tool_result noise', async () => {
    const path = join(dir, 'mixed.jsonl');
    writeJsonl(path, [
      { type: 'user', timestamp: '2026-07-03T10:00:00Z', message: { role: 'user', content: 'Please refactor the parser' } },
      {
        type: 'assistant', timestamp: '2026-07-03T10:00:05Z',
        message: {
          role: 'assistant', model: 'claude-opus-4-8',
          content: [
            { type: 'text', text: "Sure, I'll refactor it." },
            { type: 'tool_use', id: 't1', name: 'Edit', input: { path: 'x' } },
          ],
        },
      },
      // tool_result comes back as a user message → pure noise, must be dropped.
      { type: 'user', timestamp: '2026-07-03T10:00:06Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } },
      { type: 'assistant', timestamp: '2026-07-03T10:00:10Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Done. The parser is cleaner now.' }] } },
      // non-conversational lines must be ignored.
      { type: 'system', timestamp: '2026-07-03T10:00:11Z', content: 'session hook noise' },
      { type: 'summary', summary: 'a compaction summary' },
    ]);

    const turns = await reconstructTranscript(path);

    expect(turns).toEqual([
      { role: 'user', text: 'Please refactor the parser' },
      { role: 'assistant', text: "Sure, I'll refactor it." },
      { role: 'assistant', text: 'Done. The parser is cleaner now.' },
    ]);
  });

  it('joins multiple text blocks within a single assistant turn', async () => {
    const path = join(dir, 'multiblock.jsonl');
    writeJsonl(path, [
      {
        type: 'assistant', timestamp: '2026-07-03T10:00:00Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'First part.' }, { type: 'text', text: 'Second part.' }] },
      },
    ]);

    const turns = await reconstructTranscript(path);

    expect(turns).toEqual([{ role: 'assistant', text: 'First part.\nSecond part.' }]);
  });

  it('returns no assistant turns when the session has only tool noise (empty-content guard)', async () => {
    const path = join(dir, 'noise-only.jsonl');
    writeJsonl(path, [
      { type: 'user', timestamp: '2026-07-03T10:00:00Z', message: { role: 'user', content: 'hi' } },
      { type: 'assistant', timestamp: '2026-07-03T10:00:01Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }] } },
      { type: 'user', timestamp: '2026-07-03T10:00:02Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } },
    ]);

    const turns = await reconstructTranscript(path);

    expect(turns.some((t) => t.role === 'assistant')).toBe(false);
    expect(turns).toEqual([{ role: 'user', text: 'hi' }]);
  });

  it('skips malformed JSON lines without throwing', async () => {
    const path = join(dir, 'malformed.jsonl');
    writeFileSync(path, [
      'not-json-at-all',
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'survived' }] } }),
      '',
    ].join('\n'));

    const turns = await reconstructTranscript(path);

    expect(turns).toEqual([{ role: 'assistant', text: 'survived' }]);
  });
});
