import { describe, expect, it } from 'vitest';

import {
  NO_RULE,
  collectCounts,
  compareAgainstReference,
  diffBaselines,
  findFatals,
  findRegressions,
  formatDelta,
  heaviestRule,
  nearZeroRules,
  parseRenames,
  remapRenames,
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

describe('parseRenames', () => {
  it('reads the rename pairs out of git --name-status output', () => {
    const out = ['R096\told/Foo.tsx\tnew/Foo.tsx', 'R100\ta.ts\tb.ts'].join('\n');

    expect(parseRenames(out)).toEqual([
      { from: 'old/Foo.tsx', to: 'new/Foo.tsx' },
      { from: 'a.ts', to: 'b.ts' },
    ]);
  });

  it('ignores non-rename status lines and blank input', () => {
    expect(parseRenames('M\ta.ts\nA\tb.ts\n')).toEqual([]);
    expect(parseRenames('')).toEqual([]);
  });
});

describe('remapRenames', () => {
  // T17 — the allowance has to travel with the file. If it did not, the only
  // way out of a rename would be regenerating the baseline, which is exactly
  // the escape hatch comparing against main exists to close.
  it('carries a baselined allowance across to the new path', () => {
    const reference = { 'old/Foo.tsx': { eqeqeq: 5 } };
    const remapped = remapRenames(reference, [{ from: 'old/Foo.tsx', to: 'new/Foo.tsx' }]);

    expect(remapped).toEqual({ 'new/Foo.tsx': { eqeqeq: 5 } });
    // …so simply moving the file is not a regression.
    expect(findRegressions({ 'new/Foo.tsx': { eqeqeq: 5 } }, { files: remapped })).toEqual([]);
  });

  // T18 — but the remap must not launder anything either.
  it('still flags a renamed file that got worse in the same move', () => {
    const remapped = remapRenames({ 'old/Foo.tsx': { eqeqeq: 5 } }, [
      { from: 'old/Foo.tsx', to: 'new/Foo.tsx' },
    ]);

    expect(findRegressions({ 'new/Foo.tsx': { eqeqeq: 7 } }, { files: remapped })).toEqual([
      { file: 'new/Foo.tsx', rule: 'eqeqeq', count: 7, allowed: 5 },
    ]);
  });

  it('leaves unrelated entries alone and tolerates renames of unbaselined files', () => {
    const reference = { 'kept.ts': { eqeqeq: 1 } };

    expect(remapRenames(reference, [{ from: 'never-baselined.ts', to: 'x.ts' }])).toEqual(
      reference,
    );
  });

  it('takes the larger allowance rather than summing, so a rename cannot manufacture headroom', () => {
    const remapped = remapRenames({ 'a.ts': { eqeqeq: 3 }, 'b.ts': { eqeqeq: 4 } }, [
      { from: 'a.ts', to: 'b.ts' },
    ]);

    expect(remapped).toEqual({ 'b.ts': { eqeqeq: 4 } });
  });
});

describe('compareAgainstReference', () => {
  const reference = {
    'a.ts': { 'no-explicit-any': 5 },
    'b.tsx': { 'jsx-a11y/alt-text': 2, 'no-floating-promises': 1 },
  };

  // Regression test for a real bug: the comparison used to hand findRegressions
  // a bare files map where it expects a { files } snapshot. Every allowance read
  // as 0, so an untouched branch reported its entire baseline as new violations.
  // Each part was unit-tested; only the wiring was not.
  it('reports nothing when the branch changed nothing', () => {
    const { regressions, diff } = compareAgainstReference(reference, reference);

    expect(regressions).toEqual([]);
    expect(diff.delta).toBe(0);
  });

  // AC14 — the hole this whole mechanism exists to close. Regenerating the
  // local snapshot cannot clear a regression, because the reference is main.
  it('catches a violation that was laundered through a regenerated baseline', () => {
    const laundered = { ...reference, 'new.tsx': { 'jsx-a11y/alt-text': 1 } };

    const { regressions } = compareAgainstReference(laundered, reference);

    expect(regressions).toEqual([
      { file: 'new.tsx', rule: 'jsx-a11y/alt-text', count: 1, allowed: 0 },
    ]);
  });

  // AC15 — a pure move must not need `lint:baseline`.
  it('lets a baselined file move without regressing', () => {
    const moved = { 'src/renamed.ts': { 'no-explicit-any': 5 }, 'b.tsx': reference['b.tsx'] };

    const { regressions } = compareAgainstReference(moved, reference, [
      { from: 'a.ts', to: 'src/renamed.ts' },
    ]);

    expect(regressions).toEqual([]);
  });

  // AC16 — but moving must not launder either.
  it('still catches a file that got worse while being moved', () => {
    const moved = { 'src/renamed.ts': { 'no-explicit-any': 6 }, 'b.tsx': reference['b.tsx'] };

    const { regressions } = compareAgainstReference(moved, reference, [
      { from: 'a.ts', to: 'src/renamed.ts' },
    ]);

    expect(regressions).toEqual([
      { file: 'src/renamed.ts', rule: 'no-explicit-any', count: 6, allowed: 5 },
    ]);
  });

  it('passes an improvement and records it as a negative delta', () => {
    const improved = { 'a.ts': { 'no-explicit-any': 1 }, 'b.tsx': reference['b.tsx'] };

    const { regressions, diff } = compareAgainstReference(improved, reference);

    expect(regressions).toEqual([]);
    expect(diff.delta).toBe(-4);
  });
});

describe('diffBaselines', () => {
  // T21 — the trap the `total` field invites: fixing five of one rule while
  // adding four of another lowers the total while making the repo worse. The
  // pass/fail decision therefore stays with findRegressions, keyed file × rule.
  it('surfaces a rule that grew even when the overall total fell', () => {
    const reference = { 'a.ts': { 'no-unused-vars': 5 } };
    const counts = { 'a.ts': { 'no-floating-promises': 4 } };

    const diff = diffBaselines(counts, reference);
    expect(diff.delta).toBe(-1);

    const grew = diff.byRule.find((entry) => entry.rule === 'no-floating-promises');
    expect(grew.delta).toBe(4);
    // …and the actual gate still fails, which is the point.
    expect(findRegressions(counts, { files: reference })).toHaveLength(1);
  });

  // T22
  it('lists a rule that dropped to zero as eliminated', () => {
    const diff = diffBaselines({ 'a.ts': { eqeqeq: 1 } }, { 'a.ts': { eqeqeq: 1, 'no-var': 3 } });

    expect(diff.eliminated).toEqual(['no-var']);
  });

  it('reports no movement when nothing changed', () => {
    const files = { 'a.ts': { eqeqeq: 2 } };
    const diff = diffBaselines(files, files);

    expect(diff).toMatchObject({ delta: 0, byRule: [], eliminated: [] });
  });

  it('attaches the offending files to an increased rule so the report is actionable', () => {
    const diff = diffBaselines({ 'b.ts': { 'jsx-a11y/alt-text': 2 } }, {});

    expect(diff.byRule[0].files).toEqual([{ file: 'b.ts', from: 0, to: 2 }]);
  });
});

describe('formatDelta', () => {
  // T20 — a reviewer must be able to read what moved without scrolling a
  // 693-line JSON diff.
  it('names each added file/rule pair and stays short', () => {
    const diff = diffBaselines({ 'src/Bar.tsx': { 'jsx-a11y/alt-text': 1 } }, {});
    const out = formatDelta(diff);

    expect(out).toContain('0 → 1');
    expect(out).toContain('jsx-a11y/alt-text');
    expect(out).toContain('✗');
    expect(out.split('\n').length).toBeLessThan(20);
  });

  it('celebrates an eliminated rule, so cleanup work produces a visible signal', () => {
    const diff = diffBaselines({}, { 'a.ts': { 'no-var': 3 } });
    const out = formatDelta(diff);

    expect(out).toContain('✨ rule eliminated');
    expect(out).toContain('3 → 0');
    expect(out).toContain('✓');
  });
});

describe('nearZeroRules', () => {
  it('surfaces the rules closest to being finished off, smallest first', () => {
    const counts = {
      'a.ts': { 'no-control-regex': 2, 'no-floating-promises': 100 },
      'b.ts': { 'no-control-regex': 2, 'exhaustive-deps': 13 },
    };

    expect(nearZeroRules(counts)).toEqual([
      { rule: 'no-control-regex', count: 4, files: 2 },
      { rule: 'exhaustive-deps', count: 13, files: 1 },
    ]);
    expect(heaviestRule(counts)).toEqual({ rule: 'no-floating-promises', count: 100, files: 1 });
  });

  it('has nothing to suggest on a clean repo', () => {
    expect(nearZeroRules({})).toEqual([]);
    expect(heaviestRule({})).toBeNull();
  });
});
