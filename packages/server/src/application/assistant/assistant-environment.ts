import type { ExecFn } from '../../infrastructure/host/types.js';
import type { LoggerPort } from '../ports/logger.port.js';
import { buildCliTools, type CliCommandDoc, type CliTool } from './fleex-cli-tools.js';

/**
 * What the assistant must know about the Fleex instance it runs inside: the
 * workspace this server serves, the CLI binary it drives, and the CLI's own
 * command reference (`fleex documentation --format json`) turned into tools.
 * Fetched once per process, retried on failure. Injected so tests never spawn
 * the CLI.
 */
export interface AssistantEnvironmentPort {
  readonly workspace: string | null;
  readonly cliBin: string;
  /** False when no Anthropic key is configured: the assistant cannot run. */
  readonly hasApiKey: boolean;
  cliTools(): Promise<CliTool[]>;
  runCli(argv: string[]): Promise<{ ok: boolean; text: string }>;
}

export class AssistantEnvironment implements AssistantEnvironmentPort {
  readonly workspace: string | null;
  readonly cliBin: string;
  readonly hasApiKey: boolean;
  private tools: Promise<CliTool[]> | null = null;

  constructor(
    private readonly execFn: ExecFn,
    private readonly logger: LoggerPort,
    opts: { workspace?: string | null; cliBin: string; hasApiKey: boolean },
  ) {
    this.workspace = opts.workspace?.trim() || null;
    this.cliBin = opts.cliBin;
    this.hasApiKey = opts.hasApiKey;
  }

  cliTools(): Promise<CliTool[]> {
    if (!this.tools) {
      this.tools = this.execFn(this.cliBin, ['documentation', '--format', 'json'], { timeout: 20_000, maxBuffer: 16 * 1024 * 1024 })
        .then((r) => {
          const parsed = JSON.parse(r.stdout) as { commands?: CliCommandDoc[] };
          return buildCliTools(parsed.commands ?? []);
        })
        .catch((err) => {
          this.logger.warn('fleex CLI tools unavailable for the assistant', {
            cliBin: this.cliBin,
            error: err instanceof Error ? err.message : String(err),
          });
          this.tools = null; // retry next turn
          return [];
        });
    }
    return this.tools;
  }

  async runCli(argv: string[]): Promise<{ ok: boolean; text: string }> {
    try {
      const r = await this.execFn(this.cliBin, argv, { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
      const text = r.stdout.trim() || r.stderr.trim() || 'OK';
      return { ok: true, text: text.length > 20_000 ? `${text.slice(0, 20_000)}\n[… tronqué]` : text };
    } catch (err) {
      return { ok: false, text: err instanceof Error ? err.message : String(err) };
    }
  }
}
