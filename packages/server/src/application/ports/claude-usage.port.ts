import type { ClaudeUsage } from '@fleex/shared';

export interface ClaudeUsagePort {
  fetch(): Promise<ClaudeUsage>;
}
