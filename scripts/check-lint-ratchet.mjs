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
// Comparing against a reference snapshot (the `--against` mode)
//
// A ratchet has two directions and the local snapshot only guards one of them.
// Comparing the tree against `scripts/lint-snapshot.json` catches "you just
// added a violation", but that file is writable by the very branch under
// review: `bun run lint:baseline` rewrites the judge. So CI compares against
// the snapshot as it exists on `origin/main`, which the branch cannot touch.
//
// No second decision engine is introduced — findRegressions above is reused
// verbatim. Only the provenance of the baseline changes.
// ─────────────────────────────────────────────────────────────────────────────

/** Sentinel written by CI when `origin/main` has no snapshot yet (bootstrap). */
export const ABSENT = '__ABSENT__';

/**
 * Parse `git diff --find-renames --diff-filter=R --name-status` output.
 *
 * @param {string} text
 * @returns {Array<{from: string, to: string}>}
 */
export function parseRenames(text) {
  const renames = [];
  for (const line of (text ?? '').split('\n')) {
    // R<similarity>\t<from>\t<to>
    const parts = line.trim().split('\t');
    if (parts.length === 3 && parts[0].startsWith('R')) {
      renames.push({ from: parts[1], to: parts[2] });
    }
  }
  return renames;
}

/**
 * Re-key a reference baseline along the renames this branch performed.
 *
 * Without this, moving a baselined file reads as a brand-new file with an
 * allowance of zero. The only escape would then be regenerating the baseline —
 * which is precisely the door this whole mechanism closes. So the allowance
 * has to travel with the file.
 *
 * Git only reports a rename when similarity is high (>50%); below that it is a
 * rewrite, and holding a rewrite to zero is the correct behaviour.
 *
 * @param {Record<string, Record<string, number>>} referenceFiles
 * @param {Array<{from: string, to: string}>} renames
 * @returns {Record<string, Record<string, number>>}
 */
export function remapRenames(referenceFiles, renames) {
  const remapped = { ...referenceFiles };

  for (const { from, to } of renames ?? []) {
    const carried = remapped[from];
    if (!carried) continue;
    delete remapped[from];

    // A rename normally means `to` did not exist before. If it somehow did,
    // keep the larger allowance per rule rather than summing, so a rename can
    // never manufacture headroom.
    const existing = remapped[to];
    if (!existing) {
      remapped[to] = carried;
      continue;
    }
    const merged = { ...existing };
    for (const [rule, n] of Object.entries(carried)) {
      merged[rule] = Math.max(merged[rule] ?? 0, n);
    }
    remapped[to] = merged;
  }

  return sortCounts(remapped);
}

/**
 * Aggregate a counts map into per-rule totals.
 *
 * @param {Record<string, Record<string, number>>} counts
 * @returns {Record<string, {count: number, files: number}>}
 */
export function rollupByRule(counts) {
  /** @type {Record<string, {count: number, files: number}>} */
  const byRule = {};
  for (const rules of Object.values(counts ?? {})) {
    for (const [rule, n] of Object.entries(rules)) {
      byRule[rule] ??= { count: 0, files: 0 };
      byRule[rule].count += n;
      byRule[rule].files += 1;
    }
  }
  return byRule;
}

/**
 * Describe how the current counts differ from a reference baseline.
 *
 * Purely for reporting: the pass/fail decision stays with findRegressions.
 * That separation matters — blocking on `total` alone would be a trap, since
 * fixing five no-unused-vars while adding four no-floating-promises lowers the
 * total while making the repo worse.
 *
 * @param {Record<string, Record<string, number>>} counts
 * @param {Record<string, Record<string, number>>} referenceFiles
 */
export function diffBaselines(counts, referenceFiles) {
  const current = rollupByRule(counts);
  const reference = rollupByRule(referenceFiles);
  const rules = [...new Set([...Object.keys(current), ...Object.keys(reference)])].sort();

  const byRule = [];
  const eliminated = [];

  for (const rule of rules) {
    const now = current[rule]?.count ?? 0;
    const before = reference[rule]?.count ?? 0;
    if (now === 0 && before > 0) eliminated.push(rule);
    if (now === before) continue;

    // Only increases need per-file detail — that is what someone has to fix.
    const files = [];
    if (now > before) {
      for (const [file, ruleCounts] of Object.entries(counts)) {
        const to = ruleCounts[rule] ?? 0;
        const from = referenceFiles?.[file]?.[rule] ?? 0;
        if (to > from) files.push({ file, from, to });
      }
      files.sort((a, b) => b.to - b.from - (a.to - a.from) || a.file.localeCompare(b.file));
    }

    byRule.push({ rule, current: now, reference: before, delta: now - before, files });
  }

  // Increases first (biggest regression at the top), then the improvements.
  byRule.sort((a, b) => b.delta - a.delta);

  const total = totalOf(counts);
  const referenceTotal = totalOf(referenceFiles ?? {});
  return { total, referenceTotal, delta: total - referenceTotal, byRule, eliminated };
}

