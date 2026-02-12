import type { ClaudeUsage } from '@asm/shared';

export interface ClaudeUsagePort {
  fetch(): Promise<ClaudeUsage>;
}
