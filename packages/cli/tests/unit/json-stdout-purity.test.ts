/**
 * Under `--json`, the WHOLE of stdout must be one parseable JSON line.
 *
 * The tool layer does `JSON.parse(stdout)` on the entire stream. A single bare
 * `[fleex] …` sentence printed alongside the payload does not crash anything —
 * it silently degrades: the parse throws, the caller falls back to raw text,
 * and every structured field (`changed`, `linked`, …) is lost. That is exactly
 * the failure this command set exists to eliminate, so it is worth a test that
 * reads the stream rather than the return value.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../src/core/api.ts', () => ({
  apiBase: () => 'http://localhost:1234',
  apiGet: vi.fn(async () => ({ tags: [] })),
  apiPost: vi.fn(async () => ({ created: true })),
  apiPatch: vi.fn(async () => ({ displayId: 520, title: 'Parity audit', changed: ['blocked'] })),
  apiDelete: vi.fn(async () => undefined),
}));

vi.mock('../../src/commands/ticket/_shared.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/commands/ticket/_shared.ts')>()),
  resolveTicketId: async () => 'ticket-uuid',
}));

vi.mock('../../src/commands/epic/_shared.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/commands/epic/_shared.ts')>()),
  resolveEpicId: async (ref: string) => `epic-${ref}`,
}));

vi.mock('../../src/commands/board/_shared.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/commands/board/_shared.ts')>()),
  resolveBoardId: async (ref: string) => ref,
}));

import { setJsonMode } from '../../src/core/colors.ts';
import { apiPost } from '../../src/core/api.ts';
import updateDef from '../../src/commands/ticket/update/index.ts';
import linkDef from '../../src/commands/ticket/link/index.ts';

/** Capture everything written to stdout while `fn` runs. */
async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const original = process.stdout.write;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  process.stdout.write = ((chunk: any) => { chunks.push(String(chunk)); return true; }) as any;
  try {
    await fn();
  } finally {
    process.stdout.write = original;
  }
  return chunks.join('');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const runUpdate = (opts: Record<string, unknown>) => (updateDef.action as any)('520', opts);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const runLink = (opts: Record<string, unknown>) => (linkDef.action as any)('520', opts);

describe('ticket update --json — epic membership must not pollute the stream', () => {
  beforeEach(() => { setJsonMode(true); vi.clearAllMocks(); });
  afterEach(() => { setJsonMode(false); });

  it('emits a single parseable JSON line when --add-epic is used', async () => {
    // The regression: `info('Added to epic …')` ran outside the JSON guard, so
    // stdout was "[fleex] Added to epic X\n{…}" and the caller lost `changed`.
    const out = await captureStdout(() => runUpdate({ blocked: false, addEpic: ['roadmap'] }));

    expect(out).not.toContain('[fleex]');
    const parsed = JSON.parse(out);
    expect(parsed.changed).toEqual(['blocked']);
    expect(parsed.epics).toEqual([{ op: 'added', epic: 'roadmap' }]);
  });

  it('emits a single parseable JSON line when --remove-epic is used', async () => {
    const out = await captureStdout(() => runUpdate({ blocked: false, removeEpic: ['roadmap'] }));

    expect(out).not.toContain('[fleex]');
    expect(JSON.parse(out).epics).toEqual([{ op: 'removed', epic: 'roadmap' }]);
  });

  it('still prints the human sentences when --json is off', async () => {
    // The fix must move the output, not delete it: a human running the command
    // in a terminal still needs to be told the epic membership changed.
    setJsonMode(false);
    const out = await captureStdout(() => runUpdate({ blocked: false, addEpic: ['roadmap'] }));

    expect(out).toContain('Added to epic roadmap');
    expect(out).toContain('Updated ticket #520');
  });
});

describe('ticket link --json — a duplicate link is reported as skipped', () => {
  beforeEach(() => { setJsonMode(true); vi.clearAllMocks(); });
  afterEach(() => { setJsonMode(false); });

  it('lists an already-present PR under `skipped`, not `linked`', async () => {
    // Linking the same PR twice used to add a second row AND report success —
    // which is how duplicate PR links kept appearing on tickets.
    vi.mocked(apiPost).mockResolvedValue({ created: false });
    const out = await captureStdout(() => runLink({ pr: ['oliviermadre/fleex#265'] }));

    const parsed = JSON.parse(out);
    expect(parsed.linked).toEqual([]);
    expect(parsed.skipped).toEqual([{ type: 'github_pr', ref: 'oliviermadre/fleex#265' }]);
  });

  it('lists a genuinely new PR under `linked`', async () => {
    vi.mocked(apiPost).mockResolvedValue({ created: true });
    const out = await captureStdout(() => runLink({ pr: ['oliviermadre/fleex#265'] }));

    const parsed = JSON.parse(out);
    expect(parsed.linked).toEqual([{ type: 'github_pr', ref: 'oliviermadre/fleex#265' }]);
    expect(parsed.skipped).toEqual([]);
  });

  it('falls back to reporting a link when the server omits `created`', async () => {
    // An older server does not send the field. We must not then claim every
    // link was a no-op — degrade toward the optimistic message, not the wrong one.
    vi.mocked(apiPost).mockResolvedValue({});
    const out = await captureStdout(() => runLink({ pr: ['oliviermadre/fleex#265'] }));

    expect(JSON.parse(out).linked).toHaveLength(1);
  });
});
