import type { ExecFn } from '../../infrastructure/host/types.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';

export class RepositoryResolver {
  constructor(private readonly execFn: ExecFn, private readonly logger: LoggerPort) {}

  async resolve(patterns: string[]): Promise<string[]> {
    const resolved: string[] = [];
    for (const pattern of patterns) {
      if (pattern.includes('*')) {
        const org = pattern.replace('/*', '').replace('*', '');
        try {
          const { stdout } = await this.execFn('gh', [
            'repo', 'list', org, '--json', 'nameWithOwner', '--limit', '200',
          ], { timeout: 15_000 });
          const repos = JSON.parse(stdout) as { nameWithOwner: string }[];
          resolved.push(...repos.map((r) => r.nameWithOwner.toLowerCase()));
        } catch (err) {
          this.logger.warn('Failed to resolve wildcard pattern', { pattern, error: String(err) });
        }
      } else {
        resolved.push(pattern.toLowerCase());
      }
    }
    return [...new Set(resolved)];
  }
}
