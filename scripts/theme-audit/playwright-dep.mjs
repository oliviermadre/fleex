/**
 * Lazy playwright loader. Playwright is intentionally NOT a workspace
 * dependency (heavy, only needed for the contrast sweep). It lives in
 * scripts/theme-audit/package.json and is installed on demand.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    console.log('playwright not installed — running `bun install` in scripts/theme-audit/ ...');
    const res = spawnSync('bun', ['install'], { cwd: HERE, stdio: 'inherit' });
    if (res.status !== 0) {
      console.error('bun install failed. Install manually: cd scripts/theme-audit && bun install');
      process.exit(2);
    }
    return await import('playwright');
  }
}
