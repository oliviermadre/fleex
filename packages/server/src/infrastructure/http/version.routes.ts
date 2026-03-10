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

interface GitHubCommit {
  sha: string;
  commit: { message: string };
}

let cachedLatest: { sha: string; checkedAt: number } | null = null;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

async function getLatestRemoteCommit(): Promise<string | null> {
  if (cachedLatest && Date.now() - cachedLatest.checkedAt < CACHE_TTL_MS) {
    return cachedLatest.sha;
  }

  try {
    const res = await fetch(
      'https://api.github.com/repos/oliviermadre/fleex/commits?per_page=1',
      {
        headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'fleex-version-check' },
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!res.ok) return cachedLatest?.sha ?? null;
    const commits: GitHubCommit[] = await res.json();
    if (commits.length > 0) {
      const sha = commits[0]!.sha.slice(0, 7);
      cachedLatest = { sha, checkedAt: Date.now() };
      return sha;
    }
  } catch {
    // Network error — return stale cache if available
  }
  return cachedLatest?.sha ?? null;
}

export function versionRoutes() {
  return async function (app: FastifyInstance) {
    app.get('/api/version', async () => {
      const localCommit = getCurrentCommitHash();
      const latestCommit = await getLatestRemoteCommit();

      const currentVersion = getCurrentVersion();
      const updateAvailable =
        localCommit != null && latestCommit != null && localCommit !== latestCommit;

      return {
        version: currentVersion,
        commit: localCommit,
        latestCommit,
        updateAvailable,
      };
    });
  };
}
