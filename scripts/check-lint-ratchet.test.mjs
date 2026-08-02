import { describe, expect, it } from 'vitest';

import {
  NO_RULE,
  collectCounts,
  findFatals,
  findRegressions,
  serialise,
  sortCounts,
  toPosixRelative,
  totalOf,
} from './check-lint-ratchet.mjs';

const ROOT = '/repo';

/** Build a fake ESLint result for one file. */
const file = (filePath, messages) => ({ filePath: `${ROOT}/${filePath}`, messages });

/** Build a fake ESLint message. */
const msg = (ruleId, extra = {}) => ({
  ruleId,
  line: 1,
  column: 1,
  message: 'boom',
  ...extra,
});

describe('collectCounts', () => {
  it('counts violations per file and per rule', () => {
    const counts = collectCounts(
      [file('a.ts', [msg('jsx-a11y/alt-text'), msg('jsx-a11y/alt-text'), msg('eqeqeq')])],
      ROOT,
    );

    expect(counts).toEqual({ 'a.ts': { eqeqeq: 1, 'jsx-a11y/alt-text': 2 } });
  });

  it('counts warnings as well as errors, because a warning is still debt we do not want more of', () => {
    const counts = collectCounts([file('a.ts', [msg('eqeqeq', { severity: 1 })])], ROOT);

    expect(counts['a.ts'].eqeqeq).toBe(1);
  });

  // T7 — a file that fails to parse is a file that is NOT linted. Letting it into
  // the snapshot would silently hide a hole in lint coverage forever.
  it('excludes fatal parse errors so they can never be baselined', () => {
    const results = [file('broken.ts', [msg(null, { fatal: true, message: 'Parsing error' })])];

    expect(collectCounts(results, ROOT)).toEqual({});
    expect(findFatals(results, ROOT)).toEqual([
      { file: 'broken.ts', line: 1, message: 'Parsing error' },
    ]);
  });

  // T8
  it('buckets messages without a rule id under (no-rule)', () => {
    const counts = collectCounts([file('a.ts', [msg(null)])], ROOT);

    expect(counts['a.ts']).toEqual({ [NO_RULE]: 1 });
  });

  // T9 — the snapshot is committed and shared, so its keys must not depend on
  // the OS of the machine that generated it.
  it('normalises Windows paths to repo-relative POSIX keys', () => {
    const counts = collectCounts(
      [{ filePath: 'C:\\repo\\src\\a.ts', messages: [msg('eqeqeq')] }],
      'C:\\repo',
    );

    expect(Object.keys(counts)).toEqual(['src/a.ts']);
  });

  it('leaves paths outside the root untouched rather than emitting ../ keys', () => {
    expect(toPosixRelative('/elsewhere/a.ts', ROOT)).toBe('/elsewhere/a.ts');
  });
});

describe('findRegressions', () => {
  // T1
  it('flags a count above the snapshot', () => {
    const counts = { 'a.ts': { eqeqeq: 3 } };
    const snapshot = { files: { 'a.ts': { eqeqeq: 2 } } };

    expect(findRegressions(counts, snapshot)).toEqual([
      { file: 'a.ts', rule: 'eqeqeq', count: 3, allowed: 2 },
    ]);
  });

  // T2
  it('accepts a count equal to the snapshot', () => {
    const counts = { 'a.ts': { eqeqeq: 2 } };

    expect(findRegressions(counts, { files: counts })).toEqual([]);
  });

  // T3
  it('accepts a count below the snapshot', () => {
    const counts = { 'a.ts': { eqeqeq: 1 } };
    const snapshot = { files: { 'a.ts': { eqeqeq: 2 } } };

    expect(findRegressions(counts, snapshot)).toEqual([]);
    // …and the caller must notice the snapshot is now stale so the ratchet tightens.
    expect(JSON.stringify(counts)).not.toBe(JSON.stringify(snapshot.files));
  });

  // T4 — the core of the contract: new code is held to zero.
  it('flags a brand-new file, since an absent entry allows nothing', () => {
    const counts = { 'new.ts': { 'jsx-a11y/alt-text': 1 } };

    expect(findRegressions(counts, { files: {} })).toEqual([
      { file: 'new.ts', rule: 'jsx-a11y/alt-text', count: 1, allowed: 0 },
    ]);
  });

  // T5 — this is why the snapshot is keyed file × rule and not just by file.
  it('flags a new rule in a file already baselined for another rule', () => {
    const counts = { 'a.ts': { 'react-hooks/exhaustive-deps': 2, 'jsx-a11y/alt-text': 1 } };
    const snapshot = { files: { 'a.ts': { 'react-hooks/exhaustive-deps': 2 } } };

    expect(findRegressions(counts, snapshot)).toEqual([
      { file: 'a.ts', rule: 'jsx-a11y/alt-text', count: 1, allowed: 0 },
    ]);
  });

  // T6
  it('does not flag a snapshot entry whose file no longer reports anything', () => {
    const snapshot = { files: { 'deleted.ts': { eqeqeq: 5 } } };

    expect(findRegressions({}, snapshot)).toEqual([]);
    // The stale entry must not linger: counts differ, so the caller rewrites.
    expect(JSON.stringify({})).not.toBe(JSON.stringify(snapshot.files));
  });

  it('treats a missing snapshot as allowing nothing', () => {
    const counts = { 'a.ts': { eqeqeq: 1 } };

    expect(findRegressions(counts, {})).toHaveLength(1);
  });
});

describe('serialise', () => {
  // T10 — unsorted keys would produce noisy, conflict-prone diffs on a file that
  // every branch touches.
  it('sorts file and rule keys so the snapshot diff stays minimal and stable', () => {
    const sorted = sortCounts({
      'z.ts': { zebra: 1, alpha: 2 },
      'a.ts': { beta: 3 },
    });

    expect(Object.keys(sorted)).toEqual(['a.ts', 'z.ts']);
    expect(Object.keys(sorted['z.ts'])).toEqual(['alpha', 'zebra']);
    // Key order is what JSON.stringify serialises, so the equality check the
    // ratchet uses to detect an improvement is only reliable if order is stable.
    expect(serialise(sorted)).toBe(serialise(sortCounts(sorted)));
  });

  it('ends with a trailing newline so the file is POSIX-clean', () => {
    expect(serialise({ 'a.ts': { eqeqeq: 1 } }).endsWith('\n')).toBe(true);
  });

  it('reports the total as the sum of every file/rule count', () => {
    expect(totalOf({ 'a.ts': { x: 2, y: 3 }, 'b.ts': { z: 4 } })).toBe(9);
  });
});
