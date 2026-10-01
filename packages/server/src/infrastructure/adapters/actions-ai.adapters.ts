import type { BinaryCheck } from '@fleex/shared';
import type { BinaryLookupPort, JsonModelPort } from '../../application/use-cases/suggest-action.js';
import { ACTIONS_AI_MODEL } from '../../application/use-cases/suggest-action.js';
import type { SdkConcurrencyLimiter } from '../../application/services/sdk-concurrency-limiter.js';
import type { BinaryDiagnosisService } from '../../domain/services/binary-diagnosis.service.js';

/**
 * One non-agentic Haiku call through the Claude Agent SDK — same path as
 * `ask-memory`: no tools, no turns, behind the shared concurrency limiter.
 */
export class ClaudeJsonModel implements JsonModelPort {
  constructor(private readonly sdkLimiter: SdkConcurrencyLimiter) {}

  async complete(systemPrompt: string, prompt: string): Promise<string> {
    const release = await this.sdkLimiter.acquire();
    try {
      const { query } = await import('@anthropic-ai/claude-agent-sdk');
      let result = '';
      for await (const message of query({
        prompt,
        options: {
          model: ACTIONS_AI_MODEL,
          systemPrompt,
          allowedTools: [],
          permissionMode: 'dontAsk' as const,
          maxTurns: 0,
        },
      })) {
        if ('result' in message) result = (message as { result: string }).result;
      }
      return result;
    } finally {
      release();
    }
  }
}

/**
 * Is a program available to a background action? Goes through the binary
 * diagnosis, so an alias or a function of .zshrc — present in the user's
 * terminal, absent from `zsh -l -c` — is reported as such instead of a plain
 * "not found".
 */
export class ShellBinaryLookup implements BinaryLookupPort {
  constructor(private readonly diagnosis: BinaryDiagnosisService) {}

  async lookup(name: string): Promise<BinaryCheck> {
    try {
      const d = await this.diagnosis.diagnose(name);
      const found = d.login !== 'missing';
      const kind = !found && (d.interactive === 'alias' || d.interactive === 'function') ? d.interactive : undefined;
      return { name, found, ...(d.path && found ? { path: d.path } : {}), ...(kind ? { kind } : {}) };
    } catch {
      return { name, found: false };
    }
  }
}

const AVAILABILITY_TTL_MS = 60_000;

/**
 * Whether the SDK can authenticate on this instance. Cached for a minute: the
 * Settings screen asks on every visit, and the keychain lookup behind it is a
 * process spawn.
 */
export function createAiAvailability(hasClaudeCredentials: () => Promise<boolean>) {
  let cached: { at: number; value: boolean } | null = null;
  return async (): Promise<boolean> => {
    if (cached && Date.now() - cached.at < AVAILABILITY_TTL_MS) return cached.value;
    let value = Boolean(process.env['ANTHROPIC_API_KEY']?.trim());
    if (!value) value = await hasClaudeCredentials().catch(() => false);
    cached = { at: Date.now(), value };
    return value;
  };
}
