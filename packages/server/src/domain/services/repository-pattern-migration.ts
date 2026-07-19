import type { ConfigPort } from '../../application/ports/config.port.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';

interface ResolverLike { resolve(patterns: string[]): Promise<string[]>; }

/**
 * One-time (idempotent) migration of `repositories` from wildcard patterns
 * (`org/*`) to an explicit `owner/repo` list. A pattern that cannot be
 * resolved (gh unavailable / empty result) is kept verbatim so nothing is
 * lost — it will be retried on next startup.
 */
export async function migrateRepositoryPatterns(
  config: ConfigPort,
  resolver: ResolverLike,
  logger: LoggerPort,
): Promise<void> {
  const current = config.get().repositories ?? [];
  if (!current.some((p) => p.includes('*'))) return;

  const explicit: string[] = [];
  for (const pattern of current) {
    if (!pattern.includes('*')) {
      explicit.push(pattern.toLowerCase());
      continue;
    }
    const resolved = await resolver.resolve([pattern]);
    if (resolved.length === 0) {
      explicit.push(pattern); // keep — retry next startup
    } else {
      explicit.push(...resolved);
    }
  }

  const repositories = [...new Set(explicit)];
  await config.update({
    repositories,
    resolvedRepositories: repositories.filter((r) => !r.includes('*')),
    resolvedAt: new Date().toISOString(),
  });
  logger.info('Migrated repository patterns to explicit list', {
    before: current.length,
    after: repositories.length,
    remainingPatterns: repositories.filter((r) => r.includes('*')).length,
  });
}
