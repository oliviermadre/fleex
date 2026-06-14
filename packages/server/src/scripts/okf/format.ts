/**
 * Pure text/normalization helpers for OKF rendering.
 *
 * Determinism rule (spec §7.4): no wall-clock time. Timestamps are normalized
 * purely by string manipulation of the stored ISO value — we never construct a
 * `new Date()` / call `Date.now()`. All DTO timestamps come from
 * `Date.prototype.toISOString()` (UTC, `YYYY-MM-DDTHH:MM:SS.sssZ`), so we can
 * trim sub-second precision with a regex and compare them lexically.
 */

/** Normalize an ISO timestamp to second precision UTC: `YYYY-MM-DDTHH:MM:SSZ`. */
export function toZ(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
  return m ? `${m[1]}Z` : String(iso);
}

/** Extract the `YYYY-MM-DD` day from an ISO timestamp. */
export function dayOf(iso: string | null | undefined): string {
  return toZ(iso).slice(0, 10);
}

/**
 * Pick the later of two ISO timestamps (lexical compare is valid because both
 * are UTC `toISOString()` output). Empty strings sort lowest.
 */
export function maxIso(a: string | null | undefined, b: string | null | undefined): string {
  const sa = a ?? '';
  const sb = b ?? '';
  return sa >= sb ? sa : sb;
}

/** Collapse all runs of whitespace to a single space and trim. */
export function flatten(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

/** First non-empty, trimmed line of a string (empty string if none). */
export function firstLine(s: string | null | undefined): string {
  for (const line of (s ?? '').split('\n')) {
    const t = line.trim();
    if (t.length > 0) return t;
  }
  return '';
}

/**
 * A single-line summary: flatten, take the first sentence (up to the first
 * `.`/`!`/`?`), and hard-cap at `max` characters with an ellipsis.
 */
export function summarizeOneLine(s: string | null | undefined, max = 200): string {
  const flat = flatten(s);
  if (!flat) return '';
  const sentence = flat.match(/^(.*?[.!?])(\s|$)/);
  let out = sentence?.[1] ?? flat;
  if (out.length > max) out = `${out.slice(0, max).trimEnd()}…`;
  return out;
}
