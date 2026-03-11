import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '../../..');

function getCurrentVersion(): string {
  try {
    const pkgPath = join(ROOT_DIR, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function getCurrentCommitHash(): string | null {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: ROOT_DIR, timeout: 5000 })
      .toString()
      .trim() || null;
  } catch {
    return null;
  }
}

function git(cmd: string): string {
  return execSync(cmd, { cwd: ROOT_DIR, timeout: 15000 }).toString().trim();
}

interface UpdateCheckResult {
  behindBy: number;
  latestCommit: string | null;
  checkedAt: number;
}

let cached: UpdateCheckResult | null = null;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Uses `git fetch` + `git rev-list` to check how many commits behind
 * origin/main the current HEAD is. This works correctly regardless of
 * which branch (or worktree) the instance is running on.
 */
function isWorktree(): boolean {
  try {
    const gitCommonDir = git('git rev-parse --git-common-dir');
    return gitCommonDir !== '.git';
  } catch {
    return false;
  }
}

function checkBehindOriginMain(): UpdateCheckResult {
  if (cached && Date.now() - cached.checkedAt < CACHE_TTL_MS) {
    return cached;
  }

  try {
    // Fetch latest main from origin (shallow, fast)
    git('git fetch origin main --quiet');

    // Count commits on origin/main that are NOT reachable from HEAD
    const behindStr = git('git rev-list --count HEAD..origin/main');
    const behindBy = parseInt(behindStr, 10) || 0;

    // Get the latest commit hash on origin/main
    const latestCommit = git('git rev-parse --short origin/main') || null;

    cached = { behindBy, latestCommit, checkedAt: Date.now() };
    return cached;
  } catch {
    // git fetch may fail (offline, no remote, etc.)
    return cached ?? { behindBy: 0, latestCommit: null, checkedAt: Date.now() };
  }
}

export function versionRoutes() {
  return async function (app: FastifyInstance) {
    app.get('/api/version', async () => {
      const localCommit = getCurrentCommitHash();
      const currentVersion = getCurrentVersion();
      const { behindBy, latestCommit } = checkBehindOriginMain();

      return {
        version: currentVersion,
        commit: localCommit,
        latestCommit,
        behindBy,
        updateAvailable: behindBy > 0,
        isWorktree: isWorktree(),
      };
    });
  };
}
