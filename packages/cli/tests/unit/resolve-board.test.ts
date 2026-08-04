import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the API layer so we can assert resolution without a running server.
const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock('../../src/core/api.ts', () => ({
  apiBase: () => 'http://localhost:9999',
  apiGet,
}));

import {
  resolveBoard,
  resolveBoardId,
  resolveBoardIdOrDefault,
  resetBoardCache,
} from '../../src/commands/board/_shared.ts';

const ROADMAP = 'aaaaaaaa-1111-2222-3333-444444444444';
const BUGS = 'bbbbbbbb-1111-2222-3333-444444444444';
const BUGS_2 = 'bbbbbbbb-9999-8888-7777-666666666666';

const BOARDS = [
  { id: ROADMAP, name: 'Roadmap', emoji: '🗺️' },
  { id: BUGS, name: 'Bugs' },
  { id: BUGS_2, name: 'bugs backlog' },
];

/** Capture stderr + turn `process.exit` into a throw so tests can assert on it. */
function trapExit() {
  const lines: string[] = [];
  const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
    throw new Error('exit');
  }) as never);
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(((s: string) => {
    lines.push(String(s));
    return true;
  }) as never);
  return {
    output: () => lines.join(''),
    restore: () => {
      exit.mockRestore();
      stderr.mockRestore();
    },
  };
}

describe('resolveBoard', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockResolvedValue(BOARDS);
    resetBoardCache();
  });
  afterEach(() => resetBoardCache());

  // The three reference forms an agent may reasonably produce: the UUID from
  // the API, the 8-char id printed by `board list`, and the human-readable name.
  it('resolves a full UUID', async () => {
    expect((await resolveBoard(ROADMAP)).name).toBe('Roadmap');
  });

  it('resolves a unique 8-char id prefix — the form `board list` prints', async () => {
    expect((await resolveBoard('aaaaaaaa')).name).toBe('Roadmap');
  });

  it('resolves an exact name, case-insensitively', async () => {
    expect((await resolveBoard('rOaDmAp')).id).toBe(ROADMAP);
  });

  it('exits listing the candidates on an ambiguous prefix instead of guessing', async () => {
    const t = trapExit();
    // Picking either "bbbbbbbb" board arbitrarily would silently file a ticket
    // on the wrong board — refuse and show both.
    await expect(resolveBoard('bbbbbbbb')).rejects.toThrow('exit');
    expect(t.output()).toContain(BUGS);
    expect(t.output()).toContain(BUGS_2);
    t.restore();
  });

  it('reports a missing full UUID as a genuinely absent board', async () => {
    const t = trapExit();
    await expect(resolveBoard('99999999-1111-2222-3333-444444444444')).rejects.toThrow('exit');
    expect(t.output()).toContain('Board not found: 99999999-1111-2222-3333-444444444444');
    t.restore();
  });

  it('tells the user which forms were tried when a non-UUID ref misses', async () => {
    // The old message ("Board not found: nope") read as "this board doesn't
    // exist" even when only the *shape* of the reference was the problem.
    const t = trapExit();
    await expect(resolveBoard('nope')).rejects.toThrow('exit');
    expect(t.output()).toContain('No board matches "nope"');
    expect(t.output()).toContain('tried full UUID, id prefix, and exact name');
    t.restore();
  });

  it('fetches the board list only once across successive resolutions', async () => {
    // `ticket update --board X --to-board Y` resolves twice in one command.
    await resolveBoard('aaaaaaaa');
    await resolveBoard('Roadmap');
    expect(apiGet).toHaveBeenCalledTimes(1);
  });

  it('resolveBoardId returns just the UUID', async () => {
    expect(await resolveBoardId('Roadmap')).toBe(ROADMAP);
  });
});

describe('resolveBoardIdOrDefault', () => {
  beforeEach(() => {
    apiGet.mockReset();
    resetBoardCache();
  });
  afterEach(() => resetBoardCache());

  it('auto-selects the only board when none is specified', async () => {
    apiGet.mockResolvedValue([BOARDS[0]]);
    expect(await resolveBoardIdOrDefault(undefined)).toBe(ROADMAP);
  });

  it('treats an empty string as "not specified" rather than failing', async () => {
    // A script interpolating an unset `--board "$BOARD"` should still work.
    apiGet.mockResolvedValue([BOARDS[0]]);
    expect(await resolveBoardIdOrDefault('')).toBe(ROADMAP);
  });

  it('lists the boards and exits when several exist and none is specified', async () => {
    apiGet.mockResolvedValue(BOARDS);
    const t = trapExit();
    await expect(resolveBoardIdOrDefault(undefined)).rejects.toThrow('exit');
    // 8-char ids, so the printed value can be pasted straight back into --board.
    expect(t.output()).toContain('aaaaaaaa  🗺️ Roadmap');
    t.restore();
  });

  it('resolves a specified reference through the shared path', async () => {
    apiGet.mockResolvedValue(BOARDS);
    expect(await resolveBoardIdOrDefault('aaaaaaaa')).toBe(ROADMAP);
  });
});
