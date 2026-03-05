import { CLAUDE_USAGE_CACHE_TTL_MS } from '@fleex/shared';
import type { ClaudeUsage } from '@fleex/shared';
import type { ClaudeUsagePort } from '../ports/claude-usage.port.js';
import type { LoggerPort } from '../ports/logger.port.js';

export class GetClaudeUsageUseCase {
  private cached: ClaudeUsage | null = null;
  private cachedAt = 0;
  private inflight: Promise<ClaudeUsage> | null = null;

  constructor(
    private readonly port: ClaudeUsagePort,
    private readonly logger: LoggerPort,
  ) {}

  async execute(force = false): Promise<ClaudeUsage | null> {
    const now = Date.now();

    // Return cached if fresh (unless forced)
    if (!force && this.cached && now - this.cachedAt < CLAUDE_USAGE_CACHE_TTL_MS) {
      return this.cached;
    }

    // Deduplicate concurrent fetches
    if (this.inflight) {
      try {
        return await this.inflight;
      } catch {
        return this.cached;
      }
    }

    try {
      this.inflight = this.port.fetch();
      const usage = await this.inflight;
      this.cached = usage;
      this.cachedAt = Date.now();
      return usage;
    } catch (err) {
      this.logger.error('Failed to fetch Claude usage', {
        error: err instanceof Error ? err.message : String(err),
      });
      return this.cached;
    } finally {
      this.inflight = null;
    }
  }
}
