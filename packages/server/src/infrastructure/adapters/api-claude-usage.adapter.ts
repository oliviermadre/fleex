import type { ClaudeUsage, ClaudeUsageMetric } from '@fleex/shared';

import type { ClaudeUsagePort } from '../../application/ports/claude-usage.port.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';
import type { ExecFn, HostFs } from '../host/types.js';

const USAGE_ENDPOINT = 'https://api.anthropic.com/api/oauth/usage';
const OAUTH_BETA = 'oauth-2025-04-20';
const KEYCHAIN_SERVICE = 'Claude Code-credentials';

interface OAuthWindow {
  readonly utilization: number | null;
  readonly resets_at: string | null;
}

interface OAuthUsageResponse {
  readonly five_hour?: OAuthWindow | null;
  readonly seven_day?: OAuthWindow | null;
  readonly seven_day_sonnet?: OAuthWindow | null;
}

/**
 * Reads Claude usage quotas from the OAuth usage endpoint, authenticating with
 * the token Claude Code stores locally (macOS Keychain, ~/.claude/.credentials.json,
 * or the CLAUDE_CODE_OAUTH_TOKEN env var). This replaces the old approach of
 * scraping the `/usage` TUI, which no longer renders quota gauges.
 */
export class ApiClaudeUsageAdapter implements ClaudeUsagePort {
  constructor(
    private readonly execFn: ExecFn,
    private readonly hostFs: HostFs,
    private readonly homedir: string,
    private readonly logger: LoggerPort,
  ) {}

  async fetch(): Promise<ClaudeUsage> {
    const token = await this.resolveToken();
    if (!token) {
      throw new Error(
        'No Claude OAuth token found (checked CLAUDE_CODE_OAUTH_TOKEN, Keychain, ~/.claude/.credentials.json)',
      );
    }

    const res = await globalThis.fetch(USAGE_ENDPOINT, {
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-beta': OAUTH_BETA,
      },
    });

    if (res.status === 401) {
      throw new Error('Claude OAuth token rejected (401) — re-authenticate by running `claude`');
    }
    if (!res.ok) {
      throw new Error(`Claude usage endpoint returned HTTP ${res.status}`);
    }

    const data = (await res.json()) as OAuthUsageResponse;
    return this.map(data);
  }

  private map(data: OAuthUsageResponse): ClaudeUsage {
    const result: Record<string, unknown> = {
      fetchedAt: new Date().toISOString(),
    };

    const session = toMetric('Current session', data.five_hour);
    const weeklyAllModels = toMetric('Weekly (all models)', data.seven_day);
    const weeklySonnet = toMetric('Weekly (Sonnet)', data.seven_day_sonnet);

    if (session) result['session'] = session;
    if (weeklyAllModels) result['weeklyAllModels'] = weeklyAllModels;
    if (weeklySonnet) result['weeklySonnet'] = weeklySonnet;

    return result as unknown as ClaudeUsage;
  }

  private async resolveToken(): Promise<string | null> {
    const fromEnv = process.env['CLAUDE_CODE_OAUTH_TOKEN'];
    if (fromEnv?.trim()) return fromEnv.trim();

    // macOS Keychain
    try {
      const { stdout } = await this.execFn('security', [
        'find-generic-password',
        '-s',
        KEYCHAIN_SERVICE,
        '-w',
      ]);
      const token = extractToken(stdout);
      if (token) return token;
    } catch {
      // not macOS, or item absent — fall through
    }

    // Linux / fallback credentials file
    try {
      const raw = await this.hostFs.readFile(`${this.homedir}/.claude/.credentials.json`);
      const token = extractToken(raw);
      if (token) return token;
    } catch {
      // file missing or unreadable
    }

    return null;
  }
}

function toMetric(
  label: string,
  window: OAuthWindow | null | undefined,
): ClaudeUsageMetric | undefined {
  if (!window || typeof window.utilization !== 'number') return undefined;
  return {
    label,
    percentage: Math.round(window.utilization),
    resetsAt: window.resets_at ?? '',
  };
}

function extractToken(raw: string): string | null {
  try {
    const data = JSON.parse(raw) as { claudeAiOauth?: { accessToken?: string } };
    return data.claudeAiOauth?.accessToken ?? null;
  } catch {
    return null;
  }
}
