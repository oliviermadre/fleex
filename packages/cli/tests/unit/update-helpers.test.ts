import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stripAnsi } from '../../src/core/colors.ts';
import {
  EXECUTION_MODES,
  appendMemory,
  applyMemberEdits,
  assertInlineFileExclusive,
  assertMemoryFlagsExclusive,
  assertSingleStdin,
  assertValidExecutionMode,
  dieNoUpdates,
  noneToNull,
  parsePersonaModelSpec,
  readTextInput,
  resolveEnabledFlags,
  type PanelMemberLike,
} from '../../src/core/update-helpers.ts';

/** Run `fn`, expecting it to die(); returns the ANSI-stripped stderr output. */
function captureDie(fn: () => unknown): string {
  const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
    throw new Error('exit');
  }) as never);
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  try {
    expect(fn).toThrow('exit');
    return stripAnsi(stderr.mock.calls.map((c) => String(c[0])).join(''));
  } finally {
    exit.mockRestore();
    stderr.mockRestore();
  }
}

async function captureDieAsync(fn: () => Promise<unknown>): Promise<string> {
  const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
    throw new Error('exit');
  }) as never);
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  try {
    await expect(fn()).rejects.toThrow('exit');
    return stripAnsi(stderr.mock.calls.map((c) => String(c[0])).join(''));
  } finally {
    exit.mockRestore();
    stderr.mockRestore();
  }
}

describe('assertValidExecutionMode', () => {
  it('accepts every allowed mode', () => {
    for (const mode of EXECUTION_MODES) {
      expect(() => assertValidExecutionMode(mode)).not.toThrow();
    }
  });
  it('dies with the exact catalog message on an invalid mode', () => {
    const out = captureDie(() => assertValidExecutionMode('yolo'));
    expect(out).toContain('Invalid execution mode "yolo". Allowed values: claude_code | message.');
  });
});

describe('assertInlineFileExclusive', () => {
  it('passes when only one channel is used', () => {
    expect(() => assertInlineFileExclusive('soul', 'text', undefined)).not.toThrow();
    expect(() => assertInlineFileExclusive('soul', undefined, '/tmp/x')).not.toThrow();
    expect(() => assertInlineFileExclusive('soul', undefined, undefined)).not.toThrow();
  });
  it('dies when both inline and file are set', () => {
    const out = captureDie(() => assertInlineFileExclusive('soul', 'text', '/tmp/x'));
    expect(out).toContain('Use either --soul or --soul-file, not both.');
  });
});

describe('assertSingleStdin', () => {
  it('allows a single stdin consumer', () => {
    expect(() =>
      assertSingleStdin([
        { flag: '--soul-file', value: '-' },
        { flag: '--memory-file', value: '/tmp/x' },
      ]),
    ).not.toThrow();
  });
  it('dies listing the offending flags when two want stdin', () => {
    const out = captureDie(() =>
      assertSingleStdin([
        { flag: '--soul-file', value: '-' },
        { flag: '--memory-file', value: '-' },
      ]),
    );
    expect(out).toContain(
      'Only one flag may read from stdin ("-") per invocation. Got: --soul-file -, --memory-file -.',
    );
  });
});

describe('assertMemoryFlagsExclusive', () => {
  it('allows replace-only or append-only', () => {
    expect(() => assertMemoryFlagsExclusive({ memory: 'x' })).not.toThrow();
    expect(() => assertMemoryFlagsExclusive({ memoryAppendFile: '-' })).not.toThrow();
  });
  it('dies when mixing replace and append families', () => {
    const out = captureDie(() => assertMemoryFlagsExclusive({ memory: 'x', memoryAppend: 'y' }));
    expect(out).toContain(
      'Use either --memory/--memory-file (replace) or --memory-append/--memory-append-file (append), not both.',
    );
  });
  it('dies when mixing inline and file within a family', () => {
    const out = captureDie(() => assertMemoryFlagsExclusive({ memory: 'x', memoryFile: '/tmp/m' }));
    expect(out).toContain('Use either --memory or --memory-file, not both.');
  });
});

describe('readTextInput', () => {
  it('returns the inline text as-is', async () => {
    expect(await readTextInput('inline text', undefined)).toBe('inline text');
  });
  it('returns undefined when neither channel is set', async () => {
    expect(await readTextInput(undefined, undefined)).toBeUndefined();
  });
  it('reads the file contents', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fleex-update-'));
    const file = path.join(dir, 'soul.md');
    writeFileSync(file, '# New soul\n');
    expect(await readTextInput(undefined, file)).toBe('# New soul\n');
  });
  it('dies with the catalog message on an unreadable file', async () => {
    const out = await captureDieAsync(() => readTextInput(undefined, '/nonexistent/nope.md'));
    expect(out).toContain('Cannot read file "/nonexistent/nope.md":');
  });
});

describe('noneToNull', () => {
  it('maps the literal "none" to null', () => {
    expect(noneToNull('none')).toBeNull();
  });
  it('passes other values through', () => {
    expect(noneToNull('nas')).toBe('nas');
    expect(noneToNull(undefined)).toBeUndefined();
  });
});

describe('appendMemory', () => {
  it('appends with a blank-line separator, never erasing', () => {
    expect(appendMemory('existing', 'added')).toBe('existing\n\nadded');
  });
  it('returns the addition alone when memory is empty', () => {
    expect(appendMemory('', 'added')).toBe('added');
    expect(appendMemory(undefined, 'added')).toBe('added');
    expect(appendMemory(null, 'added')).toBe('added');
  });
});

