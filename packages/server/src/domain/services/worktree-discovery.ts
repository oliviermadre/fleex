import type { WorktreeActionItem, WorktreeRunMode } from '@fleex/shared';

/**
 * Runnable commands detected in a worktree's own files. Pure parsers: the
 * caller reads the files, these only turn their text into menu items, so each
 * rule is testable without a filesystem.
 */

/** A detected item, before layers decide its pin state. */
export type DetectedItem = Omit<WorktreeActionItem, 'pinned' | 'layer'>;

/** Detected commands open in a terminal by default: most of them are dev servers or watchers. */
const DETECTED_MODE: WorktreeRunMode = 'terminal';

/** POSIX single-quote, only when the word needs it (keeps `pnpm run dev` readable). */
export function shellWord(word: string): string {
  return /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`;
}

/**
 * JSON with comments and trailing commas (VS Code's launch.json dialect) →
 * plain JSON. String-aware, so a `//` inside a URL survives.
 */
export function stripJsonc(text: string): string {
  let out = '';
  let i = 0;
  let inString = false;
  while (i < text.length) {
    const ch = text[i]!;
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += next ?? '';
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i += 1;
    } else if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
    } else if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 2;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  const rec = asRecord(value);
  if (!rec) return undefined;
  const out = Object.fromEntries(Object.entries(rec).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
  return Object.keys(out).length ? out : undefined;
}

/** `${workspaceFolder}` is the worktree; returns a path relative to it, or undefined for the root. */
function relativeCwd(cwd: unknown): string | undefined {
  if (typeof cwd !== 'string' || !cwd.trim()) return undefined;
  const rel = cwd.trim().replace(/^\$\{workspaceFolder\}\/?/, '').replace(/^\.\//, '').replace(/\/$/, '');
  if (rel === '.') return undefined;
  // An absolute or escaping cwd is not something the worktree owns: ignore it rather than run elsewhere.
  if (!rel || rel.startsWith('/') || rel.split('/').includes('..')) return undefined;
  return rel;
}

/**
 * `.claude/launch.json`: one item per configuration. The command is
 * `runtimeExecutable runtimeArgs…`, or `node program args…`.
 */
export function parseLaunchJson(text: string): DetectedItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonc(text));
  } catch {
    return [];
  }
  const configurations = asRecord(parsed)?.['configurations'];
  if (!Array.isArray(configurations)) return [];
  const items: DetectedItem[] = [];
  const seen = new Set<string>();
  for (const raw of configurations) {
    const conf = asRecord(raw);
    const name = typeof conf?.['name'] === 'string' ? conf['name'].trim() : '';
    if (!conf || !name || seen.has(name)) continue;
    const words = (value: unknown) => (Array.isArray(value) ? value.filter((w): w is string => typeof w === 'string') : []);
    let argv: string[] = [];
    if (typeof conf['runtimeExecutable'] === 'string' && conf['runtimeExecutable'].trim()) {
      argv = [conf['runtimeExecutable'].trim(), ...words(conf['runtimeArgs']), ...words(conf['args'])];
    } else if (typeof conf['program'] === 'string' && conf['program'].trim()) {
      argv = ['node', conf['program'].trim().replace(/^\$\{workspaceFolder\}\//, ''), ...words(conf['args'])];
    }
    if (argv.length === 0) continue;
    seen.add(name);
    const port = typeof conf['port'] === 'number' && Number.isInteger(conf['port']) && conf['port'] > 0 ? conf['port'] : undefined;
    const cwd = relativeCwd(conf['cwd']);
    const env = stringRecord(conf['env']);
    items.push({
      id: `launch:${name}`,
      source: 'launch',
      label: name,
      command: argv.map(shellWord).join(' '),
      mode: DETECTED_MODE,
      ...(cwd ? { cwd } : {}),
      ...(env ? { env } : {}),
      ...(port ? { port } : {}),
      ...(conf['autoPort'] === true ? { autoPort: true } : {}),
      ...(typeof conf['url'] === 'string' && conf['url'].trim() ? { url: conf['url'].trim() } : {}),
    });
  }
  return items;
}

export type PackageManager = 'pnpm' | 'yarn' | 'bun' | 'npm';

/** From the lockfiles present at the worktree root, in that priority order. */
export function detectPackageManager(files: ReadonlySet<string>): PackageManager {
  if (files.has('pnpm-lock.yaml')) return 'pnpm';
  if (files.has('yarn.lock')) return 'yarn';
  if (files.has('bun.lock') || files.has('bun.lockb')) return 'bun';
  return 'npm';
}

function runScript(pm: PackageManager, script: string): string {
  const word = shellWord(script);
  return pm === 'yarn' ? `yarn ${word}` : `${pm} run ${word}`;
}

export function parsePackageJson(text: string, pm: PackageManager): DetectedItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const scripts = asRecord(asRecord(parsed)?.['scripts']);
  if (!scripts) return [];
  return Object.entries(scripts)
    .filter(([name, body]) => name.trim() && typeof body === 'string')
    .map(([name]) => ({ id: `npm:${name}`, source: 'npm' as const, label: name, command: runScript(pm, name), mode: DETECTED_MODE }));
}

// A target name at line start, then `:` that is not an assignment (`:=`, `::=`).
const MAKE_TARGET = /^([A-Za-z0-9][\w.-]*)\s*:(?![:=])/;

/** Makefile targets in file order — no special (`.PHONY`), pattern (`%`) or variable lines. */
export function parseMakefile(text: string): DetectedItem[] {
  const seen = new Set<string>();
  const items: DetectedItem[] = [];
  for (const line of text.split('\n')) {
    const m = MAKE_TARGET.exec(line);
    if (!m) continue;
    const target = m[1]!;
    if (seen.has(target)) continue;
    seen.add(target);
    items.push({ id: `make:${target}`, source: 'make', label: target, command: `make ${shellWord(target)}`, mode: DETECTED_MODE });
  }
  return items;
}

/** composer.json scripts, minus the `pre-*` / `post-*` event hooks composer runs by itself. */
export function parseComposerJson(text: string): DetectedItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const scripts = asRecord(asRecord(parsed)?.['scripts']);
  if (!scripts) return [];
  return Object.keys(scripts)
    .filter((name) => name.trim() && !/^(pre|post)-/.test(name))
    .map((name) => ({ id: `composer:${name}`, source: 'composer' as const, label: name, command: `composer run-script ${shellWord(name)}`, mode: DETECTED_MODE }));
}
