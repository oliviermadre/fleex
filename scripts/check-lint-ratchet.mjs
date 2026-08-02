#!/usr/bin/env node
/**
 * ESLint ratchet lint (ticket #467 — make `lint` a real lint).
 *
 * The repo had ~111k lines of TypeScript written without a linter. Turning
 * ESLint on as a hard gate would mean fixing thousands of pre-existing
 * violations before anything could merge; turning it on as warnings would mean
 * nobody ever looks. So we ratchet, on the model of check-raw-palette.mjs:
 *
 *   - a violation count ABOVE the snapshot  → exit 1 (a regression)
 *   - a violation count BELOW the snapshot  → snapshot rewritten; commit it
 *   - equal                                 → exit 0
 *
 * The snapshot is keyed by `file × rule`, one level finer than the palette
 * ratchet's per-file counts: adding an a11y violation to a file already
 * baselined for hook-dependency violations must still fail.
 *
 * Fatal parse errors are NEVER baselined (see findFatals) — a file that fails
 * to parse is a file that is not linted at all, and burying that in the
 * snapshot would silently create a hole in the coverage.
 *
 * Run: node scripts/check-lint-ratchet.mjs            (wired into `bun run lint`)
 *      node scripts/check-lint-ratchet.mjs --write    (`bun run lint:baseline`)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const SNAPSHOT_PATH = path.join(ROOT, 'scripts/lint-snapshot.json');

/** Bucket for messages that carry no rule id (unused disable directives, …). */
export const NO_RULE = '(no-rule)';

/**
 * Normalise an absolute path to a repo-relative POSIX path.
 *
 * Done by hand rather than via path.relative so that Windows-style input is
 * normalised identically on every host — the snapshot is committed and shared,
 * so its keys must not depend on the machine that generated it.
 *
 * @param {string} filePath
 * @param {string} rootDir
 * @returns {string}
 */
export function toPosixRelative(filePath, rootDir) {
  const file = filePath.replace(/\\/g, '/');
  const root = rootDir.replace(/\\/g, '/').replace(/\/+$/, '');
  return file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file;
}

/**
 * Collect every fatal (unparseable) message. These bypass the ratchet entirely.
 *
 * @param {Array<{filePath: string, messages: Array<object>}>} results
 * @param {string} [rootDir]
 * @returns {Array<{file: string, line: number, message: string}>}
 */
export function findFatals(results, rootDir = ROOT) {
  const fatals = [];
  for (const result of results) {
    for (const message of result.messages ?? []) {
      if (message.fatal) {
        fatals.push({
          file: toPosixRelative(result.filePath, rootDir),
          line: message.line ?? 0,
          message: message.message,
        });
      }
    }
  }
  return fatals;
}

/**
 * Turn ESLint results into a sorted `{ file: { rule: count } }` map.
 *
 * Errors and warnings both count: a rule set to "warn" is still a rule we do
 * not want more of. Fatal messages are excluded — findFatals owns those.
 *
 * Keys are sorted at both levels so the serialised snapshot is stable and its
 * git diffs stay minimal.
 *
 * @param {Array<{filePath: string, messages: Array<object>}>} results
 * @param {string} [rootDir]
 * @returns {Record<string, Record<string, number>>}
 */
export function collectCounts(results, rootDir = ROOT) {
  /** @type {Record<string, Record<string, number>>} */
  const counts = {};

  for (const result of results) {
    const file = toPosixRelative(result.filePath, rootDir);
    for (const message of result.messages ?? []) {
      if (message.fatal) continue;
      const rule = message.ruleId ?? NO_RULE;
      counts[file] ??= {};
      counts[file][rule] = (counts[file][rule] ?? 0) + 1;
    }
  }

  return sortCounts(counts);
}

/**
 * Sort file keys and, within each file, rule keys.
 *
 * @param {Record<string, Record<string, number>>} counts
 * @returns {Record<string, Record<string, number>>}
 */
export function sortCounts(counts) {
  /** @type {Record<string, Record<string, number>>} */
  const sorted = {};
  for (const file of Object.keys(counts).sort()) {
    /** @type {Record<string, number>} */
    const rules = {};
    for (const rule of Object.keys(counts[file]).sort()) rules[rule] = counts[file][rule];
    sorted[file] = rules;
  }
  return sorted;
}

