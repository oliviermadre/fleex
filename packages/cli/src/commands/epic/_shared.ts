import { die } from '../../core/colors.ts';
import { apiBase, apiGet } from '../../core/api.ts';
import chalk from 'chalk';

export async function resolveEpicId(input: string): Promise<string> {
  if (input.length >= 36) return input;
  const base = apiBase();
  const epics = await apiGet<{ id: string }[]>(`${base}/api/epics`);
  const match = epics.find((e) => e.id.startsWith(input));
  if (!match) die(`Epic not found: ${input}`);
  return match.id;
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
