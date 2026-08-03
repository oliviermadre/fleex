/**
 * Build fingerprint for the side-panel companion.
 *
 * The companion is a machine-wide singleton started idempotently, so a running
 * host survives every `git pull`: `fleex start` finds it healthy and reuses it
 * forever. The browser meanwhile serves a fresh front-end, and the pair silently
 * drifts — a new client feature talking to an old server that ignores it (which
 * is exactly how "always allow" shipped broken).
 *
 * `/health` therefore advertises a fingerprint of the sources the host is
 * *running*, which the CLI compares against the repo it would launch *now*.
 * Different → the host is stale → restart it.
 *
 * Deliberately not git-based: dev worktrees are permanently dirty and the
 * companion may run from `~/.fleex/repo`, which has no meaningful HEAD relative
 * to the caller's checkout.
 *
 * Lives in the CLI (not the host) because the CLI owns companion lifecycle and
 * the host already depends on `@fleex/cli` — the reverse would be circular.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

/** Source trees whose change must invalidate a running companion. */
const FINGERPRINTED_DIRS = ['packages/sidepanel-host/src'];

/** Value returned when the sources can't be read — never throws, never matches
 *  a real fingerprint by accident (it compares equal only to itself). */
export const UNKNOWN_FINGERPRINT = 'unknown';

function walk(dir: string, base: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, base, out);
    else if (e.isFile() && e.name.endsWith('.ts')) out.push(path.relative(base, full));
  }
}

/**
 * Deterministic hash of the companion's source tree under `repoDir`.
 *
 * Hashes path + size + mtime rather than contents: same discrimination for our
 * purpose (any edit moves mtime) at a fraction of the I/O, and this runs on
 * every `fleex start`. Returns `UNKNOWN_FINGERPRINT` if nothing can be read.
 */
export function computeFingerprint(repoDir: string): string {
  const files: string[] = [];
  for (const rel of FINGERPRINTED_DIRS) walk(path.join(repoDir, rel), repoDir, files);
  if (files.length === 0) return UNKNOWN_FINGERPRINT;

  const hash = createHash('sha256');
  for (const rel of files.sort()) {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(path.join(repoDir, rel));
    } catch {
      continue;
    }
    hash.update(`${rel}\0${stat.size}\0${Math.trunc(stat.mtimeMs)}\n`);
  }
  return hash.digest('hex').slice(0, 16);
}
