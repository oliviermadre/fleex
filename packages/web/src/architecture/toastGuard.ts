/**
 * Static rules that keep Fleex at ONE toast (run by toasts.guard.test.ts).
 * Pure functions over `{ path, content }` so the rules are testable on fixtures.
 * Paths are relative to packages/web/src, with forward slashes.
 */

export type ToastRule = 'R1' | 'R2' | 'R3' | 'R4';

export interface SourceFile {
  path: string;
  content: string;
}

export interface Violation {
  rule: ToastRule;
  path: string;
  line: number;
  excerpt: string;
}

const TOAST_HOME = (p: string) => p === 'lib/toast.ts' || p.startsWith('components/ui/toast/');

const RULE_LABEL: Record<ToastRule, string> = {
  R1: 'direct import of the internal toast store',
  R2: 'custom toast/snackbar component',
  R3: 'custom floating surface',
  R4: 'custom expiry progress bar',
};

/** Import of stores/toastStore from anywhere. */
const R1_IMPORT = /(?:from\s+|import\s*\(\s*)['"][^'"]*\/toastStore['"]/;
/** Declaration of a component-like *Toast* / *Snackbar* (PascalCase): `function UndoToast`, `const SnackbarX`. */
const R2_DECL = /\b(?:function|const|let|class)\s+(?:[A-Z]\w*)?(?:Toast|Snackbar)\w*/;
/** JSX element named *Toast* / *Snackbar* (not a TS generic like `Record<ToastTone>`). `<Toaster/>` is the one surface. */
const R2_JSX = /(?<![\w.])<((?:[A-Z]\w*)?(?:Toast|Snackbar)\w*)/g;
/** `@keyframes` header — the body is extracted by brace matching. */
const KEYFRAMES = /@keyframes\s+[\w-]+\s*\{/g;
const SHRINKS = [
  [/width\s*:\s*100%/, /width\s*:\s*0(?:%|px)?\s*[;}]/],
  [/scaleX\(\s*1\s*\)/, /scaleX\(\s*0\s*\)/],
] as const;

function isComment(line: string): boolean {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

function r3Hit(line: string): boolean {
  return /\bfixed\b/.test(line) && /(?:^|[\s"'`])(?:bottom|top)-/.test(line) && /(?:left-1\/2|(?:^|[\s"'`])right-)/.test(line);
}

export function findToastViolations(files: SourceFile[], floatingAllowlist: ReadonlyArray<{ path: string }>): Violation[] {
  const allowedFloating = new Set(floatingAllowlist.map((a) => a.path));
  const out: Violation[] = [];

  for (const { path, content } of files) {
    const lines = content.split('\n');
    const home = TOAST_HOME(path);
    const isCss = path.endsWith('.css');

    lines.forEach((line, i) => {
      if (isComment(line)) return;
      const hit = (rule: ToastRule) => out.push({ rule, path, line: i + 1, excerpt: line.trim().slice(0, 160) });
      if (isCss) return; // CSS only matters for R4 (below)
      if (!home && R1_IMPORT.test(line)) hit('R1');
      if (!home && (R2_DECL.test(line) || [...line.matchAll(R2_JSX)].some((m) => m[1] !== 'Toaster'))) hit('R2');
      if (!allowedFloating.has(path) && r3Hit(line)) hit('R3');
    });

    if (home) continue;
    for (const m of content.matchAll(KEYFRAMES)) {
      const start = m.index! + m[0].length;
      let depth = 1;
      let end = start;
      while (end < content.length && depth > 0) {
        if (content[end] === '{') depth++;
        else if (content[end] === '}') depth--;
        end++;
      }
      const body = content.slice(start, end);
      if (SHRINKS.some(([from, to]) => from.test(body) && to.test(body))) {
        const line = content.slice(0, m.index).split('\n').length;
        out.push({ rule: 'R4', path, line, excerpt: lines[line - 1]!.trim().slice(0, 160) });
      }
    }
  }
  return out;
}

/** The failure message is the prompt the next coding agent reads: say exactly what to do. */
export function formatViolation(v: Violation): string {
  return [
    `✗ Custom toast surface detected in src/${v.path}:${v.line} (rule ${v.rule}: ${RULE_LABEL[v.rule]}).`,
    `    ${v.excerpt}`,
    `  Fleex has ONE toast. Use:  import { toast } from '<relative path>/lib/toast';  toast.success('…', { action, durationMs })`,
    `  Need something toast() can't do? Extend ToastInput in src/lib/toast.ts (and render it in components/ui/toast/Toaster.tsx) — never build a new surface.`,
    `  Not a toast (e.g. a persistent action bar)? Add it to src/architecture/floating-surfaces.allowlist.ts with a reason.`,
    `  See docs/adr/0001-single-toast.md`,
  ].join('\n');
}
