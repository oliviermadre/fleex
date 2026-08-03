import { stdin as input, stdout as output } from 'node:process';
import * as readline from 'node:readline/promises';

import { c } from './colors.ts';

// Lazily-created shared readline interface. Call closePrompts() once the
// interactive flow is done so the process can exit cleanly.
let rl: readline.Interface | null = null;
function io(): readline.Interface {
  if (!rl) rl = readline.createInterface({ input, output });
  return rl;
}

export function closePrompts(): void {
  if (rl) {
    rl.close();
    rl = null;
  }
}

/** True when we have a real TTY to prompt on (false under pipes/CI). */
export function canPrompt(): boolean {
  return Boolean(input.isTTY);
}

export async function promptText(question: string, def?: string): Promise<string> {
  const hint = def ? c.dim(` [${def}]`) : '';
  const answer = (await io().question(`${c.bold('?')} ${question}${hint} `)).trim();
  return answer || def || '';
}

export async function promptYesNo(question: string, def = true): Promise<boolean> {
  const hint = def ? 'Y/n' : 'y/N';
  const answer = (await io().question(`${c.bold('?')} ${question} ${c.dim(`[${hint}]`)} `))
    .trim()
    .toLowerCase();
  if (!answer) return def;
  return answer === 'y' || answer === 'yes';
}

/**
 * Parse a selection expression like "1,3,5-7" or "all" / "none" into a set of
 * 1-based indices. Empty string means "none".
 */
function parseSelection(expr: string, count: number): Set<number> {
  const trimmed = expr.trim().toLowerCase();
  const selected = new Set<number>();
  if (trimmed === '' || trimmed === 'none') return selected;
  if (trimmed === 'all' || trimmed === '*') {
    for (let i = 1; i <= count; i++) selected.add(i);
    return selected;
  }
  for (const part of trimmed.split(',')) {
    const token = part.trim();
    if (!token) continue;
    const range = token.match(/^(\d+)-(\d+)$/);
    if (range) {
      const lo = Number(range[1]);
      const hi = Number(range[2]);
      for (let i = Math.min(lo, hi); i <= Math.max(lo, hi); i++) {
        if (i >= 1 && i <= count) selected.add(i);
      }
    } else if (/^\d+$/.test(token)) {
      const i = Number(token);
      if (i >= 1 && i <= count) selected.add(i);
    }
  }
  return selected;
}

/** Numbered single-select. Returns the chosen item, or undefined if none. */
export async function promptSelectOne<T>(
  label: string,
  items: readonly T[],
  render: (item: T) => string,
): Promise<T | undefined> {
  if (items.length === 0) return undefined;
  output.write(`\n${c.bold(label)}\n`);
  items.forEach((item, i) => {
    output.write(`  ${c.cyan(String(i + 1))}) ${render(item)}\n`);
  });
  const answer = (await io().question(c.dim('  select one: '))).trim();
  const idx = Number(answer);
  if (!Number.isInteger(idx) || idx < 1 || idx > items.length) return undefined;
  return items[idx - 1];
}

/**
 * Numbered multi-select. Prints a labeled, numbered list and lets the user
 * pick with a comma/range expression ("1,3,5-7", "all", or empty for none).
 * Dependency-free and works over any terminal.
 */
export async function promptMultiSelect<T>(
  label: string,
  items: readonly T[],
  render: (item: T) => string,
): Promise<T[]> {
  if (items.length === 0) return [];
  output.write(`\n${c.bold(label)}\n`);
  items.forEach((item, i) => {
    output.write(`  ${c.cyan(String(i + 1))}) ${render(item)}\n`);
  });
  const answer = await io().question(c.dim('  select (e.g. 1,3,5-7 · "all" · empty to skip): '));
  const picked = parseSelection(answer, items.length);
  return items.filter((_, i) => picked.has(i + 1));
}
