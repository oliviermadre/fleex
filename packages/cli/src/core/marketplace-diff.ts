import type { MarketplacePrimitiveContent } from '@fleex/shared';

import { c } from './colors.ts';

// Recursively sort object keys (arrays keep order) for stable comparison.
function sortValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = sortValue((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

// memoryMd is personal state, never part of the shared "identity" of a
// primitive — exclude it from comparison so memory never triggers a diff.
function stripVolatile(content: MarketplacePrimitiveContent): Record<string, unknown> {
  const { memoryMd, ...rest } = content as unknown as Record<string, unknown>;
  return rest;
}

export function canonicalString(content: MarketplacePrimitiveContent): string {
  return JSON.stringify(sortValue(stripVolatile(content)));
}

export function contentEquals(
  a: MarketplacePrimitiveContent,
  b: MarketplacePrimitiveContent,
): boolean {
  return canonicalString(a) === canonicalString(b);
}

type DiffLine = { t: '=' | '-' | '+'; l: string };

// LCS-based line diff.
function lineDiff(a: string[], b: string[]): DiffLine[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ t: '=', l: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ t: '-', l: a[i++]! });
    } else {
      out.push({ t: '+', l: b[j++]! });
    }
  }
  while (i < n) out.push({ t: '-', l: a[i++]! });
  while (j < m) out.push({ t: '+', l: b[j++]! });
  return out;
}

function asText(v: unknown): string {
  if (v === undefined) return '';
  return typeof v === 'string' ? v : JSON.stringify(sortValue(v), null, 2);
}

/**
 * Render a per-field diff of local vs marketplace content.
 * Convention: "- " (red) = your local version, "+ " (green) = marketplace.
 */
export function renderDiff(
  local: MarketplacePrimitiveContent,
  incoming: MarketplacePrimitiveContent,
): string {
  const L = stripVolatile(local);
  const M = stripVolatile(incoming);
  const keys = [...new Set([...Object.keys(L), ...Object.keys(M)])].sort();
  const lines: string[] = [c.dim('  (- your local · + marketplace)')];
  for (const k of keys) {
    if (JSON.stringify(sortValue(L[k])) === JSON.stringify(sortValue(M[k]))) continue;
    lines.push(c.bold(`  ${k}:`));
    for (const d of lineDiff(asText(L[k]).split('\n'), asText(M[k]).split('\n'))) {
      if (d.t === '=') lines.push(c.dim(`      ${d.l}`));
      else if (d.t === '-') lines.push(c.red(`    - ${d.l}`));
      else lines.push(c.green(`    + ${d.l}`));
    }
  }
  return lines.join('\n');
}
