#!/usr/bin/env node
/**
 * No-raw-console lint (ticket #371, from #362 — front logger).
 *
 * Raw `console.*` in packages/web/src is unfilterable (no level), unstructured
 * (context interpolated into the message string) and unrecoverable (whatever is
 * still scrolled into the user's devtools). Fleex is self-hosted with no Sentry,
 * so those calls were the only diagnostic channel — and nothing kept their count
 * from growing, this repo having no ESLint.
 *
 * packages/web/src/lib/logger.ts replaces them:
 *   const log = createLogger('stores/skillStore');   // scope = path under src/
 *   log.error('Failed to load skills', { err });
 *
 * Unlike scripts/check-raw-palette.mjs this is NOT a ratchet: the count reached
 * 0 in the same PR that introduced the logger, so it stays at 0. lib/logger.ts
 * is the single allowed caller (it *is* the console wrapper).
 *
 * Escape hatch, for the rare case where the logger genuinely cannot be used
 * (e.g. code running before the module graph is ready): end the line with
 *   // fleex-allow-console
 * Expect this to stay unused; if you reach for it, say why in the PR.
 *
 * Run: node scripts/check-no-console.mjs   (wired into `bun run lint`)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'packages/web/src');
const ALLOWED = new Set(['lib/logger.ts']);
const ALLOW_MARKER = '// fleex-allow-console';

const CONSOLE_CALL =
  /\bconsole\.(log|warn|error|info|debug|trace|table|dir|group|groupEnd|time|timeEnd|assert|count)\b/g;

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) yield p;
  }
}

const found = []; // { rel, line, match }
for (const file of walk(SRC)) {
  const rel = path.relative(SRC, file).split(path.sep).join('/');
  if (ALLOWED.has(rel)) continue;
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(ALLOW_MARKER)) continue;
    for (const m of lines[i].matchAll(CONSOLE_CALL)) {
      found.push({ rel, line: i + 1, match: m[0] });
    }
  }
}

if (found.length > 0) {
  console.error(`✗ Raw console.* in packages/web/src (${found.length} occurrence(s)):\n`);
  for (const { rel, line, match } of found) console.error(`  packages/web/src/${rel}:${line} — ${match}`);
  console.error(
    '\nUse the scoped logger instead (packages/web/src/lib/logger.ts):' +
      "\n  const log = createLogger('stores/skillStore');   // scope = module path under src/, no extension" +
      "\n  log.error('Failed to load skills', { err });" +
      '\nSee scripts/check-no-console.mjs for rationale and the escape hatch.',
  );
  process.exit(1);
}

console.log('✓ No raw console.* in packages/web/src (use createLogger from lib/logger.ts).');
