#!/usr/bin/env node
/**
 * Raw-palette ratchet lint (ticket #395 — theme-proof light theme).
 *
 * Hardcoded Tailwind palette classes (text-red-400, bg-amber-500/15, …) bypass
 * the `--theme-*` / `--tint-*` CSS-variable system and are calibrated for one
 * theme only — historically the root cause of the unreadable light theme.
 *
 * This script counts raw palette classes in packages/web/src (excluding
 * lib/tints.ts, the single allowed home of palette-derived values) and
 * compares against a versioned snapshot (scripts/raw-palette-snapshot.json):
 *   - any INCREASE (per file) → exit 1 with offending lines
 *   - any DECREASE            → the snapshot file is rewritten; commit it
 *   - equal                   → exit 0
 *
 * Target (reached): 0. Use tint()/tintText()/tintSolid()/tintClasses() from
 * lib/tints.ts, or the literal `[var(--tint-<hue>-<token>)]` arbitrary classes
 * (they must appear literally in source for the Tailwind v4 scanner).
 *
 * Run: node scripts/check-raw-palette.mjs   (wired into `bun run lint`)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'packages/web/src');
const SNAPSHOT_PATH = path.join(ROOT, 'scripts/raw-palette-snapshot.json');
const ALLOWED = new Set(['lib/tints.ts']);

// Extended beyond the spec regex: directional borders (border-l-*), ring-offset,
// divide, outline, decoration, fill/stroke, shadow, accent, caret, placeholder —
// anything that resolves to a palette color.
const HUES =
  'red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone';
const PREFIXES =
  'text|bg|border(?:-[lrtbxyse])?|ring(?:-offset)?|from|via|to|fill|stroke|divide|outline|decoration|shadow|accent|caret|placeholder';
const RAW_PALETTE = new RegExp(`\\b(?:${PREFIXES})-(?:${HUES})-[0-9]{2,3}\\b`, 'g');

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (/\.(tsx?|css)$/.test(entry.name)) yield p;
  }
}

const found = {}; // relPath -> [{ line, match }]
for (const file of walk(SRC)) {
  const rel = path.relative(SRC, file);
  if (ALLOWED.has(rel)) continue;
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(RAW_PALETTE)) {
      (found[rel] ??= []).push({ line: i + 1, match: m[0] });
    }
  }
}

const counts = Object.fromEntries(
  Object.entries(found)
    .map(([f, v]) => [f, v.length])
    .sort(([a], [b]) => a.localeCompare(b)),
);
const total = Object.values(counts).reduce((s, n) => s + n, 0);

let snapshot = { total: Infinity, files: {} };
if (fs.existsSync(SNAPSHOT_PATH)) snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));

const regressions = [];
for (const [file, count] of Object.entries(counts)) {
  const allowed = snapshot.files[file] ?? 0;
  if (count > allowed) regressions.push({ file, count, allowed });
}

if (regressions.length > 0) {
  console.error('✗ Raw Tailwind palette classes introduced (theme-proof ratchet):\n');
  for (const { file, count, allowed } of regressions) {
    console.error(`  ${file} — ${count} occurrence(s) (snapshot allows ${allowed}):`);
    for (const { line, match } of found[file]) console.error(`    L${line}: ${match}`);
  }
  console.error(
    '\nUse the theme-aware tint API instead (packages/web/src/lib/tints.ts):' +
      '\n  tint(hue) / tintText(hue) / tintSolid(hue) / tintClasses(hue)' +
      '\nor a literal arbitrary class like `border-l-[var(--tint-red-border)]`.' +
      '\nSee scripts/check-raw-palette.mjs for rationale.',
  );
  process.exit(1);
}

if (total < snapshot.total || JSON.stringify(counts) !== JSON.stringify(snapshot.files)) {
  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify({ total, files: counts }, null, 2) + '\n');
  console.log(
    `✓ Raw palette count improved (${snapshot.total === Infinity ? '?' : snapshot.total} → ${total}). Snapshot updated — commit scripts/raw-palette-snapshot.json.`,
  );
} else {
  console.log(`✓ Raw palette ratchet OK (${total} occurrence(s) outside lib/tints.ts).`);
}
