import { spawnSync } from 'node:child_process';
import { die } from './colors.ts';

export const MIN_BUN_VERSION = '1.3.5';

/** Returns true if `a >= b` for dotted numeric version strings. */
export function versionGte(a: string, b: string): boolean {
  const pa = a.split('.').map((s) => parseInt(s, 10) || 0);
  const pb = b.split('.').map((s) => parseInt(s, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va > vb) return true;
    if (va < vb) return false;
  }
  return true;
}

export function checkBun(): void {
  const r = spawnSync('bun', ['--version'], { encoding: 'utf8' });
  if (r.status !== 0) {
    die('bun is required but not installed. Install it: https://bun.sh');
  }
  const ver = r.stdout.trim();
  if (!versionGte(ver, MIN_BUN_VERSION)) {
    die(
      `bun ${ver} is too old. fleex requires bun >= ${MIN_BUN_VERSION} (for Bun.spawn terminal support).\n  Upgrade: bun upgrade`,
    );
  }
}
