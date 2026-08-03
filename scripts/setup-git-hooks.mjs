#!/usr/bin/env node
/**
 * Point git at the versioned hooks in .githooks/ (ticket #467).
 *
 * Run from the root `prepare` script, so `bun install` wires the hooks up on a
 * fresh clone with no extra step and no extra dependency (no husky).
 *
 * This must never break an install: a developer who cannot run hooks should
 * still be able to install the repo. Every failure path degrades to a warning.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function main() {
  // CI checks out fresh and runs the real lint; hooks would only cost time.
  if (process.env.CI) return;

  // `.git` is a directory in a normal clone and a file in a worktree — both count.
  if (!fs.existsSync(path.join(ROOT, '.git'))) return;

  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], {
    cwd: ROOT,
    stdio: 'ignore',
  });
}

try {
  main();
} catch (error) {
  console.warn(
    `[fleex] Could not configure git hooks: ${error.message}\n` +
      '        Run `git config core.hooksPath .githooks` by hand to enable them.',
  );
}
