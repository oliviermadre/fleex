/**
 * The `lecture` / `écriture` / `destructif` badge on a Bash line running `fleex`.
 *
 * Display only — nothing is blocked. The access of each command comes from
 * the installed CLI's own catalogue (`fleex documentation --format json`), so
 * the badge follows the CLI even when it is updated separately.
 */
import { runFleexArgv, type ExecOptions } from '@fleex/mcp';

export type Access = 'read' | 'write' | 'destructive';

/** Command path ("ticket list") → access. */
export type AccessCatalog = Map<string, Access>;

const RANK: Record<Access, number> = { read: 0, write: 1, destructive: 2 };

/** Global options that take a value, to skip together with it. */
const VALUE_OPTIONS = new Set(['--workspace', '-w']);

export function catalogFromDocumentation(doc: unknown): AccessCatalog {
  const catalog: AccessCatalog = new Map();
  const commands = (doc as { commands?: unknown })?.commands;
  if (!Array.isArray(commands)) return catalog;
  for (const c of commands) {
    const o = c as { path?: unknown; access?: unknown };
    if (typeof o.path !== 'string') continue;
    if (o.access !== 'read' && o.access !== 'write' && o.access !== 'destructive') continue;
    catalog.set(o.path.replace(/^fleex\s+/, ''), o.access);
  }
  return catalog;
}

/** Load the catalogue from the installed CLI; empty (no badges) if it cannot be read. */
export async function loadAccessCatalog(execOpts: ExecOptions = {}): Promise<AccessCatalog> {
  try {
    const res = await runFleexArgv(['documentation', '--format', 'json'], { ...execOpts, timeoutMs: 30_000 });
    if (!res.ok) return new Map();
    return catalogFromDocumentation(JSON.parse(res.stdout));
  } catch {
    return new Map();
  }
}

/** Split on `|`, `&&`, `||`, `;` and newlines, outside quotes. `$(…)` bodies are blanked: a fleex there gets no badge. */
function segments(command: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: string | null = null;
  let subst = 0;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      if (!subst) cur += ch;
      continue;
    }
    if (ch === '$' && command[i + 1] === '(') {
      subst++;
      i++;
      continue;
    }
    if (subst) {
      if (ch === '(') subst++;
      else if (ch === ')') subst--;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
      continue;
    }
    const two = command.slice(i, i + 2);
    if (two === '&&' || two === '||') {
      out.push(cur);
      cur = '';
      i++;
      continue;
    }
    if (ch === '|' || ch === ';' || ch === '\n') {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function words(segment: string): string[] {
  return segment.trim().split(/\s+/).filter(Boolean);
}

/** Access of one segment, or undefined when it does not run a known `fleex` command. */
function segmentAccess(segment: string, catalog: AccessCatalog): Access | undefined {
  const w = words(segment);
  let k = 0;
  while (k < w.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[k]!)) k++; // VAR=x prefixes
  const head = w[k];
  if (!head || !(head === 'fleex' || head.endsWith('/fleex'))) return undefined;
  const path: string[] = [];
  for (let i = k + 1; i < w.length; i++) {
    const t = w[i]!;
    if (t.startsWith('-')) {
      if (VALUE_OPTIONS.has(t)) i++;
      continue;
    }
    if (/^["']/.test(t)) break; // a quoted argument: the command path is over
    path.push(t);
  }
  for (let len = path.length; len > 0; len--) {
    const access = catalog.get(path.slice(0, len).join(' '));
    if (access) return access;
  }
  return undefined;
}

/** The strictest access among the `fleex` commands a Bash line runs (T9), or undefined. */
export function bashAccess(command: string, catalog: AccessCatalog): Access | undefined {
  let best: Access | undefined;
  for (const s of segments(command)) {
    const a = segmentAccess(s, catalog);
    if (a && (!best || RANK[a] > RANK[best])) best = a;
  }
  return best;
}