describe('parsePersonaModelSpec', () => {
  it('parses a bare persona ref', () => {
    expect(parsePersonaModelSpec('catalyst')).toEqual({ personaRef: 'catalyst' });
  });
  it('splits persona and model on the first colon', () => {
    expect(parsePersonaModelSpec('catalyst:claude-opus-4-6')).toEqual({
      personaRef: 'catalyst',
      model: 'claude-opus-4-6',
    });
  });
});

describe('resolveEnabledFlags', () => {
  it('maps --enable to true and --disable to false', () => {
    expect(resolveEnabledFlags(true, undefined)).toBe(true);
    expect(resolveEnabledFlags(undefined, true)).toBe(false);
    expect(resolveEnabledFlags(undefined, undefined)).toBeUndefined();
  });
  it('dies when both are set', () => {
    const out = captureDie(() => resolveEnabledFlags(true, true));
    expect(out).toContain('Use either --enable or --disable, not both.');
  });
});

describe('dieNoUpdates', () => {
  it('names the resource in the catalog message', () => {
    const out = captureDie(() => dieNoUpdates('agent'));
    expect(out).toContain(
      "No updates specified. Pass at least one modification flag — run 'fleex agent update --help' for the full list.",
    );
  });
});

describe('applyMemberEdits', () => {
  const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const C = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  const nameOf = (id: string) => ({ [A]: 'alpha', [B]: 'beta', [C]: 'gamma' })[id] ?? id;
  const current = (): PanelMemberLike[] => [
    { personaId: A, order: 0, modelOverride: 'inherited' },
    { personaId: B, order: 1, modelOverride: 'claude-sonnet-4-6' },
  ];

  it('appends new members in the order given, defaulting to inherited', () => {
    const next = applyMemberEdits(
      current(),
      { add: [{ ref: 'gamma', personaId: C, model: 'claude-opus-4-6' }], rm: [], setModel: [] },
      nameOf,
    );
    expect(next.map((m) => m.personaId)).toEqual([A, B, C]);
    expect(next[2]).toEqual({ personaId: C, order: 2, modelOverride: 'claude-opus-4-6' });
  });

  it('dies when adding an existing member', () => {
    const out = captureDie(() =>
      applyMemberEdits(current(), { add: [{ ref: 'alpha', personaId: A }], rm: [], setModel: [] }, nameOf),
    );
    expect(out).toContain(
      '"alpha" is already a member of this panel. Use --set-member-model alpha:<model> to change its model.',
    );
  });

  it('removes members and reindexes order', () => {
    const next = applyMemberEdits(
      current(),
      { add: [], rm: [{ ref: 'alpha', personaId: A }], setModel: [] },
      nameOf,
    );
    expect(next).toEqual([{ personaId: B, order: 0, modelOverride: 'claude-sonnet-4-6' }]);
  });

  it('dies when removing a persona that is not a member', () => {
    const out = captureDie(() =>
      applyMemberEdits(current(), { add: [], rm: [{ ref: 'gamma', personaId: C }], setModel: [] }, nameOf),
    );
    expect(out).toContain('"gamma" is not a member of this panel.');
  });

  it('refuses to remove the last remaining member', () => {
    const out = captureDie(() =>
      applyMemberEdits(
        current(),
        { add: [], rm: [{ ref: 'alpha', personaId: A }, { ref: 'beta', personaId: B }], setModel: [] },
        nameOf,
      ),
    );
    expect(out).toContain(
      'Cannot remove the last member — a panel needs at least one. Add a replacement with --add-member first.',
    );
  });

  it('allows replacing the last member in a single invocation (add first, then rm)', () => {
    const one: PanelMemberLike[] = [{ personaId: A, order: 0, modelOverride: 'inherited' }];
    const next = applyMemberEdits(
      one,
      { add: [{ ref: 'beta', personaId: B }], rm: [{ ref: 'alpha', personaId: A }], setModel: [] },
      nameOf,
    );
    expect(next).toEqual([{ personaId: B, order: 0, modelOverride: 'inherited' }]);
  });

  it('changes the model override of an existing member (and back to inherited)', () => {
    const next = applyMemberEdits(
      current(),
      { add: [], rm: [], setModel: [{ ref: 'beta', personaId: B, model: 'inherited' }] },
      nameOf,
    );
    expect(next[1]).toEqual({ personaId: B, order: 1, modelOverride: 'inherited' });
  });

  it('dies when --set-member-model targets a non-member, with the corrective hint', () => {
    const out = captureDie(() =>
      applyMemberEdits(
        current(),
        { add: [], rm: [], setModel: [{ ref: 'gamma', personaId: C, model: 'claude-opus-4-6' }] },
        nameOf,
      ),
    );
    expect(out).toContain(
      '"gamma" is not a member of this panel. Use --add-member gamma:claude-opus-4-6 to add it.',
    );
  });

  it('reorders members with a complete permutation', () => {
    const next = applyMemberEdits(
      current(),
      {
        add: [],
        rm: [],
        setModel: [],
        order: [
          { ref: 'beta', personaId: B },
          { ref: 'alpha', personaId: A },
        ],
      },
      nameOf,
    );
    expect(next.map((m) => m.personaId)).toEqual([B, A]);
    expect(next.map((m) => m.order)).toEqual([0, 1]);
  });

  it('dies when --member-order is incomplete, listing current members', () => {
    const out = captureDie(() =>
      applyMemberEdits(
        current(),
        { add: [], rm: [], setModel: [], order: [{ ref: 'alpha', personaId: A }] },
        nameOf,
      ),
    );
    expect(out).toContain(
      '--member-order must list every current member exactly once. Current members: alpha, beta.',
    );
  });
});