/**
 * Render a diff as the short human-readable block CI prints.
 *
 * Deliberately capped: the whole point is that a reviewer can read what moved
 * in three seconds instead of scrolling a 693-line JSON diff.
 *
 * @param {ReturnType<typeof diffBaselines>} diff
 * @param {{reference?: string, maxRules?: number, maxFiles?: number}} [options]
 * @returns {string}
 */
export function formatDelta(diff, options = {}) {
  const { reference = 'origin/main', maxRules = 8, maxFiles = 4 } = options;
  // Unicode minus, to match the per-rule lines below.
  const sign = diff.delta > 0 ? `+${diff.delta}` : `−${Math.abs(diff.delta)}`;
  const mark = diff.delta > 0 ? '✗' : '✓';

  const lines = [
    `Baseline vs ${reference}:  ${diff.referenceTotal} → ${diff.total}  (${diff.delta === 0 ? '±0' : sign})  ${mark}`,
  ];
  if (diff.byRule.length === 0) return lines.join('\n');
  lines.push('');

  for (const entry of diff.byRule.slice(0, maxRules)) {
    const up = entry.delta > 0;
    const badge = !up && entry.current === 0 ? '   ✨ rule eliminated from the repo' : '';
    lines.push(
      `  ${up ? '+' : '−'} ${entry.rule}  ${up ? '+' : '−'}${Math.abs(entry.delta)}${badge}`,
    );
    for (const { file, from, to } of entry.files.slice(0, maxFiles)) {
      lines.push(`      ${file}  ${from} → ${to}`);
    }
    if (entry.files.length > maxFiles) {
      lines.push(`      … and ${entry.files.length - maxFiles} more file(s)`);
    }
  }
  if (diff.byRule.length > maxRules) {
    lines.push(`  … and ${diff.byRule.length - maxRules} more rule(s)`);
  }

  return lines.join('\n');
}

/**
 * The whole `--against` comparison as one pure step: remap renames, then run
 * the existing gate and build the report.
 *
 * Extracted so the wiring is testable, not just its parts. The first version of
 * this handed findRegressions a bare files map where it expects a snapshot
 * object, which silently zeroed every allowance and reported the entire
 * baseline as a regression — the unit tests passed because they called
 * findRegressions directly.
 *
 * @param {Record<string, Record<string, number>>} counts
 * @param {Record<string, Record<string, number>>} referenceFiles
 * @param {Array<{from: string, to: string}>} [renames]
 */
export function compareAgainstReference(counts, referenceFiles, renames = []) {
  const baseline = remapRenames(referenceFiles, renames);
  return {
    baseline,
    regressions: findRegressions(counts, { files: baseline }),
    diff: diffBaselines(counts, baseline),
  };
}

/**
 * Rules that are close enough to zero to be worth finishing off.
 *
 * This repo is driven largely by agents, and an agent reads the output of
 * `bun run lint` many times a day. Naming three reachable targets there is the
 * cheapest nudge available — a ratchet only records progress, it never creates
 * any.
 *
 * @param {Record<string, Record<string, number>>} counts
 * @param {number} [threshold]
 * @returns {Array<{rule: string, count: number, files: number}>}
 */
export function nearZeroRules(counts, threshold = 15) {
  return Object.entries(rollupByRule(counts))
    .filter(([, { count }]) => count > 0 && count < threshold)
    .map(([rule, { count, files }]) => ({ rule, count, files }))
    .sort((a, b) => a.count - b.count || a.rule.localeCompare(b.rule));
}

/**
 * The single largest remaining bucket, for context under the near-zero list.
 *
 * @param {Record<string, Record<string, number>>} counts
 * @returns {{rule: string, count: number, files: number} | null}
 */