/**
 * Compare current counts against the snapshot.
 *
 * A file/rule pair absent from the snapshot has an allowance of 0 — that is
 * what makes brand-new files, and brand-new rule violations in old files, fail
 * immediately.
 *
 * @param {Record<string, Record<string, number>>} counts
 * @param {{files?: Record<string, Record<string, number>>}} snapshot
 * @returns {Array<{file: string, rule: string, count: number, allowed: number}>}
 */
export function findRegressions(counts, snapshot) {
  const baseline = snapshot?.files ?? {};
  const regressions = [];

  for (const [file, rules] of Object.entries(counts)) {
    for (const [rule, count] of Object.entries(rules)) {
      const allowed = baseline[file]?.[rule] ?? 0;
      if (count > allowed) regressions.push({ file, rule, count, allowed });
    }
  }

  return regressions;
}

/**
 * @param {Record<string, Record<string, number>>} counts
 * @returns {number}
 */
export function totalOf(counts) {
  return Object.values(counts).reduce(
    (sum, rules) => sum + Object.values(rules).reduce((s, n) => s + n, 0),
    0,
  );
}

/**
 * @param {Record<string, Record<string, number>>} counts
 * @returns {string}
 */
export function serialise(counts) {
  return `${JSON.stringify({ total: totalOf(counts), files: counts }, null, 2)}\n`;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

function readSnapshot() {
  if (!fs.existsSync(SNAPSHOT_PATH)) return { total: Infinity, files: {} };
  return JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
}

/**
 * Index raw messages by file and rule so the failure report can quote the
 * offending lines instead of just a number.
 */
function indexMessages(results, rootDir) {
  /** @type {Record<string, Record<string, Array<object>>>} */
  const index = {};
  for (const result of results) {
    const file = toPosixRelative(result.filePath, rootDir);
    for (const message of result.messages ?? []) {
      if (message.fatal) continue;
      const rule = message.ruleId ?? NO_RULE;
      ((index[file] ??= {})[rule] ??= []).push(message);
    }
  }
  return index;
}

async function main() {
  const write = process.argv.includes('--write');

  const { ESLint } = await import('eslint');
  const eslint = new ESLint({ cwd: ROOT });
  const results = await eslint.lintFiles(['.']);

  // Never baselined: an unparseable file is an unlinted file (see header).
  const fatals = findFatals(results, ROOT);
  if (fatals.length > 0) {
    console.error(`✗ ESLint could not parse ${fatals.length} file(s):\n`);
    for (const { file, line, message } of fatals) {
      console.error(`  ${file}:${line} — ${message}`);
    }
    console.error('\nParse errors are never baselined: the file would not be linted at all.');
    process.exit(1);
  }

  const counts = collectCounts(results, ROOT);
  const total = totalOf(counts);

  if (write) {
    fs.writeFileSync(SNAPSHOT_PATH, serialise(counts));
    console.log(`✓ ESLint snapshot written (${total} violation(s) baselined).`);
    console.log('  Commit scripts/lint-snapshot.json.');
    return;
  }

  const snapshot = readSnapshot();
  const regressions = findRegressions(counts, snapshot);

  if (regressions.length > 0) {
    const index = indexMessages(results, ROOT);
    console.error(`✗ ESLint ratchet — ${regressions.length} new violation(s):\n`);

    let lastFile = null;
    for (const { file, rule, count, allowed } of regressions) {
      if (file !== lastFile) {
        console.error(`  ${file}`);
        lastFile = file;
      }
      console.error(`    ${rule} — ${count} (snapshot: ${allowed})`);
      for (const message of index[file]?.[rule] ?? []) {
        console.error(`      L${message.line}:${message.column}  ${message.message}`);
      }
    }

    console.error(
      '\nFix the violation, or if it is intentional:' +
        '\n  // eslint-disable-next-line <rule> -- <required justification>' +
        '\n\nAfter renaming/moving a file, or adding a new rule to eslint.config.mjs:' +
        '\n  bun run lint:baseline   (then commit scripts/lint-snapshot.json)',
    );
    process.exit(1);
  }

  if (JSON.stringify(counts) !== JSON.stringify(snapshot.files ?? {})) {
    const before = snapshot.total === Infinity ? '?' : snapshot.total;
    fs.writeFileSync(SNAPSHOT_PATH, serialise(counts));
    console.log(`✓ ESLint violations improved (${before} → ${total}).`);
    console.log('  Snapshot updated — commit scripts/lint-snapshot.json.');
  } else {
    console.log(`✓ ESLint ratchet OK (${total} violation(s) baselined).`);
  }
}

// Only run the CLI when executed directly, so the pure helpers above stay
// importable from the unit tests.
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
