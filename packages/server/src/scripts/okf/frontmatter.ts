/**
 * Deterministic YAML frontmatter serialization (see spec §7.3).
 *
 * Only the small subset of YAML that OKF frontmatter needs is supported:
 * scalar strings/numbers/booleans/null and flow lists of strings. Keys are
 * emitted in the exact order they are passed (never object-insertion order),
 * `undefined` values are omitted, `null` is emitted explicitly.
 */

export type FmValue = string | number | boolean | null | string[];
export type FmPair = readonly [string, FmValue | undefined];

export function frontmatter(pairs: readonly FmPair[]): string {
  const lines: string[] = ['---'];
  for (const [key, value] of pairs) {
    if (value === undefined) continue;
    lines.push(`${key}: ${formatValue(value)}`);
  }
  lines.push('---');
  return lines.join('\n');
}

function formatValue(value: FmValue): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (Array.isArray(value)) return `[${value.map(formatString).join(', ')}]`;
  return formatString(value);
}

function formatString(s: string): string {
  return needsQuoting(s) ? quote(s) : s;
}

/**
 * A string is left unquoted only when it is unambiguously a plain YAML scalar:
 * starts with an alphanumeric, contains only a safe character set, has no
 * leading/trailing whitespace, and is not a YAML keyword or number-looking
 * token. Everything else is double-quoted. This is conservative on purpose —
 * over-quoting is always safe and stays deterministic.
 */
function needsQuoting(s: string): boolean {
  if (s === '') return true;
  if (/^[+-]?[0-9]/.test(s)) return true; // looks numeric
  if (/^(true|false|null|yes|no|on|off|~)$/i.test(s)) return true; // YAML keywords
  return !/^[A-Za-z][A-Za-z0-9 _./@-]*$/.test(s);
}

function quote(s: string): string {
  const escaped = s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}
