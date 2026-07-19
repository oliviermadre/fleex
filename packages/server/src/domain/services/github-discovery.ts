import type { RepoDiscovery, DiscoveredRepo } from '@fleex/shared';
import type { ExecFn } from '../../infrastructure/host/types.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';

export class GithubDiscovery {
  constructor(private readonly execFn: ExecFn, private readonly logger: LoggerPort) {}

  async discover(): Promise<RepoDiscovery> {
    const { stdout: userOut } = await this.execFn('gh', ['api', 'user', '--jq', '.login'], { timeout: 15_000 });
    const login = userOut.trim().toLowerCase();

    let orgs: string[] = [];
    try {
      const { stdout } = await this.execFn('gh', ['api', 'user/orgs', '--paginate', '--jq', '.[].login'], { timeout: 15_000 });
      orgs = stdout.split('\n').map((s) => s.trim().toLowerCase()).filter(Boolean);
    } catch (err) {
      this.logger.warn('Failed to list GitHub orgs', { error: String(err) });
    }

    const logins = [...new Set([login, ...orgs])];
    const owners = await Promise.all(
      logins.map(async (owner) => {
        try {
          return { login: owner, repos: await this.listRepos(owner) };
        } catch (err) {
          this.logger.warn('Failed to list repos for owner', { owner, error: String(err) });
          return { login: owner, repos: [] };
        }
      }),
    );

    return { owners, totalRepos: owners.reduce((n, o) => n + o.repos.length, 0) };
  }

  async verifyRepo(repo: string): Promise<{ exists: boolean; nameWithOwner?: string }> {
    try {
      const { stdout } = await this.execFn('gh', ['repo', 'view', repo, '--json', 'nameWithOwner'], { timeout: 15_000 });
      const parsed = JSON.parse(stdout) as { nameWithOwner: string };
      return { exists: true, nameWithOwner: parsed.nameWithOwner.toLowerCase() };
    } catch {
      return { exists: false };
    }
  }

  private async listRepos(owner: string): Promise<DiscoveredRepo[]> {
    const { stdout } = await this.execFn('gh', [
      'repo', 'list', owner, '--json', 'nameWithOwner,visibility,updatedAt', '--limit', '200',
    ], { timeout: 20_000 });
    const raw = JSON.parse(stdout) as { nameWithOwner: string; visibility: string; updatedAt: string }[];
    return raw.map((r) => ({
      nameWithOwner: r.nameWithOwner.toLowerCase(),
      visibility: r.visibility.toLowerCase(),
      updatedAt: r.updatedAt,
    }));
  }
}
