/**
 * Escapes the only two classes of characters a Postgres `text` column cannot
 * hold, so that persisting agent- or human-authored text can never fail:
 *
 *   - U+0000 (NUL)                -> "22P05 unsupported Unicode escape sequence"
 *   - unpaired UTF-16 surrogates  -> "22P02 Unicode low surrogate must follow
 *                                     a high surrogate"
 *
 * Everything else is stored verbatim: tabs, newlines, carriage returns, other
 * C0 controls, accents, CJK, emoji, valid surrogate pairs, RTL and zero-width
 * marks. This is a STORAGE GUARANTEE, not a text cleaner — do not widen it.
 *
 * Offending code units are escaped rather than removed. The only realistic way
 * a NUL reaches a deliverable is an agent *writing about* an escape sequence:
 * it authors the six visible characters, and a single dropped backslash in the
 * emitted JSON makes the parser yield one real NUL. Removing it would silently
 * gut the sentence; escaping restores exactly what the author meant to write.
 * The transform is idempotent — its output holds no target code unit left.
 *
 * NOTE — deliberate: this file contains NO literal escape sequence. Every
 * target code unit, and the backslash itself, is built with fromCharCode, and
 * the pattern is assembled at runtime. This module is the likeliest file in the
 * repo to be read and then quoted back by an agent into a JSON payload, which
 * is precisely how the NUL is born. A literal here would be a mine re-armed on
 * every citation. Do NOT "simplify" this into a regex literal.
 */

const cu = (n: number): string => String.fromCharCode(n);

const BS = cu(92); // backslash
const HIGH = '[' + cu(0xd800) + '-' + cu(0xdbff) + ']';
const LOW = '[' + cu(0xdc00) + '-' + cu(0xdfff) + ']';

const PATTERN = cu(0) + '|' + HIGH + '(?!' + LOW + ')|(?<!' + HIGH + ')' + LOW;

// Two instances on purpose: the non-global one is stateless, so detection can
// never be perturbed by a previous call's `lastIndex`.
const DETECT = new RegExp(PATTERN);
const DETECT_ALL = new RegExp(PATTERN, 'g');

/** Maximum nesting `sanitizeForStorageDeep` will descend into. */
const MAX_DEPTH = 32;

/**
 * Does this string still hold a code unit that a `text` column would reject?
 *
 * Exported because this — not a substring check on `JSON.stringify` — is the
 * correct way to assert the invariant. After escaping, the serialiser doubles
 * the backslash, and the tail of the serialised text *is* the escape sequence
 * one would naively search for, so a substring assertion fails on output that
 * is perfectly storable.
 */
export function hasUnstorableChars(value: string): boolean {
  return DETECT.test(value);
}

/**
 * Replaces each unstorable code unit with its six-character escape.
 * Returns the original reference untouched when there is nothing to escape.
 */
export function sanitizeForStorage(value: string): string {
  if (!DETECT.test(value)) return value;
  return value.replace(
    DETECT_ALL,
    (ch) => BS + 'u' + ch.charCodeAt(0).toString(16).padStart(4, '0'),
  );
}

/** Plain JSON object — excludes Date, Map, Set and class instances. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function sanitizeDeep(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return sanitizeForStorage(value);

  // Guard against pathological nesting: stop descending rather than risk
  // blowing the stack on a whole save.
  if (depth >= MAX_DEPTH) return value;

  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((item) => {
      const next = sanitizeDeep(item, depth + 1);
      if (next !== item) changed = true;
      return next;
    });
    return changed ? out : value;
  }

  if (isPlainObject(value)) {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const nextKey = sanitizeForStorage(key);
      const nextItem = sanitizeDeep(item, depth + 1);
      if (nextKey !== key || nextItem !== item) changed = true;
      out[nextKey] = nextItem;
    }
    return changed ? out : value;
  }

  return value;
}

/**
 * `sanitizeForStorage` applied recursively to a plain JSON value — object keys
 * included, since a NUL in a key breaks the same jsonb cast. Returns the
 * original reference when nothing changed, so hydrating clean data is free.
 */
export function sanitizeForStorageDeep<T>(value: T): T {
  return sanitizeDeep(value, 0) as T;
}
