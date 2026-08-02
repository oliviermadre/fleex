#!/usr/bin/env node
/**
 * Bundle budget for packages/web (ticket #496 — code splitting).
 *
 * The metric is the FIRST-PAINT JS PAYLOAD, not the size of the entry chunk.
 * Chunk size is trivially gamed: move code into a sibling the entry still
 * imports and the number drops without the browser downloading one byte less.
 *
 * So we measure a transitive static closure — `imports` only, never
 * `dynamicImports` — from two kinds of root:
 *
 *   1. the build entries (the bootstrap), and
 *   2. each platform shell named in `initialShells`.
 *
 * The shells are dynamically imported (App picks desktop or mobile at runtime),
 * but one of them is unconditionally required to render anything. Counting only
 * the bootstrap would let someone statically import recharts into AppLayout and
 * still pass — which is exactly what this script exists to prevent. The enforced
 * figure is therefore the worst shell: bootstrap ∪ closure(shell).
 *
 * Two gates, both from packages/web/bundle-budget.json:
 *   - size ceilings (initialJsGzipKb / initialCssGzipKb)
 *   - forbiddenInInitial: packages that must never become eager again. This is
 *     the gate that carries intent — a ceiling on its own is just a number
 *     someone raises. Checked against dist/.vite/chunk-modules.json, emitted by
 *     the bundleReportPlugin in vite.config.ts from real module ids.
 *
 * Run from the repo root, after `bun run build`:
 *   node scripts/bundle-budget.mjs            → enforce, exit 1 on breach
 *   node scripts/bundle-budget.mjs --report   → print only, always exit 0
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'packages/web');
const DIST = path.join(WEB, 'dist');
const BUDGET_PATH = path.join(WEB, 'bundle-budget.json');
const MANIFEST_PATH = path.join(DIST, '.vite/manifest.json');
const CHUNK_MODULES_PATH = path.join(DIST, '.vite/chunk-modules.json');

const reportOnly = process.argv.includes('--report');

function readJson(file, hint) {
  if (!fs.existsSync(file)) {
    console.error(`✗ Missing ${path.relative(ROOT, file)}\n  ${hint}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const budget = readJson(BUDGET_PATH, 'This file is versioned — it should not be missing.');
const manifest = readJson(MANIFEST_PATH, 'Run `bun run build` first (needs build.manifest in vite.config.ts).');
const chunkModules = readJson(CHUNK_MODULES_PATH, 'Run `bun run build` first (emitted by bundleReportPlugin).');

/** Transitive static closure from the given manifest keys. `imports` only. */
function closure(startKeys) {
  const js = new Set();
  const css = new Set();
  const seen = new Set();

  const visit = (key) => {
    if (seen.has(key)) return;
    seen.add(key);
    const chunk = manifest[key];
    if (!chunk) return;
    if (chunk.file?.endsWith('.js')) js.add(chunk.file);
    for (const file of chunk.css ?? []) css.add(file);
    for (const imported of chunk.imports ?? []) visit(imported);
  };

  for (const key of startKeys) visit(key);
  return { js, css };
}

const entryKeys = Object.entries(manifest)
  .filter(([, chunk]) => chunk.isEntry)
  .map(([key]) => key);
const bootstrap = closure(entryKeys);

// Resolve each configured shell by its (stable) chunk name. A miss is fatal:
// silently skipping a renamed shell would quietly disable most of the budget.
const shells = (budget.initialShells ?? []).map((name) => {
  const key = Object.keys(manifest).find((k) => manifest[k].name === name);
  if (!key) {
    console.error(
      `✗ initialShells names "${name}" but no chunk with that name exists in the manifest.\n` +
        '  Either the component was renamed or its lazy boundary was removed.\n' +
        '  Update packages/web/bundle-budget.json — do not leave it dangling, or the budget stops measuring.'
    );
    process.exit(1);
  }
  const own = closure([key]);
  return {
    name,
    js: new Set([...bootstrap.js, ...own.js]),
    css: new Set([...bootstrap.css, ...own.css]),
  };
});

// With no shells configured the bootstrap is the whole story.
const candidates = shells.length ? shells : [{ name: 'entry', js: bootstrap.js, css: bootstrap.css }];

function measure(file) {
  const buf = fs.readFileSync(path.join(DIST, file));
  return { file, raw: buf.length, gzip: zlib.gzipSync(buf, { level: 9 }).length };
}

const kb = (bytes) => bytes / 1024;
const fmt = (bytes) => kb(bytes).toFixed(2);
const sum = (files, key) => [...files].reduce((n, f) => n + measure(f)[key], 0);

