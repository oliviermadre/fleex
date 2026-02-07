import { createHash } from 'node:crypto';
import {
  ASM_PREFIX,
  ASM_SHELL_PREFIX,
  ASM_CLAUDE_PREFIX,
  SESSION_HASH_LENGTH,
} from '@asm/shared';
import type { SessionType } from '@asm/shared';

export class SessionNamingService {
  generateShellName(cwd: string): string {
    const input = cwd + Date.now().toString() + Math.random().toString();
    const hash = createHash('sha256').update(input).digest('hex').slice(0, SESSION_HASH_LENGTH);
    return `${ASM_SHELL_PREFIX}${hash}`;
  }

  generateClaudeName(cwd: string): string {
    const hash = createHash('sha256').update(cwd).digest('hex').slice(0, SESSION_HASH_LENGTH);
    return `${ASM_CLAUDE_PREFIX}${hash}`;
  }

  isManaged(name: string): boolean {
    return name.startsWith(ASM_PREFIX);
  }

  parseType(name: string): SessionType | null {
    if (name.startsWith(ASM_SHELL_PREFIX)) return 'shell';
    if (name.startsWith(ASM_CLAUDE_PREFIX)) return 'claude';
    return null;
  }
}
