import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeForStorage, sanitizeForStorageDeep, hasUnstorableChars } from '@fleex/shared';

// ─────────────────────────────────────────────────────────────────────────────
// D5 / spec §0 — this file contains NO literal escape sequence and no raw NUL.
// Every target code unit, and the backslash itself, is built at runtime. A
// literal here would be re-armed every time an agent quotes this file into a
// JSON payload (see spec §2.2). AC 11 asserts this property on itself.
// ─────────────────────────────────────────────────────────────────────────────
const cu = (n: number) => String.fromCharCode(n);
const BS = cu(92); // backslash
const NUL = cu(0);
const HI = cu(0xd83d); // lone high surrogate
const LO = cu(0xde00); // lone low surrogate
const escOf = (ch: string) => BS + 'u' + ch.charCodeAt(0).toString(16).padStart(4, '0');

/** Inputs that must survive verbatim — the non-objective guard of D1. */
const STORABLE = [
  ['plain text', 'hello world'],
  ['tab', 'a' + cu(9) + 'b'],
  ['newline', 'a' + cu(10) + 'b'],
  ['carriage return', 'a' + cu(13) + 'b'],
  ['bell (other C0 control)', 'a' + cu(7) + 'b'],
  ['accents', 'éàüïôç'],
  ['CJK', '漢字仮名'],
  ['valid surrogate pair', String.fromCodePoint(0x1f600)],
  ['ZWJ emoji family', '👨‍👩‍👧‍👦'],
  ['RTL mark', 'a' + cu(0x200f) + 'b'],
  ['zero-width space', 'a' + cu(0x200b) + 'b'],
] as const;

/** Inputs holding something a Postgres `text` column cannot accept. */
const UNSTORABLE = [
  ['NUL alone', NUL, escOf(NUL)],
  ['NUL in the middle', 'a' + NUL + 'b', 'a' + escOf(NUL) + 'b'],
  ['lone high surrogate', 'a' + HI + 'b', 'a' + escOf(HI) + 'b'],
  ['lone low surrogate', 'a' + LO + 'b', 'a' + escOf(LO) + 'b'],
  ['reversed pair (low then high)', LO + HI, escOf(LO) + escOf(HI)],
] as const;

describe('sanitizeForStorage', () => {
  it('returns the same reference when the text is already storable', () => {
    // AC 1 — the fast path must not allocate on the overwhelmingly common case.
    const clean = 'hello world';
    expect(sanitizeForStorage(clean)).toBe(clean);
  });

  it('escapes a NUL into its six-character escape', () => {
    // AC 2 — the exact character that killed attempt 1 of this ticket.
    const out = sanitizeForStorage(NUL);
    expect(out).toBe(escOf(NUL));
    expect(out).toHaveLength(6);
  });

  it.each(UNSTORABLE)('escapes %s', (_name, input, expected) => {
    // AC 2, AC 3
    expect(sanitizeForStorage(input)).toBe(expected);
  });

  it.each(STORABLE)('leaves %s untouched, same reference', (_name, input) => {
    // AC 4, AC 5 — a valid surrogate pair is NOT two lone surrogates, and this
    // is not a text cleaner: control characters and marks are stored verbatim.
    expect(sanitizeForStorage(input)).toBe(input);
  });

  it('is idempotent over every case', () => {
    // AC 6 — the output holds no target code unit left, so f(f(x)) === f(x).
    for (const [, input] of [...STORABLE, ...UNSTORABLE.map(([n, i]) => [n, i] as const)]) {
      const once = sanitizeForStorage(input);
      expect(sanitizeForStorage(once)).toBe(once);
    }
  });

  it('leaves no unstorable code unit in any output', () => {
    // AC 10 — the central invariant. Asserted on CODE UNITS, never as a
    // substring of JSON.stringify: after escaping, the serialiser doubles the
    // backslash and the tail of the serialised text IS the sequence being
    // searched for, so a substring assertion fails on correct output (spec §6.0).
    for (const [, input] of UNSTORABLE) {
      expect(hasUnstorableChars(sanitizeForStorage(input))).toBe(false);
    }
    const roundTripped = JSON.parse(JSON.stringify(sanitizeForStorage('a' + NUL + 'b')));
    expect(roundTripped.includes(NUL)).toBe(false);
  });
});