const scored = candidates
  .map((c) => ({
    name: c.name,
    js: c.js,
    css: c.css,
    jsGzip: sum(c.js, 'gzip'),
    jsRaw: sum(c.js, 'raw'),
    cssGzip: sum(c.css, 'gzip'),
    cssRaw: sum(c.css, 'raw'),
  }))
  .sort((a, b) => b.jsGzip - a.jsGzip);

const worst = scored[0];

// Union of every first-paint closure — a banned import in either shell fails.
const allInitialJs = new Set(scored.flatMap((c) => [...c.js]));
const violations = [];
for (const file of allInitialJs) {
  for (const pkg of budget.forbiddenInInitial ?? []) {
    if ((chunkModules[file] ?? []).includes(pkg)) violations.push({ chunk: file, pkg });
  }
}

const overJs = kb(worst.jsGzip) > budget.initialJsGzipKb;
const overCss = kb(worst.cssGzip) > budget.initialCssGzipKb;
const failed = overJs || overCss || violations.length > 0;

// ── Report ────────────────────────────────────────────────────────────────
const base = budget._baseline ?? {};
const delta = (now, before) =>
  before ? ` (${now - before >= 0 ? '+' : ''}${(now - before).toFixed(2)} vs ${before} baseline)` : '';

const lines = [];
lines.push('## Bundle budget — first-paint JS payload');
lines.push('');
lines.push('Transitive static closure from the entry plus the platform shell. Dynamic imports excluded.');
lines.push('');
lines.push('| Platform | JS raw kB | JS gzip kB | CSS gzip kB |');
lines.push('|---|---:|---:|---:|');
for (const c of scored) {
  lines.push(`| ${c.name} | ${fmt(c.jsRaw)} | ${fmt(c.jsGzip)} | ${fmt(c.cssGzip)} |`);
}
lines.push('');
lines.push(`### Chunks in the worst case (${worst.name})`);
lines.push('');
lines.push('| Chunk | raw kB | gzip kB |');
lines.push('|---|---:|---:|');
for (const f of [...worst.js, ...worst.css].map(measure).sort((a, b) => b.gzip - a.gzip)) {
  lines.push(`| \`${f.file}\` | ${fmt(f.raw)} | ${fmt(f.gzip)} |`);
}
lines.push('');
lines.push('| Metric | value | budget | verdict |');
lines.push('|---|---:|---:|:--|');
lines.push(
  `| First-paint JS (gzip kB) | ${fmt(worst.jsGzip)}${delta(kb(worst.jsGzip), base.initialJsGzipKb)} | ${budget.initialJsGzipKb} | ${overJs ? '❌ over' : '✅'} |`
);
lines.push(
  `| First-paint CSS (gzip kB) | ${fmt(worst.cssGzip)}${delta(kb(worst.cssGzip), base.initialCssGzipKb)} | ${budget.initialCssGzipKb} | ${overCss ? '❌ over' : '✅'} |`
);
lines.push(
  `| Packages banned from first paint | ${violations.length} found | 0 | ${violations.length ? '❌' : '✅'} |`
);
lines.push('');

if (violations.length) {
  lines.push('### Banned packages in the first-paint payload');
  lines.push('');
  for (const v of violations) lines.push(`- \`${v.pkg}\` via \`${v.chunk}\``);
  lines.push('');
  lines.push('These belong behind a lazy boundary. Some static import pulled one back in.');
  lines.push('');
}

const report = lines.join('\n');
console.log(report);

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
}

// ── Verdict ───────────────────────────────────────────────────────────────
if (!failed) {
  console.log('✓ Bundle budget OK');
  process.exit(0);
}

if (overJs) {
  console.error(
    `✗ First-paint JS payload (${worst.name}) ${fmt(worst.jsGzip)} kB gzip exceeds budget ${budget.initialJsGzipKb} kB by ${(kb(worst.jsGzip) - budget.initialJsGzipKb).toFixed(2)} kB`
  );
}
if (overCss) {
  console.error(
    `✗ First-paint CSS payload (${worst.name}) ${fmt(worst.cssGzip)} kB gzip exceeds budget ${budget.initialCssGzipKb} kB by ${(kb(worst.cssGzip) - budget.initialCssGzipKb).toFixed(2)} kB`
  );
}
for (const v of violations) {
  console.error(`✗ Banned package "${v.pkg}" is in the first-paint payload via ${v.chunk}`);
}
console.error(
  '\nFix the import rather than raising the budget. If the ceiling genuinely has to move,\n' +
    'packages/web/bundle-budget.json is versioned — make it an explicit, reviewable diff.'
);

process.exit(reportOnly ? 0 : 1);
