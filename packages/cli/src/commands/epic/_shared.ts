import { die, err } from '../../core/colors.ts';
import { apiBase, apiGet } from '../../core/api.ts';
import { matchById } from '../../core/match.ts';
import chalk from 'chalk';

export interface Epic {
  id: string;
  name: string;
  emoji?: string;
}

/**
 * Resolve an epic reference (full UUID or unique 8-char prefix, with an optional
 * leading `#`) to its full record. Ambiguous prefixes are surfaced rather than
 * silently resolving to the first match — a stray prefix must never mutate the
 * wrong epic.
 */
export async function resolveEpic(input: string): Promise<Epic> {
  const epics = await apiGet<Epic[]>(`${apiBase()}/api/epics`);
  const result = matchById(epics, input);
  if (result.kind === 'found') return result.item;
  if (result.kind === 'ambiguous') {
    err(`"${input}" matches multiple epics — use a longer prefix or the full UUID:`);
    for (const e of result.matches) {
      process.stderr.write(`  ${e.id.slice(0, 8)}  ${e.emoji ?? ''} ${e.name}\n`);
    }
    process.exit(1);
  }
  die(`Epic not found: ${input}`);
}

/** Convenience wrapper returning just the resolved UUID. */
export async function resolveEpicId(input: string): Promise<string> {
  return (await resolveEpic(input)).id;
}

export const VALID_TIMEFRAMES = ['now', 'next', 'later'] as const;
export type Timeframe = typeof VALID_TIMEFRAMES[number];

export function assertValidTimeframe(t: string): asserts t is Timeframe {
  if (!VALID_TIMEFRAMES.includes(t as Timeframe)) {
    die(`Invalid timeframe: ${t} (valid: ${VALID_TIMEFRAMES.join(', ')})`);
  }
}

export function epicStatusColor(status: string): (s: string) => string {
  switch (status) {
    case 'active':
    case 'done':
      return chalk.green;
    case 'archived':
      return chalk.dim;
    default:
      return (s) => s;
  }
}

export function timeframeOrder(t?: string | null): number {
  if (t === 'now') return 0;
  if (t === 'next') return 1;
  if (t === 'later') return 2;
  return 3;
}