export function heaviestRule(counts) {
  const entries = Object.entries(rollupByRule(counts));
  if (entries.length === 0) return null;
  const [rule, { count, files }] = entries.sort((a, b) => b[1].count - a[1].count)[0];
  return { rule, count, files };
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

function readSnapshot() {
  // An absent snapshot allows nothing: `files: {}` gives every file/rule pair an
  // allowance of 0, so the run fails loudly and points at `lint:baseline`
  // rather than silently accepting whatever it finds.
  if (!fs.existsSync(SNAPSHOT_PATH)) return { total: null, files: {} };
  return JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
}

/** Read `--flag value` from argv. */
function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
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

/**
 * `--against <file>`: check this branch does not leave the repo worse than the
 * reference baseline (in CI, the snapshot from `origin/main`).
 *
 * Strictly read-only. If it rewrote the local snapshot, the `Snapshots up to
 * date` step that follows would see a dirty tree and we would have invented a
 * false positive.
 *
 * It does NOT re-run ESLint. Once `bun run lint` has passed, the local snapshot
 * is provably equal to the current counts — the ratchet either found them equal
 * or rewrote the file to match — so the counts are already on disk for free.
 */
function mainAgainst(referencePath) {
  const raw = fs.readFileSync(referencePath, 'utf8');

  // Bootstrap: main genuinely has no snapshot yet (this PR introduces it).
  // Distinguished from "unreadable" on purpose — see below.
  if (raw.trim() === ABSENT) {
    console.log('ℹ No reference snapshot on the base branch — check skipped (bootstrap).');
    return;
  }

  let reference;
  try {
    reference = JSON.parse(raw);
    if (!reference || typeof reference.files !== 'object' || reference.files === null) {
      throw new Error('snapshot has no "files" object');
    }
  } catch (error) {
    // Never a silent pass: an unreadable reference means the guard is not
    // guarding, which is worse than a regression getting through once.
    console.error(`✗ Reference baseline at ${referencePath} is unreadable: ${error.message}`);
    console.error('  Refusing to pass: an unverifiable baseline is not a verified one.');
    process.exit(1);
  }

  if (!fs.existsSync(SNAPSHOT_PATH)) {
    console.error('✗ scripts/lint-snapshot.json is missing — run `bun run lint` first.');
    process.exit(1);
  }
  const counts = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8')).files ?? {};

  const renamesPath = argValue('--renames');
  const renames =
    renamesPath && fs.existsSync(renamesPath)
      ? parseRenames(fs.readFileSync(renamesPath, 'utf8'))
      : [];

  const { regressions, diff } = compareAgainstReference(counts, reference.files, renames);

  console.log(formatDelta(diff));

  if (regressions.length > 0) {
    console.error(
      `\n✗ This branch leaves ${regressions.length} file/rule pair(s) worse than main.`,
    );
    let lastFile = null;
    // Capped: a readable report is the whole point. If this ever runs long,
    // something structural is wrong and the delta summary above already says so.
    for (const { file, rule, count, allowed } of regressions.slice(0, 20)) {
      if (file !== lastFile) {
        console.error(`  ${file}`);
        lastFile = file;
      }
      console.error(`    ${rule} — ${count} (main: ${allowed})`);
    }
    if (regressions.length > 20) {
      console.error(`  … and ${regressions.length - 20} more`);
    }
    console.error(
      '\nRegenerating the baseline does not clear this: the reference is main, not' +
        '\nthe snapshot in this branch. Fix the violation, or add the' +
        '\n`lint-baseline-reset` label to the PR if the baseline legitimately grows' +
        '\n(a newly enabled rule).',
    );
    process.exit(1);
  }

  console.log('\n✓ Baseline is no worse than the base branch.');
}

async function main() {
  const against = argValue('--against');
  if (against) return mainAgainst(against);

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
    const before = snapshot.total ?? '?';
    fs.writeFileSync(SNAPSHOT_PATH, serialise(counts));
    console.log(`✓ ESLint violations improved (${before} → ${total}).`);
    console.log('  Snapshot updated — commit scripts/lint-snapshot.json.');
  } else {
    const fileCount = Object.keys(counts).length;
    console.log(`✓ ESLint ratchet OK (${total} violation(s) baselined, ${fileCount} file(s)).`);
  }

  printDashboard(counts);
}

/**
 * Show what is within reach of being eliminated.
 *
 * The ratchet is a passive device: it records improvements someone else makes.
 * If nobody makes any, the baseline stays where it is forever and CI stays
 * green. This is the cheapest available prompt to actually move it.
 */
function printDashboard(counts) {
  const reachable = nearZeroRules(counts);
  if (reachable.length === 0) return;

  console.log('\n  Within reach of elimination (< 15 left):');
  for (const { rule, count, files } of reachable.slice(0, 3)) {
    console.log(`    ${rule.padEnd(48)} ${String(count).padStart(4)}  → ${files} file(s)`);
  }

  const heaviest = heaviestRule(counts);
  if (heaviest && heaviest.count >= 15) {
    console.log('\n  Heaviest bucket:');
    console.log(`    ${heaviest.rule.padEnd(48)} ${String(heaviest.count).padStart(4)}`);
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