describe('hasUnstorableChars', () => {
  it.each(UNSTORABLE)('detects %s', (_name, input) => {
    expect(hasUnstorableChars(input)).toBe(true);
  });

  it.each(STORABLE)('reports %s as storable', (_name, input) => {
    expect(hasUnstorableChars(input)).toBe(false);
  });

  it('does not leak regex state between calls', () => {
    // A shared /g regex keeps lastIndex — a stateful bug here would make the
    // sanitizer skip characters depending on what was checked before it.
    expect(hasUnstorableChars('a' + NUL + 'b')).toBe(true);
    expect(hasUnstorableChars('a' + NUL + 'b')).toBe(true);
    expect(hasUnstorableChars('clean')).toBe(false);
    expect(hasUnstorableChars('a' + NUL + 'b')).toBe(true);
  });
});

describe('sanitizeForStorageDeep', () => {
  it('escapes both values and keys of nested objects and arrays', () => {
    // AC 7 — a NUL in an object key breaks the same Postgres jsonb cast.
    const input = {
      ['bad' + NUL + 'key']: 'plain',
      nested: { deliverable: { markdown: 'spec ' + NUL + ' body' } },
      list: ['clean', 'a' + HI + 'b', { deep: NUL }],
    };

    const out = sanitizeForStorageDeep(input);

    expect(out['bad' + escOf(NUL) + 'key']).toBe('plain');
    expect(out.nested.deliverable.markdown).toBe('spec ' + escOf(NUL) + ' body');
    expect(out.list[0]).toBe('clean');
    expect(out.list[1]).toBe('a' + escOf(HI) + 'b');
    expect((out.list[2] as { deep: string }).deep).toBe(escOf(NUL));
  });

  it('passes scalars and Dates through untouched', () => {
    // AC 8
    const date = new Date('2026-01-01T00:00:00.000Z');
    const input = { n: 42, b: true, nil: null, undef: undefined, date };

    const out = sanitizeForStorageDeep(input);

    expect(out.n).toBe(42);
    expect(out.b).toBe(true);
    expect(out.nil).toBeNull();
    expect(out.undef).toBeUndefined();
    expect(out.date).toBe(date);
  });

  it('returns the same reference when nothing changed', () => {
    // AC 9 — every step transition walks StepOutput; a clean walk must not
    // clone the tree.
    const input = { schemaFields: { a: 'x' }, list: ['y'], n: 1 };
    expect(sanitizeForStorageDeep(input)).toBe(input);
  });

  it('leaves no unstorable code unit anywhere in the result', () => {
    // AC 10 applied to the deep walk.
    const out = sanitizeForStorageDeep({
      title: 'a' + NUL,
      nested: { list: ['b' + HI, { c: LO }] },
    });
    const strings: string[] = [];
    const walk = (v: unknown): void => {
      if (typeof v === 'string') strings.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') {
        for (const [k, val] of Object.entries(v)) {
          strings.push(k);
          walk(val);
        }
      }
    };
    walk(out);
    expect(strings.length).toBeGreaterThan(0);
    for (const s of strings) expect(hasUnstorableChars(s)).toBe(false);
  });

  it('stops recursing past the depth guard instead of blowing the stack', () => {
    // Contract table in spec §4.1: depth > 32 is returned as-is. A pathological
    // structure must degrade, not crash the whole save.
    let deep: Record<string, unknown> = { leaf: NUL };
    for (let i = 0; i < 60; i++) deep = { down: deep };

    expect(() => sanitizeForStorageDeep(deep)).not.toThrow();
  });

  it('escapes a bare string argument', () => {
    expect(sanitizeForStorageDeep('a' + NUL + 'b')).toBe('a' + escOf(NUL) + 'b');
  });
});

describe('D5 — the module and its own test hold no literal escape sequence', () => {
  // AC 11. Built at runtime so that this very assertion cannot re-arm the mine
  // it is guarding against.
  const LITERAL_ESCAPE = new RegExp(BS + BS + 'u[0-9a-fA-F]{4}');
  const here = dirname(fileURLToPath(import.meta.url));

  it.each([
    ['the sanitizer module', join(here, '..', '..', '..', 'shared', 'src', 'utils', 'storage-safe-text.ts')],
    ['this test file', fileURLToPath(import.meta.url)],
  ])('%s contains no literal escape sequence and no raw NUL', (_name, path) => {
    const source = readFileSync(path, 'utf8');
    expect(LITERAL_ESCAPE.test(source)).toBe(false);
    expect(source.includes(NUL)).toBe(false);
  });
});
